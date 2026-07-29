import type Anthropic from "@anthropic-ai/sdk";
import {
  runToolLoop,
  delegationTools,
  clearQueryCache,
  fmtTokens,
  newTokens,
  todayKST,
} from "./core.js";
import { notionTools } from "../tools/notion.js";
import { memoryTools } from "../tools/memory.js";
import { loadMemories, formatMemories } from "../memory.js";
import { mediaAgent } from "./media.js";
import { reflectionAgent } from "./reflection.js";
// 모델 라우팅 규칙은 순수 모듈로 분리했다(단위 테스트 대상). model-router.test.ts 참고.
import { pickModel, MODEL_COMPLEX } from "../model-router.js";
import type { Agent, AgentContext, ConfirmWrite, ToolRegistry } from "./types.js";

// ── Personal Agent (오케스트레이터) ───────────────────────────
// 사용자와 직접 대화하는 유일한 에이전트. 역할은 두 가지다:
//  (1) 자기 도구(노션 읽기·쓰기)로 직접 처리한다.
//  (2) 자기 일이 아니면 도메인 전문 에이전트에게 맡기고, 결과를 정리해 전달한다.
//
// 터미널(stdin) 의존은 여기 두지 않는다: 쓰기 확인(y/N)은 confirmWrite 콜백으로 주입받아
// REPL이든 배치든 원하는 방식으로 확인을 처리할 수 있게 한다(=stdin과 분리).

// 이 오케스트레이터가 거느리는 서브에이전트들.
// 도메인이 늘면 여기 한 줄씩 더한다. 다른 코드는 안 고쳐도 된다.
const subAgents: Agent[] = [reflectionAgent, mediaAgent];

// 이 에이전트가 쥔 도구 전부 = 노션 도구 + 기억 도구 + 서브에이전트 위임 도구.
// 기억은 Personal만 갖는다 — 사용자를 아는 건 오케스트레이터의 몫이고,
// 서브에이전트는 필요한 맥락을 위임 request로 받으면 된다.
const registry: ToolRegistry = {
  ...notionTools,
  ...memoryTools,
  ...delegationTools(subAgents),
};

