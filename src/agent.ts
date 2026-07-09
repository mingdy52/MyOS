import Anthropic from "@anthropic-ai/sdk";
import { schemas } from "./notion/schema.js";
// 모든 조회는 이 공용 함수 하나로 처리한다. (예전의 DB별 리더 파일들은 이걸로 대체됨)
import { getRecords } from "./notion/query.js";
import {
  createRecord,
  updateRecord,
  deleteRecord,
  getCurrentValues,
  getRecordSummary,
} from "./notion/mutate.js";
// 모델 라우팅 규칙은 순수 모듈로 분리했다(단위 테스트 대상). model-router.test.ts 참고.
import { pickModel, MODEL_COMPLEX } from "./model-router.js";

// 이 모듈은 "에이전트" — 질문 하나를 받아 Claude가 도구를 다 쓰고 최종 답을 낼 때까지 돌린다.
// 터미널(stdin) 의존은 여기 두지 않는다: 쓰기 확인(y/N)은 confirmWrite 콜백으로 주입받아
// REPL이든 테스트든 원하는 방식으로 확인을 처리할 수 있게 한다(=stdin과 분리).

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
    run: (i) => getRecords("target", { from: i.from, to: i.to }),
  },
  get_diets: {
    description: "식단 기록을 조회한다. 기간(from/to)으로 거를 수 있다.",
    properties: { ...dateRange },
    run: (i) => getRecords("diet", { from: i.from, to: i.to }),
  },
  get_workouts: {
    description: "운동 기록을 조회한다. 기간과 운동 이름(예: 수영)으로 거를 수 있다.",
    properties: {
      ...dateRange,
      exercise: { type: "string", description: '운동 이름 필터. 예: "수영"' },
    },
    run: (i) =>
      getRecords("workout", {
        from: i.from,
        to: i.to,
        ...(i.exercise && { contains: { column: "운동", value: i.exercise } }),
      }),
  },
  get_studies: {
    description: "공부·작업 기록(한 일/시간/집중도/기술)을 조회한다. 기간(from/to)으로 거를 수 있다.",
    properties: { ...dateRange },
    run: (i) => getRecords("study", { from: i.from, to: i.to }),
  },
  get_expenses: {
    description:
      "가계부(소비 내역)를 조회한다. 기간(from/to)과 유형(예: 식비)으로 거를 수 있다. " +
      "금액 합계가 필요하면 조회 결과의 금액을 직접 더해서 계산해.",
    properties: {
      ...dateRange,
      category: { type: "string", description: '유형 필터. 예: "식비"' },
    },
    run: (i) =>
      getRecords("expense", {
        from: i.from,
        to: i.to,
        ...(i.category && { contains: { column: "유형", value: i.category } }),
      }),
  },
  get_diaries: {
    description:
      "일기의 제목·날짜·감정지표(기분/에너지/스트레스)만 조회한다. 기간(from/to)으로 거를 수 있다. " +
      "주의: 일기 '본문'(페이지에 쓴 자유 서술)은 안 들어온다. 본문이 필요하면 get_diary_details를 써라.",
    properties: { ...dateRange },
    // 일기는 본문형(hasBody)이지만, 여기선 감정지표만 필요하므로 withBody=false로 본문을 끈다(빠름).
    run: (i) => getRecords("diary", { from: i.from, to: i.to, withBody: false }),
  },
  get_diary_details: {
    description:
      "일기를 본문(페이지에 직접 쓴 자유 서술)까지 포함해 조회한다. 기간(from/to)으로 거를 수 있다. " +
      "일기 내용에서 결정·사건을 찾는 등 본문이 필요할 때 쓴다. " +
      "일기마다 본문을 따로 읽어 get_diaries보다 느리니 기간을 좁게 잡아라.",
    properties: { ...dateRange },
    run: (i) => getRecords("diary", { from: i.from, to: i.to, withBody: true }),
  },
  get_weights: {
    description: "체중 기록을 조회한다. 기간(from/to)으로 거를 수 있다.",
    properties: { ...dateRange },
    run: (i) => getRecords("weight", { from: i.from, to: i.to }),
  },
  get_decisions: {
    description:
      "의사결정 로그(결정/분야/이유/대안/교훈/만족도)를 조회한다. 기간(from/to)으로 거를 수 있다. " +
      "가치관·판단 패턴을 묻는 질문에 쓴다.",
    properties: { ...dateRange },
    run: (i) => getRecords("decision", { from: i.from, to: i.to }),
  },
  get_techstacks: {
    description: "보유 기술 스택(기술/수준/자신감)을 조회한다. 날짜 개념이 없어 전체를 가져온다.",
    run: () => getRecords("techstack"),
  },
  get_projects: {
    description: "프로젝트 목록(상태/역할/기술/기간)을 조회한다. 날짜 개념이 없어 전체를 가져온다.",
    run: () => getRecords("project"),
  },
  get_applications: {
    description:
      "입사 지원 현황(회사/직무/상태/지원일)을 조회한다. 지원일 기준 기간(from/to)으로 거를 수 있다.",
    properties: { ...dateRange },
    run: (i) => getRecords("application", { from: i.from, to: i.to }),
  },

  // 범용 조회 — 전용 도구(get_diaries 등)가 없는 DB나, 노션에 새로 추가돼
  // 동적 발견으로 잡힌 DB를 이름으로 조회한다. 그 DB에 날짜 컬럼이 있으면
  // 기간(from/to)으로 거르고 최신순 정렬한다(없으면 전체를 가져온다).
  // 전용 도구가 있는 DB는 그쪽이 더 낫다(특수 필터·본문 읽기 등이 있으므로).
  get_records: {
    description:
      "아무 DB나 이름(database)으로 조회하는 범용 도구다. " +
      "전용 도구가 없는 DB나 새로 추가된 DB를 읽을 때 쓴다. " +
      "그 DB에 날짜 컬럼이 있으면 기간(from/to)으로 거를 수 있다. " +
      // [본문] 본문형 DB(제목이 '+'로 끝남)는 자동으로 본문까지 딸려온다 → 보통 withBody를 만질 필요 없다.
      // 표시가 안 된 DB인데 자유 서술 내용이 필요한 예외 상황만 아래처럼 재조회로 커버한다.
      "일기·알고리즘 로그처럼 '페이지 본문'에 자유 서술을 적는 DB는 본문이 자동으로 함께 온다. " +
      "표시되지 않은 DB인데 서술·회고·트레이드오프 같은 본문 내용이 필요한데 조회 결과에 안 보이면(컬럼엔 제목·날짜·분류뿐이면) " +
      "그 DB를 withBody=true로 다시 조회하라. 반대로 본문이 필요 없는 집계·통계엔 withBody=false로 꺼서 빠르게 조회한다. " +
      "쓸 수 있는 DB: " +
      Object.keys(schemas).join(", "),
    properties: {
      database: {
        type: "string",
        enum: Object.keys(schemas),
        description: "조회할 DB 이름",
      },
      ...dateRange,
      withBody: {
        type: "boolean",
        description:
          "true면 각 행의 페이지 본문(자유 서술)까지 읽는다. 본문 내용이 필요한 질문일 때만 켠다.",
      },
    },
    run: (i) =>
      getRecords(i.database, { from: i.from, to: i.to, withBody: i.withBody }),
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
export function todayKST(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }); // "2026-06-18"
}

