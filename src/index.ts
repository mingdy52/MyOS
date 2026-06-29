import "dotenv/config";
import { createInterface } from "node:readline/promises";
import Anthropic from "@anthropic-ai/sdk";
import { getTargets } from "./notion/target.js";
import { getDietRecords } from "./notion/diet.js";
import { getWorkoutRecords } from "./notion/workout.js";
import { getStudyRecords } from "./notion/study.js";
import { getExpenses } from "./notion/expense.js";
import { getDiaryRecords } from "./notion/diary.js";
import { getWeightRecords } from "./notion/weight.js";

import { getTechStacks } from "./notion/techstack.js";
import { getProjects } from "./notion/project.js";
import { getApplications } from "./notion/application.js";

import { schemas } from "./notion/schema.js";
import {
  createRecord,
  updateRecord,
  deleteRecord,
  getCurrentValues,
  getRecordSummary,
} from "./notion/mutate.js";

// Anthropic 클라이언트.
const anthropic = new Anthropic();

// ── 1) 도구 ───────────────────────────
// 거의 모든 도구가 공유하는 기간 필터. 한 번만 정의해서 재사용한다.
const dateRange = {
  from: { type: "string", description: '시작 날짜, "YYYY-MM-DD" 형식' },
  to: { type: "string", description: '끝 날짜, "YYYY-MM-DD" 형식' },
} as const;

type ToolDef = {
  description: string;
  // 입력 스키마의 properties. 없으면 입력 없는 도구(전체 조회).
  properties?: Record<string, unknown>;
  // Claude가 준 입력(input)을 받아 실제 노션 함수를 부르는 실행기.
  run: (input: any) => Promise<unknown>;
};

// 쓰기 도구 설명에 끼워 넣을 DB별 컬럼 안내. (정의는 아래 buildSchemaHint)
const schemaHint = buildSchemaHint();