const system =
  "너는 사용자의 개인 비서를 총괄하는 에이전트야. " +
  "노션에 쌓인 가계부·운동·식단·일기·의사결정 기록을 읽고 쓸 수 있고, " +
  "네 일이 아닌 영역은 전문 에이전트에게 맡긴다. " +
  "의사결정 로그(get_decisions)에는 어떤 결정을 왜 했는지·대안·교훈·만족도가 쌓인다. " +
  "사용자가 가치관·판단 성향·후회 패턴을 물으면, 여러 결정을 가로질러 보고 " +
  "반복되는 기준(무엇을 중시하고 무엇을 포기하는지)과 만족도와의 관계를 짚어줘. " +
  '"이번달", "지난주" 같은 표현은 오늘을 기준으로 ' +
  "실제 날짜 범위(YYYY-MM-DD)로 바꿔서 도구를 호출해. " +
  "답에 필요한 데이터가 있으면 사용자에게 물어보지 말고, 관련 도구를 알아서 모두 호출해서 먼저 확인해. " +
  "조회(읽기)는 허락 없이 마음껏 해도 된다. " +
  '예를 들어 "목표 달성률"을 물으면 목표를 가져온 뒤, 그 목표와 관련된 ' +
  "운동·공부·체중·식단 등 기록도 스스로 조회해서 비교한다. " +
  '"~을 확인해 볼까요?" 같은 되묻기로 끝내지 말고, 직접 확인한 결과로 답해. ' +
  "데이터를 조회한 뒤에는 사람이 읽기 좋게 요약해서 한국어로 답해. " +
  // 쓰기 안내
  "데이터를 추가/수정/삭제할 때는 create_record / update_record / delete_record 도구를 쓴다. " +
  "수정(update_record)이나 삭제(delete_record)를 하려면 먼저 get_* 로 읽어서 그 행의 id를 알아낸 뒤 id로 호출해라. " +
  "삭제는 노션 휴지통으로 보내는 것이라 되돌릴 수 있지만, 그래도 어떤 행을 지울지 id를 정확히 확인하고 호출해라. " +
  "행을 가릴 때는 제목 컬럼(예: 식단의 '식사' = 아침/점심/저녁)과 날짜로 찾아라. " +
  "어떤 칸(예: '음식')이 비어 있어도 그 행이 '없는 것'이 아니다. 빈 값은 그냥 비어 있을 뿐, 행은 존재한다. " +
  '예: 오늘 "아침" 행이 있는데 음식이 비어 있으면, 그 행은 분명히 존재하므로 "아침 기록이 없다"고 하지 말고 그 행을 삭제 대상으로 삼아라. ' +
  "쓰기는 실행 직전에 시스템이 사용자에게 y/N로 한 번 확인을 받는다. " +
  "그러니 너는 '이렇게 추가할까요?' 같은 확인 질문을 따로 하지 말고, 필요한 정보가 다 있으면 바로 도구를 호출해라. " +
  "정보가 부족할 때만(예: 어떤 행을 고칠지 불명확) 되물어라. " +
  // 장기 기억
  "[기억] 너에게는 대화를 넘어 남는 장기 기억이 있다. 지금 기억하는 내용은 시스템 프롬프트 끝에 목록으로 붙어 온다. " +
  "이 기억은 '다시 켜도 남는 수첩'이다. 대화 기록과 달리 clear를 해도 사라지지 않는다. " +
  // 언제 부를지를 못 박아 둔다. "알게 되면 적어라"처럼 두루뭉술하게 두면
  // 답변하는 데 정신이 팔려 기억하는 걸 그냥 건너뛴다.
  "[언제 적는가] 여러 기록을 가로질러 결론을 낸 직후다. " +
  "일기·지출·운동 기록 등을 조회해서 '반복되는 패턴'이나 '지속되는 상황'을 찾아냈다면, " +
  "사용자에게 답을 하고 끝내지 말고 그 결론 중 오래갈 것을 remember로 적은 뒤 답해라. " +
  "적지 않으면 다음에 같은 걸 물었을 때 그 조회와 분석을 처음부터 다시 해야 한다 — 시간도 비용도 두 번 든다. " +
  "사용자가 자기 이야기를 직접 해줬을 때도 마찬가지다(예: '나 원래 아침형이야'). " +
  "다만 한 대화에서 두세 개를 넘기지는 마라. 가장 오래갈 것부터 고른다. " +
  "노션을 조회하면 언제든 알 수 있는 값(오늘 체중, 이번 달 식비)은 기억하지 마라. 그건 이미 노션에 있다. " +
  "기억할 값어치가 있는 건 '여러 기록을 가로질러야 보이는 것'이다 " +
  '(예: 일기 2주치를 읽고 나서야 보이는 "월요일마다 방전된다" 같은 것). ' +
  "이미 기억에 있는 내용을 확인하겠다고 같은 조회를 또 하지는 마라. " +
  "단, 수치나 최근 상태를 묻는 질문(이번 주 지출, 어제 운동)은 기억에 뭐가 있든 항상 노션에서 새로 조회한다 — " +
  "기억은 '어떤 사람인지'를 담는 것이지 '지금 값이 얼마인지'를 담는 게 아니다. " +
  "기억이 사실과 어긋나거나 낡았다는 게 드러나면 forget으로 지우고 필요하면 새로 적어라. " +
  "사용자가 '그건 이제 아니야'라고 하면 되묻지 말고 바로 지운다. " +
  // 위임 — 오케스트레이터로서의 역할
  "[위임] 전문 에이전트에게 넘기는 도구(reflection_agent, media_agent)도 다른 도구처럼 그냥 호출하면 된다. " +
  "각 서브에이전트는 자기 도메인 도구만 갖고 있다 — 무엇을 볼 수 있고 없는지는 그 도구의 설명에 적혀 있으니 그걸 보고 판단해라. " +
  "그 에이전트가 볼 수 없는 정보가 필요한 일이면, 네가 먼저 조회해서 request에 문장으로 담아 넘겨야 한다. " +
  "예를 들어 사용자가 '오늘 기분이 너무 안 좋아'라고 하면: " +
  "(1) 최근 며칠 일기와 필요하면 운동·수면·소비 기록도 봐서 무슨 일이 있었는지 파악한다. " +
  "(2) 파악한 감정과 상황을 request에 적어 media_agent에 위임한다(예: '야근이 이어져 지쳐 있고 스트레스 높음. 잔잔한 영상 2개 추천'). " +
  "(3) 돌아온 답을 그대로 붙여넣지 말고, 네가 파악한 맥락과 엮어서 사용자에게 전한다 — 왜 지금 이게 도움이 될지까지. " +
  "여러 에이전트가 필요한 일이면 순서대로 부르고, 앞 에이전트의 결과를 뒤 에이전트의 request에 넣어 준다 " +
  "(예: reflection_agent가 '요즘 무기력이 반복된다'고 하면, 그 진단을 media_agent 요청에 담아 넘긴다). " +
  "서브에이전트가 '없다'고 답하면 그 사실을 솔직히 전해라. 네가 지어내서 메우면 안 된다. " +
  // 일기를 깊게 파는 일은 reflection_agent 담당이라, 그 절차서는 여기 두지 않는다.
  // (예전에는 이 자리에 일기 해석 요령 17줄이 있었다. 식비를 묻는 질문에도 매번 따라다녔다.)
  "[일기] 일기 본문을 읽어야 하는 일 — 결정 찾아 기록하기, 감정 패턴 짚기, 후회 패턴 분석 — 은 " +
  "reflection_agent에 위임한다. 네가 get_diary_details로 직접 읽는 건 " +
  "다른 기록과 엮어 보려고 상황을 파악할 때(예: 기분이 안 좋은 이유를 알아보는 중)로 한정한다. " +
  "회고 결과에서 오래갈 패턴이 나오면 remember로 적어 두는 건 네 몫이다.";