const system =
  "너는 사용자의 노션 가계부/운동/식단/일기, 그리고 의사결정 로그 데이터를 분석하는 비서야. " +
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
  // 일기 → 의사결정 로그 작성 워크플로우
  // (사용자는 일기를 노션에 직접 쓰고, 비서에서는 명령으로 이 분석을 돌린다.)
  "[일기로 의사결정 로그 만들기] 사용자가 '오늘 일기 분석해서 결정 기록해줘'처럼 요청하면 이렇게 한다: " +
  "(1) get_diary_details로 해당 날짜(보통 오늘)의 일기를 본문까지 읽는다. " +
  "일기의 실제 내용은 '본문' 필드에 있다(get_diaries는 감정지표만 주니 쓰지 마라). 일기는 사용자가 노션에 직접 써 둔 것이다. " +
  "(2) 그 일기 본문에서 사용자가 '내린 결정'을 찾는다. 하루에 결정이 여러 개일 수 있으니 보이는 만큼 다 뽑는다. " +
  "일기는 구어체·오타·이모지·자음 웃음(ㅋㅋ)·줄임말이 많다. 글자 그대로 읽지 말고 '무슨 뜻인지'로 해석해라 " +
  "(예: '하재서'→'하자고 해서', '에1휴'→'에휴', '지원했다ㅋㅋ'→지원하기로 함). 오타가 많아도 맥락으로 결정을 알아내라. " +
  "결정으로 볼 만한 게 없으면 지어내지 말고 '그날 일기엔 기록할 결정이 안 보인다'고 솔직히 답한다. " +
  "(3) 중복 방지: 행을 만들기 전에 get_decisions로 그 날짜의 기존 결정들을 읽어, " +
  "'같은 날짜 + 같은 결정(제목)'이 이미 있으면 그 결정만 건너뛴다. 같은 날이라도 제목이 다른 결정은 새로 추가한다. " +
  "(4) 새 결정마다 create_record(database='decision')로 decision DB 컬럼에 맞춰 채운다 — " +
  "결정(무엇을 하기로 했는지 짧은 제목/title), 분야(커리어·건강·관계·돈·공부 등에서 적절히/select), 날짜(그 일기 날짜), " +
  "이유(왜 그렇게 정했는지), 대안(고려했지만 택하지 않은 선택지), 교훈(있으면), 만족도(일기에서 드러나면; 없으면 비워 둔다). " +
  "(5) 일기 본문에 근거가 있는 내용만 적는다. 추측으로 칸을 억지로 채우지 말고, 모르는 칸은 비워 둔다. " +
  "(6) 단, 로그에 적는 값은 일기 말투를 그대로 베끼지 말고 '깔끔한 표준어'로 정리해서 쓴다 — " +
  "오타는 고치고, 이모지·ㅋㅋ·줄임말·욕설은 빼고, 결정/이유/대안/교훈은 간결한 문장으로 다듬는다. " +
  "(뜻은 일기에 충실하되 표현만 정돈하는 것. 없는 내용을 새로 지어내라는 뜻은 아니다.) " +
  "쓰기는 어차피 시스템이 y/N로 확인하니, 결정을 찾았으면 (각 결정마다 한 번씩) 바로 create_record를 호출해라.";

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
// 모듈 수준에 두면 질문 사이에도 유지돼서 "후속 질문"이 가능하다.
const messages: Anthropic.MessageParam[] = [];

// 대화 기록·조회 캐시를 비운다. REPL의 "clear" 명령이 부른다.
// 주제를 바꿀 때 쓰면 토큰(비용)이 다시 가벼워진다.
export function resetConversation(): void {
  messages.length = 0; // 배열 내용을 비운다 (const라도 .length=0 은 가능).
  queryCache.clear(); // 조회 캐시도 함께 비운다.
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

// 이번 세션 누적 토큰을 한 줄로. REPL의 "token" 명령이 부른다.
export function getSessionSummary(): string {
  return fmtTokens(session);
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

// 쓰기 확인을 어떻게 받을지는 호출자가 정한다(REPL은 stdin y/N).
// promptText를 보여주고 실행 여부(true/false)를 돌려주면 된다.
export type ConfirmWrite = (promptText: string) => Promise<boolean>;

// 질문 하나를 받아, Claude가 도구를 다 쓰고 최종 답을 낼 때까지 돌린다.
// confirmWrite: 쓰기 도구 실행 직전에 사용자 확인을 받는 콜백(주입).
export async function ask(
  userQuestion: string,
  confirmWrite: ConfirmWrite
): Promise<void> {
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
        const ok = await confirmWrite("실행할까요? (y/N) ");
        if (!ok) {
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
