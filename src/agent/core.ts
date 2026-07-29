import Anthropic from "@anthropic-ai/sdk";
import type { AgentContext, ToolRegistry, Tokens } from "./types.js";

// ── 에이전트 코어 ─────────────────────────────────────────────
// "도구를 들고 있는 Claude를 답이 나올 때까지 굴리는 엔진".
//
// 시스템 프롬프트와 도구 레지스트리를 받아서 루프를 돌릴 뿐이라,
// Personal Agent든 Media Agent든 앞으로 생길 Travel Agent든 이 함수 하나를 같이 쓴다.
// (도메인 지식은 각 에이전트 파일에, 실제 일은 tools/에 있다.)

// Anthropic 클라이언트. 프로세스 전체에서 하나만 쓴다.
const anthropic = new Anthropic();

// 오늘 날짜를 KST로 구한다. 질문할 때마다 새로 호출해야 REPL을 자정 넘겨
// 켜둬도 "오늘"이 어제로 굳지 않는다.
// toISOString()은 UTC 기준이라 KST 새벽~오전엔 어제 날짜가 나온다.
// 한국 시간대로 포맷해야 "오늘"이 실제 오늘이 된다. (en-CA = YYYY-MM-DD)
export function todayKST(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }); // "2026-06-18"
}

// ── 조회 결과 캐시 ────────────────────────────────────────────
// 같은 읽기 도구를 같은 입력으로 다시 부르면, 노션을 또 조회하지 않고 저장해 둔 결과를 쓴다.
// (주의: Claude 토큰을 줄이는 게 아니라 노션 호출/대기시간을 줄이는 것이다. 토큰 절감은 prompt caching 몫.)
// 쓰기 도구는 데이터를 바꾸므로 캐싱하지 않고, 쓰기가 성공하면 오래된 값을 막으려 캐시를 통째로 비운다.
// 에이전트별로 나누지 않고 하나만 둔다 — 도구 이름이 전역에서 유일하고,
// Personal이 읽은 데이터를 서브에이전트가 다시 읽는 경우에도 캐시가 그대로 먹힌다.
const queryCache = new Map<string, string>();

function cacheKey(name: string, input: any): string {
  return `${name}:${JSON.stringify(input ?? {})}`;
}

export function clearQueryCache(): void {
  queryCache.clear();
}

// ── 도구 실행기 ───────────────────────────────────────────────
// Claude가 "이 도구를 이 입력으로 불러줘"라고 하면, 레지스트리에서 찾아 실행한다.
async function runTool(
  registry: ToolRegistry,
  name: string,
  input: any,
  ctx: AgentContext
): Promise<string> {
  const tool = registry[name];
  if (!tool) return `알 수 없는 도구: ${name}`;

  const key = cacheKey(name, input);

  // 읽기 도구이고 캐시에 있으면 노션을 다시 부르지 않고 바로 돌려준다.
  if (!tool.isWrite && queryCache.has(key)) {
    ctx.log("   ⚡ 캐시에서 바로 가져옴 (노션 조회 생략)");
    return queryCache.get(key)!;
  }

  try {
    const data = await tool.run(input, ctx);
    const result = typeof data === "string" ? data : JSON.stringify(data);
    if (tool.isWrite) {
      queryCache.clear(); // 데이터가 바뀌었으니 조회 캐시를 비운다.
    } else {
      queryCache.set(key, result);
    }
    return result;
  } catch (e: any) {
    // 오류도 문자열로 돌려주면 루프가 죽지 않고 Claude가 보고 고쳐 시도한다.
    return `오류: ${e?.message ?? String(e)}`;
  }
}

// ── 토큰 사용량 모니터링 ──────────────────────────────────────
// 응답마다 usage가 온다. 그걸 더해서 이번 질문/세션 누적 사용량을 보여준다.
//  - input      : 정가로 처리된 입력 토큰
//  - cacheWrite : 캐시에 처음 쓸 때(정가의 ~1.25배). 첫 호출에서만 발생.
//  - cacheRead  : 캐시에서 읽은 토큰(정가의 ~10%). 캐싱이 먹히면 여기로 잡힌다.
//  - output     : 출력 토큰
// 세션 누적은 서브에이전트가 쓴 토큰까지 여기로 함께 들어온다(코어를 같이 쓰므로).
const session: Tokens = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };

export function newTokens(): Tokens {
  return { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
}

// usage 한 건을 누적 대상(acc)에 더한다.
function addUsage(acc: Tokens, u: Anthropic.Usage): void {
  acc.input += u.input_tokens;
  acc.output += u.output_tokens;
  acc.cacheWrite += u.cache_creation_input_tokens ?? 0;
  acc.cacheRead += u.cache_read_input_tokens ?? 0;
}

// 토큰 사용량을 한 줄로 보기 좋게.
export function fmtTokens(t: Tokens): string {
  return `입력 ${t.input} · 캐시읽기 ${t.cacheRead} · 캐시쓰기 ${t.cacheWrite} · 출력 ${t.output}`;
}

// 이번 세션 누적 토큰을 한 줄로. REPL의 "token" 명령이 부른다.
export function getSessionSummary(): string {
  return fmtTokens(session);
}

// ── prompt caching ────────────────────────────────────────────
// 정적 지시문은 매 호출마다 똑같으므로 prompt caching으로 묶는다.
// (전송 순서가 tools → system 이라, 이 블록에 브레이크포인트를 걸면 tools까지 함께 캐싱된다.)
// 두 번째 호출부터 이 부분이 cache_read 로 잡혀 거의 공짜(정가의 ~10%)로 처리된다 → 토큰 절감.
// 날짜만 매번 바뀌므로 캐시 블록 "뒤"에 따로 붙인다: 정적 캐시는 그대로 유지되고,
// 같은 날엔 날짜도 동일해 캐시가 계속 먹는다. 자정을 넘긴 첫 질문에서만 갱신된다.
function buildSystem(text: string, today: string): Anthropic.TextBlockParam[] {
  return [
    { type: "text", text, cache_control: { type: "ephemeral" } },
    { type: "text", text: `오늘 날짜는 ${today}야.` },
  ];
}

// 대화 기록에도 캐시 브레이크포인트를 건다.
// 매 호출 직전, "마지막 메시지의 마지막 블록" 한 곳에만 cache_control을 찍는다.
// 그러면 그 앞 대화 전체(직전 호출에서 캐시에 써 둔 prefix)가 cache_read로 재사용된다.
// 브레이크포인트는 요청당 최대 4개라, 항상 한 곳만 두어 system 것과 합쳐 2개로 유지한다.
// 저장된 기록(history)은 건드리지 않고, 보낼 사본에만 표시를 단다.
function withConversationCache(
  history: Anthropic.MessageParam[]
): Anthropic.MessageParam[] {
  if (history.length === 0) return history;

  const msgs = history.map((m) => ({ ...m }));
  const last = msgs[msgs.length - 1]!;

  // content가 문자열이면 텍스트 블록 하나로 바꿔서 표시할 자리를 만든다.
  const blocks: any[] =
    typeof last.content === "string"
      ? [{ type: "text", text: last.content }]
      : last.content.map((b) => ({ ...b }));
  if (blocks.length === 0) return msgs; // 빈 메시지는 표시할 자리가 없으니 그냥 둔다.

  // 마지막 블록에만 cache_control을 단다.
  blocks[blocks.length - 1] = {
    ...blocks[blocks.length - 1],
    cache_control: { type: "ephemeral" },
  };
  last.content = blocks;
  return msgs;
}

// ── 도구 루프 ─────────────────────────────────────────────────
// Claude가 더 이상 도구를 부르지 않을 때까지 돌리고, 최종 텍스트를 돌려준다.
//
// messages는 호출자가 소유한다 — 이 함수는 거기에 이어 붙이기만 한다.
// 그래서 Personal Agent는 배열을 계속 들고 있어 후속 질문이 되고,
// 서브에이전트는 매번 빈 배열을 새로 줘서 요청 1건이 독립적으로 처리된다.
export async function runToolLoop(opts: {
  model: string;
  systemText: string;
  registry: ToolRegistry;
  messages: Anthropic.MessageParam[];
  ctx: AgentContext;
}): Promise<{ text: string; tokens: Tokens }> {
  const { model, systemText, registry, messages, ctx } = opts;

  // 레지스트리에서 Claude용 명세(tools)를 만든다.
  // Claude에게는 "이름 + 설명 + 입력 모양"만 알려주면 된다(run은 우리만 씀).
  const tools: Anthropic.Tool[] = Object.entries(registry).map(
    ([name, def]) => ({
      name,
      description: def.description,
      input_schema: { type: "object", properties: def.properties ?? {} },
    })
  );

  const system = buildSystem(systemText, ctx.today);
  const tokens = newTokens(); // 이번 실행에서만 쓴 토큰(세션 누적과 별도로 보여주려고).

  while (true) {
    const response = await anthropic.messages.create({
      model,
      max_tokens: 16000,
      system, // prompt caching: 정적 지시문+tools를 캐시로 묶고, 날짜만 캐시 뒤에 붙여 재전송 비용을 줄인다.
      tools,
      messages: withConversationCache(messages), // 대화 기록도 캐시로 재사용.
    });

    // 이번 호출의 토큰 사용량을 실행별/질문별/세션 누적에 모두 더한다.
    addUsage(tokens, response.usage);
    addUsage(session, response.usage);
    if (ctx.usage) addUsage(ctx.usage, response.usage);

    // 방금 받은 어시스턴트 응답을 대화 기록에 그대로 추가한다.
    messages.push({ role: "assistant", content: response.content });

    // 도구를 안 불렀다 = 최종 답변이다. 텍스트를 모아 돌려준다.
    if (response.stop_reason !== "tool_use") {
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      return { text, tokens };
    }

    // 도구를 불렀다 = 실행해서 결과를 모은다.
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;

      const def = registry[block.name];

      // 쓰기 도구면 실제 실행 전에 무엇을 할지 보여주고 확인을 받는다.
      if (def?.isWrite) {
        await def.preview?.(block.input);
        const ok = await ctx.confirmWrite("실행할까요? (y/N) ");
        if (!ok) {
          ctx.log("⏭️  취소했어요.\n");
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: "사용자가 실행을 취소했습니다. 임의로 다시 시도하지 마세요.",
          });
          continue;
        }
      }

      ctx.log(`🔧 ${block.name}(${JSON.stringify(block.input)})`);
      const result = await runTool(registry, block.name, block.input, ctx);
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id, // 어떤 호출에 대한 결과인지 id로 짝을 맞춘다.
        content: result,
      });
    }

    // 도구 결과를 user 메시지로 다시 보낸다 → 루프가 다시 돌며 Claude가 이어서 생각한다.
    messages.push({ role: "user", content: toolResults });
  }
}