const registry: Record<string, ToolDef> = {
  get_targets: {
    description: "목표 기록을 조회한다. 기간(from/to)으로 거를 수 있다.",
    properties: { ...dateRange },
    run: (i) => getTargets(i.from, i.to),
  },
  get_diets: {
    description: "식단 기록을 조회한다. 기간(from/to)으로 거를 수 있다.",
    properties: { ...dateRange },
    run: (i) => getDietRecords(i.from, i.to),
  },
  get_workouts: {
    description: "운동 기록을 조회한다. 기간과 운동 이름(예: 수영)으로 거를 수 있다.",
    properties: {
      ...dateRange,
      exercise: { type: "string", description: '운동 이름 필터. 예: "수영"' },
    },
    run: (i) => getWorkoutRecords(i.from, i.to, i.exercise),
  },
  get_studies: {
    description: "공부·작업 기록(한 일/시간/집중도/기술)을 조회한다. 기간(from/to)으로 거를 수 있다.",
    properties: { ...dateRange },
    run: (i) => getStudyRecords(i.from, i.to),
  },
  get_expenses: {
    description:
      "가계부(소비 내역)를 조회한다. 기간(from/to)과 유형(예: 식비)으로 거를 수 있다. " +
      "금액 합계가 필요하면 조회 결과의 금액을 직접 더해서 계산해.",
    properties: {
      ...dateRange,
      category: { type: "string", description: '유형 필터. 예: "식비"' },
    },
    run: (i) => getExpenses(i.from, i.to, i.category),
  },
  get_diaries: {
    description: "일기 기록(기분/에너지/스트레스)을 조회한다. 기간(from/to)으로 거를 수 있다.",
    properties: { ...dateRange },
    run: (i) => getDiaryRecords(i.from, i.to),
  },
  get_weights: {
    description: "체중 기록을 조회한다. 기간(from/to)으로 거를 수 있다.",
    properties: { ...dateRange },
    run: (i) => getWeightRecords(i.from, i.to),
  },
  get_techstacks: {
    description: "보유 기술 스택(기술/수준/자신감)을 조회한다. 날짜 개념이 없어 전체를 가져온다.",
    run: () => getTechStacks(),
  },
  get_projects: {
    description: "프로젝트 목록(상태/역할/기술/기간)을 조회한다. 날짜 개념이 없어 전체를 가져온다.",
    run: () => getProjects(),
  },
  get_applications: {
    description:
      "입사 지원 현황(회사/직무/상태/지원일)을 조회한다. 지원일 기준 기간(from/to)으로 거를 수 있다.",
    properties: { ...dateRange },
    run: (i) => getApplications(i.from, i.to),
  },

  // ── 쓰기 도구(삽입/수정) ──────────────────────────────
  create_record: {
    description:
      "DB에 새 행을 추가한다. database(어느 DB)와 fields(컬럼명:값)를 준다. " +
      "쓸 수 있는 DB와 컬럼: " +
      schemaHint,
    properties: {
      database: {
        type: "string",
        enum: Object.keys(schemas),
        description: "어느 DB에 추가할지",
      },
      fields: {
        type: "object",
        description: '추가할 값. {"컬럼명": 값} 형태. 날짜는 "YYYY-MM-DD".',
      },
    },
    run: (i) => createRecord(i.database, i.fields),
  },
  update_record: {
    description:
      "기존 행을 수정한다. 먼저 get_* 로 읽어서 id를 얻은 뒤, 그 id로 호출해라. " +
      "fields에는 바꿀 컬럼만 넣으면 된다. 쓸 수 있는 DB와 컬럼: " +
      schemaHint,
    properties: {
      database: {
        type: "string",
        enum: Object.keys(schemas),
        description: "어느 DB의 행을 수정할지",
      },
      id: {
        type: "string",
        description: "수정할 행의 id (읽기 결과에 들어 있는 id)",
      },
      fields: {
        type: "object",
        description: '바꿀 값. {"컬럼명": 값} 형태. 안 바꾸는 컬럼은 생략.',
      },
    },
    run: (i) => updateRecord(i.database, i.id, i.fields),
  },
  delete_record: {
    description:
      "기존 행을 삭제한다(노션 휴지통으로 보내며 30일 내 복구 가능). " +
      "먼저 get_* 로 읽어서 지울 행의 id를 정확히 확인한 뒤, 그 id로 호출해라. " +
      "여러 행을 지울 때는 행마다 한 번씩 호출한다. 쓸 수 있는 DB: " +
      Object.keys(schemas).join(", "),
    properties: {
      database: {
        type: "string",
        enum: Object.keys(schemas),
        description: "어느 DB의 행을 삭제할지",
      },
      id: {
        type: "string",
        description: "삭제할 행의 id (읽기 결과에 들어 있는 id)",
      },
    },
    run: (i) => deleteRecord(i.database, i.id),
  },
};

// 스키마를 훑어 "[expense] 내역(title), 금액(number)... / [diet] ..." 같은 문구를 만든다.
// 스키마 한 곳만 고치면 쓰기 도구 설명도 자동으로 따라온다.
function buildSchemaHint(): string {
  return Object.entries(schemas)
    .map(([db, s]) => {
      const cols = Object.entries(s.columns)
        .map(([name, type]) => `${name}(${type})`)
        .join(", ");
      return `[${db}] ${cols}`;
    })
    .join(" / ");
}

// ── 2) registry에서 Claude용 명세(tools)를 자동 생성 ────────────
// Claude에게는 "이름 + 설명 + 입력 모양"만 알려주면 된다(run은 우리만 씀).
const tools: Anthropic.Tool[] = Object.entries(registry).map(
  ([name, def]) => ({
    name,
    description: def.description,
    input_schema: { type: "object", properties: def.properties ?? {} },
  })
);

// 데이터를 바꾸는(위험한) 도구들. 실행 전에 사용자 확인을 받는다.
const WRITE_TOOLS = new Set(["create_record", "update_record", "delete_record"]);

