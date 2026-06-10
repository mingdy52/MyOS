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
import { createRecord, updateRecord } from "./notion/mutate.js";

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
    description: "공부 기록(과목/시간/집중도)을 조회한다. 기간(from/to)으로 거를 수 있다.",
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

// ── 3) 도구 실행기 ──────────────────────────────────────────────
// Claude가 "이 도구를 이 입력으로 불러줘"라고 하면, registry에서 찾아 실행한다.
async function runTool(name: string, input: any): Promise<string> {
  const tool = registry[name];
  if (!tool) return `알 수 없는 도구: ${name}`;
  try {
    const data = await tool.run(input);
    return JSON.stringify(data);
  } catch (e: any) {
    // 오류도 문자열로 돌려주면 REPL이 죽지 않고 Claude가 보고 고쳐 시도한다.
    return `오류: ${e?.message ?? String(e)}`;
  }
}

// 데이터를 바꾸는(위험한) 도구들. 실행 전에 사용자 확인을 받는다.
const WRITE_TOOLS = new Set(["create_record", "update_record"]);

// ── 4) 에이전트: 질문 하나를 끝까지 처리 ────────────────────────
const today = new Date().toISOString().slice(0, 10); // "2026-06-03"

const system =
  "너는 사용자의 노션 가계부/운동/식단 데이터를 분석하는 비서야. " +
  `오늘 날짜는 ${today}야. "이번달", "지난주" 같은 표현은 오늘을 기준으로 ` +
  "실제 날짜 범위(YYYY-MM-DD)로 바꿔서 도구를 호출해. " +
  "답에 필요한 데이터가 있으면 사용자에게 물어보지 말고, 관련 도구를 알아서 모두 호출해서 먼저 확인해. " +
  "조회(읽기)는 허락 없이 마음껏 해도 된다. " +
  '예를 들어 "목표 달성률"을 물으면 목표를 가져온 뒤, 그 목표와 관련된 ' +
  "운동·공부·체중·식단 등 기록도 스스로 조회해서 비교한다. " +
  '"~을 확인해 볼까요?" 같은 되묻기로 끝내지 말고, 직접 확인한 결과로 답해. ' +
  "데이터를 조회한 뒤에는 사람이 읽기 좋게 요약해서 한국어로 답해. " +
  // 쓰기 안내
  "데이터를 추가/수정할 때는 create_record / update_record 도구를 쓴다. " +
  "수정(update_record)하려면 먼저 get_* 로 읽어서 그 행의 id를 알아낸 뒤 id로 호출해라. " +
  "쓰기는 실행 직전에 사용자가 y/N로 확인하니, 무엇을 어떤 값으로 넣거나 바꿀지 한국어로 분명히 먼저 말해라.";

// 대화 기록. API는 상태가 없어서 매번 전체 기록을 보낸다.
// 함수 밖(모듈 수준)에 두면 질문 사이에도 유지돼서 "후속 질문"이 가능하다.
const messages: Anthropic.MessageParam[] = [];

// 질문 하나를 받아, Claude가 도구를 다 쓰고 최종 답을 낼 때까지 돌린다.
async function ask(userQuestion: string): Promise<void> {
  messages.push({ role: "user", content: userQuestion });

  // Claude가 더 이상 도구를 부르지 않을 때까지 반복한다.
  while (true) {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 16000,
      system,
      tools,
      messages,
    });

    // 방금 받은 어시스턴트 응답을 대화 기록에 그대로 추가한다.
    messages.push({ role: "assistant", content: response.content });

    // 도구를 안 불렀다 = 최종 답변이다. 출력하고 끝낸다.
    if (response.stop_reason !== "tool_use") {
      for (const block of response.content) {
        if (block.type === "text") console.log(block.text);
      }
      return;
    }

    // 도구를 불렀다 = 실행해서 결과를 모은다.
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;

      // 쓰기 도구(삽입/수정)면 실제 실행 전에 무엇을 할지 보여주고 확인을 받는다.
      if (WRITE_TOOLS.has(block.name)) {
        console.log(
          `\n✍️  쓰기 요청: ${block.name}(${JSON.stringify(block.input)})`
        );
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

// ── 5) 대화형(REPL) 루프 ────────────────────────────────────────
// 한 번 켜두고 질문을 계속 받는다. "exit"/"quit"/빈 줄이면 종료.
const rl = createInterface({ input: process.stdin, output: process.stdout });

console.log("💬 MyOS 비서 (종료: exit 또는 Ctrl+C)\n");

while (true) {
  const question = (await rl.question("질문> ")).trim();
  if (question === "" || question === "exit" || question === "quit") break;

  // 대화 기록 초기화. 주제를 바꿀 때 쓰면 토큰(비용)이 다시 가벼워진다.
  if (question === "clear" || question === "초기화") {
    messages.length = 0; // 배열 내용을 비운다 (const라도 .length=0 은 가능).
    console.log("\n🧹 대화 기록을 비웠어요.\n");
    continue; // ask() 안 부르고 다음 질문으로.
  }

  console.log(); // 보기 좋게 한 줄 띄우기
  await ask(question);
  console.log();
}

rl.close();
console.log("👋 종료합니다.");