// 대화 기록. API는 상태가 없어서 매번 전체 기록을 보낸다.
// 모듈 수준에 두면 질문 사이에도 유지돼서 "후속 질문"이 가능하다.
// (서브에이전트는 이 기록을 공유하지 않는다 — 필요한 맥락은 위임 request에 담겨 간다.)
const messages: Anthropic.MessageParam[] = [];

// 대화 기록·조회 캐시를 비운다. REPL의 "clear" 명령이 부른다.
// 주제를 바꿀 때 쓰면 토큰(비용)이 다시 가벼워진다.
export function resetConversation(): void {
  messages.length = 0; // 배열 내용을 비운다 (const라도 .length=0 은 가능).
  clearQueryCache(); // 조회 캐시도 함께 비운다.
}

// 질문 하나를 받아, Claude가 도구를 다 쓰고 최종 답을 낼 때까지 돌린다.
// confirmWrite: 쓰기 도구 실행 직전에 사용자 확인을 받는 콜백(주입).
export async function ask(
  userQuestion: string,
  confirmWrite: ConfirmWrite
): Promise<void> {
  messages.push({ role: "user", content: userQuestion });

  // 이번 질문을 처리할 모델을 한 번 정해서, 도구 호출 루프 내내 같은 모델을 쓴다.
  // (서브에이전트는 자기 요청을 기준으로 따로 고른다 — 위임받은 일이 더 단순할 수 있으므로.)
  const model = pickModel(userQuestion);
  const label = model === MODEL_COMPLEX ? "Sonnet · 복잡 분석" : "Haiku · 간단 조회";
  console.log(`🤖 모델: ${label}`);

  // 이번 질문에서만 쓴 토큰. ctx로 흘려보내면 서브에이전트가 쓴 것까지 여기 쌓인다.
  const usage = newTokens();

  // 이번 질문 시작 시점의 날짜를 잡는다(도구 루프 내내 동일하게 사용).
  const ctx: AgentContext = {
    confirmWrite,
    today: todayKST(),
    log: (m) => console.log(m),
    usage,
  };

  // 장기 기억을 질문마다 새로 읽어 시스템 프롬프트에 실어 보낸다.
  // (파일에서 한 번 읽고 메모리에 들고 있으므로 실제 디스크 접근은 첫 질문 때뿐이다.)
  const context = formatMemories(await loadMemories());

  const { text } = await runToolLoop({
    model,
    systemText: system,
    registry,
    messages,
    ctx,
    context,
  });

  console.log(text);
  console.log(`\n📊 이번 질문 토큰 — ${fmtTokens(usage)}`);
}
