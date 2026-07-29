import { schemas } from "../notion/schema.js";
// 모든 조회는 이 공용 함수 하나로 처리한다. (예전의 DB별 리더 파일들은 이걸로 대체됨)
import { getRecords } from "../notion/query.js";
import {
  createRecord,
  updateRecord,
  deleteRecord,
  getCurrentValues,
  getRecordSummary,
} from "../notion/mutate.js";
import type { ToolRegistry } from "../agent/types.js";

// ── 노션 도구 모음 ────────────────────────────────────────────
// 무엇을 언제 부를지 판단하는 건 Personal Agent(agent/personal.ts)의 몫이다.

// 거의 모든 도구가 공유하는 기간 필터. 한 번만 정의해서 재사용한다.
const dateRange = {
  from: { type: "string", description: '시작 날짜, "YYYY-MM-DD" 형식' },
  to: { type: "string", description: '끝 날짜, "YYYY-MM-DD" 형식' },
} as const;

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

// 쓰기 도구 설명에 끼워 넣을 DB별 컬럼 안내.
const schemaHint = buildSchemaHint();

// 값 하나를 사람이 읽기 좋은 문자열로. (빈 값은 "(없음)", 배열은 쉼표로)
function fmtValue(v: any): string {
  if (v === undefined || v === null || v === "") return "(없음)";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "(없음)";
  return String(v);
}

// 쓰기 도구를 실행하기 직전에, 무엇을 어떤 값으로 넣거나 바꿀지 보기 좋게 출력한다.
// create: "컬럼: 값", update: "컬럼: 기존값 → 새값"(기존값은 노션에서 읽어와 비교).
// export한 이유: Media Agent처럼 다른 도메인의 쓰기 도구도 같은 미리보기를 그대로 쓴다.
export async function printWritePreview(
  kind: "create" | "update" | "delete",
  input: any
): Promise<void> {
  const fields: Record<string, any> = input.fields ?? {};

  if (kind === "delete") {
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

  if (kind === "create") {
    console.log(`\n✍️  [${input.database}]에 새 행을 추가합니다:`);
    for (const [col, value] of Object.entries(fields)) {
      console.log(`   • ${col}: ${fmtValue(value)}`);
    }
    return;
  }

  console.log(`\n✍️  [${input.database}] 행을 수정합니다 (id: ${input.id}):`);
  // 바뀔 컬럼들의 현재 값을 읽어와 "기존 → 새 값"으로 보여준다.
  let current: Record<string, any> = {};
  try {
    current = await getCurrentValues(input.database, input.id, Object.keys(fields));
  } catch {
    // 현재 값을 못 읽어도 새 값만이라도 보여준다.
  }
  for (const [col, value] of Object.entries(fields)) {
    console.log(`   • ${col}: ${fmtValue(current[col])} → ${fmtValue(value)}`);
  }
}

export const notionTools: ToolRegistry = {
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
    isWrite: true,
    preview: (i) => printWritePreview("create", i),
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
    isWrite: true,
    preview: (i) => printWritePreview("update", i),
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
    isWrite: true,
    preview: (i) => printWritePreview("delete", i),
    run: (i) => deleteRecord(i.database, i.id),
  },
};