// ── 조회 결과 캐시 ────────────────────────────────────────────
// 같은 읽기 도구를 같은 입력으로 다시 부르면, 노션을 또 조회하지 않고 저장해 둔 결과를 쓴다.
// (주의: Claude 토큰을 줄이는 게 아니라 노션 호출/대기시간을 줄이는 것이다. 토큰 절감은 prompt caching 몫.)
// 쓰기 도구는 데이터를 바꾸므로 캐싱하지 않고, 쓰기가 성공하면 오래된 값을 막으려 캐시를 통째로 비운다.
const queryCache = new Map<string, string>();

function cacheKey(name: string, input: any): string {
  return `${name}:${JSON.stringify(input ?? {})}`;
}

// ── 3) 도구 실행기 ──────────────────────────────────────────────
// Claude가 "이 도구를 이 입력으로 불러줘"라고 하면, registry에서 찾아 실행한다.
async function runTool(name: string, input: any): Promise<string> {
  const tool = registry[name];
  if (!tool) return `알 수 없는 도구: ${name}`;

  const isWrite = WRITE_TOOLS.has(name);
  const key = cacheKey(name, input);

  // 읽기 도구이고 캐시에 있으면 노션을 다시 부르지 않고 바로 돌려준다.
  if (!isWrite && queryCache.has(key)) {
    console.log("   ⚡ 캐시에서 바로 가져옴 (노션 조회 생략)");
    return queryCache.get(key)!;
  }

  try {
    const data = await tool.run(input);
    const result = JSON.stringify(data);
    if (isWrite) {
      queryCache.clear(); // 데이터가 바뀌었으니 조회 캐시를 비운다.
    } else {
      queryCache.set(key, result);
    }
    return result;
  } catch (e: any) {
    // 오류도 문자열로 돌려주면 REPL이 죽지 않고 Claude가 보고 고쳐 시도한다.
    return `오류: ${e?.message ?? String(e)}`;
  }
}

// 값 하나를 사람이 읽기 좋은 문자열로. (빈 값은 "(없음)", 배열은 쉼표로)
function fmtValue(v: any): string {
  if (v === undefined || v === null || v === "") return "(없음)";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "(없음)";
  return String(v);
}

// 쓰기 도구를 실행하기 직전에, 무엇을 어떤 값으로 넣거나 바꿀지 보기 좋게 출력한다.
// create: "컬럼: 값", update: "컬럼: 기존값 → 새값"(기존값은 노션에서 읽어와 비교).
async function printWritePreview(name: string, input: any): Promise<void> {
  const fields: Record<string, any> = input.fields ?? {};

  if (name === "delete_record") {
    // 어떤 행을 지우는지 제목·날짜를 읽어와 보여준다(잘못된 행 삭제 방지).
    let summary = { title: `(id: ${input.id})`, date: "" };
    try {
      summary = await getRecordSummary(input.database, input.id);
    } catch {
      // 요약을 못 읽어도 최소한 어느 DB/id를 지우는지는 아래에서 보여준다.
    }
    const when = summary.date ? `${summary.date} · ` : "";
    console.log(`\n🗑️  [${input.database}] 행을 삭제합니다 (휴지통으로 이동, 복구 가능):`);
    console.log(`   • ${when}${summary.title}`);
    return;
  }

  if (name === "create_record") {
    console.log(`\n✍️  [${input.database}]에 새 행을 추가합니다:`);
    for (const [col, value] of Object.entries(fields)) {
      console.log(`   • ${col}: ${fmtValue(value)}`);
    }
    return;
  }

  if (name === "update_record") {
    console.log(`\n✍️  [${input.database}] 행을 수정합니다 (id: ${input.id}):`);
    // 바뀔 컬럼들의 현재 값을 읽어와 "기존 → 새 값"으로 보여준다.
    let current: Record<string, any> = {};
    try {
      current = await getCurrentValues(
        input.database,
        input.id,
        Object.keys(fields)
      );
    } catch {
      // 현재 값을 못 읽어도 새 값만이라도 보여준다.
    }
    for (const [col, value] of Object.entries(fields)) {
      console.log(`   • ${col}: ${fmtValue(current[col])} → ${fmtValue(value)}`);
    }
  }
}

// ── 4) 에이전트: 질문 하나를 끝까지 처리 ────────────────────────
// 오늘 날짜를 KST로 구한다. 질문할 때마다 새로 호출해야 REPL을 자정 넘겨
// 켜둬도 "오늘"이 어제로 굳지 않는다.
// toISOString()은 UTC 기준이라 KST 새벽~오전엔 어제 날짜가 나온다.
// 한국 시간대로 포맷해야 "오늘"이 실제 오늘이 된다. (en-CA = YYYY-MM-DD)
function todayKST(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }); // "2026-06-18"
}

const system =
  "너는 사용자의 노션 가계부/운동/식단 데이터를 분석하는 비서야. " +
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
  "정보가 부족할 때만(예: 어떤 행을 고칠지 불명확) 되물어라.";

// 정적 지시문은 매 호출마다 똑같으므로 prompt caching으로 묶는다.
// (전송 순서가 tools → system 이라, 이 블록에 브레이크포인트를 걸면 tools까지 함께 캐싱된다.)
// 두 번째 호출부터 이 부분이 cache_read 로 잡혀 거의 공짜(정가의 ~10%)로 처리된다 → 토큰 절감.
// 날짜만 매번 바뀌므로 캐시 블록 "뒤"에 따로 붙인다: 정적 캐시는 그대로 유지되고,
// 같은 날엔 날짜도 동일해 캐시가 계속 먹는다. 자정을 넘긴 첫 질문에서만 갱신된다.
function buildSystem(): Anthropic.TextBlockParam[] {
  return [
    { type: "text", text: system, cache_control: { type: "ephemeral" } },
    { type: "text", text: `오늘 날짜는 ${todayKST()}야.` },
  ];
}

// 대화 기록. API는 상태가 없어서 매번 전체 기록을 보낸다.
// 함수 밖(모듈 수준)에 두면 질문 사이에도 유지돼서 "후속 질문"이 가능하다.
const messages: Anthropic.MessageParam[] = [];

// ── 모델 라우팅(비용 절감) ──────────────────────────────────────
// 단순 조회는 싸고 빠른 하이쿠로, 분석·추론이 필요한 질문만 상위 모델(소넷)로 올린다.
// 토큰 단가가 몇 배 차이 나므로, 쉬운 질문을 하이쿠로 처리하는 것만으로 비용이 크게 준다.
const MODEL_SIMPLE = "claude-haiku-4-5-20251001"; // 간단 조회용 (쌈)
const MODEL_COMPLEX = "claude-sonnet-4-6"; // 복잡 분석용 (상위 모델)

// 이 단어가 질문에 들어 있으면 "단순 조회를 넘어 분석/추론이 필요하다"고 보고 상위 모델로 올린다.
// 새 단어가 필요하면 여기만 늘리면 된다.
const COMPLEX_HINTS = [
  "분석", "비교", "달성률", "추세", "추이", "패턴", "상관관계", "상관",
  "왜", "이유", "원인", "평가", "추천", "예측", "전망", "인사이트", "개선",
];

// 데이터를 바꾸는(수정/삭제) 의도가 보이면 상위 모델로 올린다.
// 어떤 행을 고치고 지울지 정확히 가려내는 판단이 필요하고, 되돌리기 번거로운 작업이라
// 약한 모델이 빈 칸을 "기록 없음"으로 오판하는 식의 실수를 막는다. (조회/추가는 그대로 Haiku)
const WRITE_HINTS = [
  "삭제", "지워", "지울", "제거", "없애", "수정", "고쳐", "바꿔", "변경",
];

// 질문을 보고 어떤 모델로 처리할지 고른다. (추가 API 호출 없이 키워드만으로 판단 → 비용 0)
function pickModel(question: string): string {
  const needsComplex =
    COMPLEX_HINTS.some((w) => question.includes(w)) ||
    WRITE_HINTS.some((w) => question.includes(w));
  return needsComplex ? MODEL_COMPLEX : MODEL_SIMPLE;
}

// ── 토큰 사용량 모니터링 ──────────────────────────────────────
// 응답마다 usage가 온다. 그걸 더해서 이번 질문/세션 누적 사용량을 보여준다.
//  - input      : 정가로 처리된 입력 토큰
//  - cacheWrite : 캐시에 처음 쓸 때(정가의 ~1.25배). 첫 호출에서만 발생.
//  - cacheRead  : 캐시에서 읽은 토큰(정가의 ~10%). 캐싱이 먹히면 여기로 잡힌다.
//  - output     : 출력 토큰
type Tokens = { input: number; output: number; cacheWrite: number; cacheRead: number };
const session: Tokens = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };

// usage 한 건을 누적 대상(acc)에 더한다.
function addUsage(acc: Tokens, u: Anthropic.Usage): void {
  acc.input += u.input_tokens;
  acc.output += u.output_tokens;
  acc.cacheWrite += u.cache_creation_input_tokens ?? 0;
  acc.cacheRead += u.cache_read_input_tokens ?? 0;
}

// 토큰 사용량을 한 줄로 보기 좋게.
function fmtTokens(t: Tokens): string {
  return `입력 ${t.input} · 캐시읽기 ${t.cacheRead} · 캐시쓰기 ${t.cacheWrite} · 출력 ${t.output}`;
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

// 질문 하나를 받아, Claude가 도구를 다 쓰고 최종 답을 낼 때까지 돌린다.
async function ask(userQuestion: string): Promise<void> {
  messages.push({ role: "user", content: userQuestion });

  // 이번 질문 시작 시점의 날짜로 system을 만든다(도구 루프 내내 동일하게 사용).
  const system = buildSystem();

  // 이번 질문을 처리할 모델을 한 번 정해서, 도구 호출 루프 내내 같은 모델을 쓴다.
  const model = pickModel(userQuestion);
  const label = model === MODEL_COMPLEX ? "Sonnet · 복잡 분석" : "Haiku · 간단 조회";
  console.log(`🤖 모델: ${label}`);

  // 이번 질문에서만 쓴 토큰. (세션 누적과 따로 보여주려고 질문마다 새로 센다.)
  const q: Tokens = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };

  // Claude가 더 이상 도구를 부르지 않을 때까지 반복한다.
  while (true) {
    const response = await anthropic.messages.create({
      model,
      max_tokens: 16000,
      system, // prompt caching: 정적 지시문+tools를 캐시로 묶고, 날짜만 캐시 뒤에 붙여 재전송 비용을 줄인다.
      tools,
      messages: withConversationCache(messages), // 대화 기록도 캐시로 재사용.
    });

    // 이번 호출의 토큰 사용량을 질문별/세션 누적에 둘 다 더한다.
    addUsage(q, response.usage);
    addUsage(session, response.usage);

    // 방금 받은 어시스턴트 응답을 대화 기록에 그대로 추가한다.
    messages.push({ role: "assistant", content: response.content });

    // 도구를 안 불렀다 = 최종 답변이다. 출력하고 끝낸다.
    if (response.stop_reason !== "tool_use") {
      for (const block of response.content) {
        if (block.type === "text") console.log(block.text);
      }
      console.log(`\n📊 이번 질문 토큰 — ${fmtTokens(q)}`);
      return;
    }

    // 도구를 불렀다 = 실행해서 결과를 모은다.
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;

      // 쓰기 도구(삽입/수정)면 실제 실행 전에 무엇을 할지 보여주고 확인을 받는다.
      if (WRITE_TOOLS.has(block.name)) {
        await printWritePreview(block.name, block.input);
        const answer = (await rl.question("실행할까요? (y/N) "))
          .trim()
          .toLowerCase();
        if (answer !== "y" && answer !== "yes") {
          console.log("⏭️  취소했어요.\n");
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: "사용자가 실행을 취소했습니다. 임의로 다시 시도하지 마세요.",
          });
          continue;
        }
      }

      console.log(`🔧 ${block.name}(${JSON.stringify(block.input)})`);
      const result = await runTool(block.name, block.input as any);
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

// "db diet" 처럼 입력하면 그 DB의 스키마(컬럼·타입)를 보여준다.
// 쓰기 전에 "이 DB엔 무슨 칸이 있더라?"를 빠르게 확인하는 용도.
function printDbSchema(name: string): void {
  const schema = schemas[name];
  if (!schema) {
    console.log(`\n알 수 없는 DB: ${name}`);
    console.log(`사용 가능: ${Object.keys(schemas).join(", ")}\n`);
    return;
  }
  console.log(`\n📋 [${name}] 스키마 — 컬럼(타입)`);
  for (const [col, type] of Object.entries(schema.columns)) {
    const mark = type === "title" ? "  ← 제목" : "";
    console.log(`   • ${col} (${type})${mark}`);
  }
  console.log();
}

// 입력할 수 있는 명령어 목록. "help" 칠 때만 보여줘서 평소 화면을 깔끔하게 유지한다.
function printHelp(): void {
  console.log("\n📖 명령어");
  console.log("   help          이 도움말 보기");
  console.log("   db            DB 목록 보기");
  console.log("   db <이름>     그 DB의 컬럼(스키마) 보기");
  console.log("   token         이번 세션 누적 토큰 사용량 보기");
  console.log("   clear         대화 기록·조회 캐시 비우기");
  console.log("   exit          종료 (Ctrl+C 도 가능)");
  console.log("   그 외 입력    질문으로 처리\n");
}

// ── 5) 대화형(REPL) 루프 ────────────────────────────────────────
// 한 번 켜두고 질문을 계속 받는다. "exit"/"quit"/빈 줄이면 종료.
const rl = createInterface({ input: process.stdin, output: process.stdout });

console.log('💬 MyOS 비서 — "help" 로 명령어 보기 (종료: exit)\n');

while (true) {
  const question = (await rl.question("질문> ")).trim();
  if (question === "" || question === "exit" || question === "quit") break;

  // "help" → 명령어 목록.
  if (question === "help") {
    printHelp();
    continue;
  }

  // "clear" → 대화 기록·조회 캐시 비우기. 주제를 바꿀 때 쓰면 토큰(비용)이 다시 가벼워진다.
  if (question === "clear") {
    messages.length = 0; // 배열 내용을 비운다 (const라도 .length=0 은 가능).
    queryCache.clear(); // 조회 캐시도 함께 비운다.
    console.log("\n🧹 대화 기록과 조회 캐시를 비웠어요.\n");
    continue; // ask() 안 부르고 다음 질문으로.
  }

  // "token" → 이번 세션에 쓴 토큰 누적을 보여준다.
  if (question === "token") {
    console.log(`\n📊 세션 누적 토큰 — ${fmtTokens(session)}\n`);
    continue;
  }

  // "db" 또는 "db <이름>" → 스키마 조회 명령. Claude에 안 보내고 바로 처리한다.
  if (question === "db" || question.startsWith("db ")) {
    const name = question.slice(2).trim();
    if (name === "") {
      console.log(`\n사용 가능한 DB: ${Object.keys(schemas).join(", ")}`);
      console.log('예: "db <db 이름>" 처럼 입력하면 그 DB의 컬럼을 보여줍니다.\n');
    } else {
      printDbSchema(name);
    }
    continue;
  }

  console.log(); // 보기 좋게 한 줄 띄우기
  await ask(question);
  console.log();
}

rl.close();
console.log("👋 종료합니다.");
