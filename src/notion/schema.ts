// 노션 DB들의 스키마 — "이 DB는 어느 데이터소스이고, 어떤 컬럼이 무슨 타입인지".
// 읽기와 쓰기가 모두 이 표 하나만 본다:
//   - 읽기: buildMap(query.ts)이 컬럼·타입대로 행을 읽어준다.
//   - 쓰기: create_record / update_record(mutate.ts)가 값을 노션 payload로 만든다.

// 노션 속성 타입. props.ts(읽기)·mutate.ts(쓰기)의 분기 기준이 된다.
export type FieldType =
  | "title"
  | "text" // 노션의 rich_text
  | "number"
  | "select"
  | "multi_select"
  | "status"
  | "date"
  | "checkbox";

export type DbSchema = {
  // 노션에 보이는 이 DB의 제목. 동적 발견(discover.ts)이 이 제목으로 역할과 짝을 맞춘다.
  // 이 제목의 DB가 부모 페이지에서 발견되면 dataSourceId·columns는 노션 기준으로 덮어써진다.
  title?: string;
  // 어느 노션 데이터소스에 쓸지. (발견되면 자동 갱신되고, 발견 안 되는 DB는 이 값을 그대로 쓴다.)
  dataSourceId: string;
  // 노션 컬럼명 → 타입. (발견되면 자동 갱신. 아래 값은 오프라인/발견 실패 시의 기본값(seed)이다.)
  columns: Record<string, FieldType>;
  // 본문형 DB인가(페이지 본문에 자유 서술을 적는가). 노션 제목이 '+'로 끝나면 발견 시 자동으로 true.
  // true면 get_records가 기본으로 본문까지 읽는다(일기·알고리즘 로그 등).
  hasBody?: boolean;
};

// database 이름(도구 입력) → 스키마.
// 아래는 "정적 seed"다: 노션 발견이 되면 title로 짝지어 dataSourceId·columns가 갱신되고,
// 부모 페이지 밖에 있어 발견 안 되는 DB(예: 가계부)는 이 값 그대로 동작한다.
// 부모 페이지에서 새로 발견된 DB는 제목을 키로 자동 추가되므로, 여기에 손대지 않아도 된다.
export const schemas: Record<string, DbSchema> = {
  expense: {
    title: "소비: 내 돈은 어디로 갔을까?",
    dataSourceId: process.env.NOTION_EXPENSE_DATA_SOURCE_ID!,
    columns: {
      내역: "title",
      유형: "multi_select",
      메모: "text",
      금액: "number",
      날짜: "date",
      "결제 수단": "multi_select",
      "줄일 수 있었나요?": "checkbox",
    },
  },
  diet: {
    title: "식단",
    dataSourceId: process.env.NOTION_DIET_DATA_SOURCE_ID!,
    columns: {
      날짜: "date",
      식사: "title",
      음식: "text",
    },
  },
  target: {
    title: "목표",
    dataSourceId: process.env.NOTION_TARGET_DATA_SOURCE_ID!,
    columns: {
      목표: "title",
      카테고리: "select",
      목표값: "number",
      단위: "text",
      날짜: "date",
      중요도: "select",
      상태: "status",
    },
  },
  workout: {
    title: "운동",
    dataSourceId: process.env.NOTION_WORKOUT_DATA_SOURCE_ID!,
    columns: {
      날짜: "date",
      운동: "title",
      시간: "number",
      강도: "select",
    },
  },
  study: {
    title: "공부",
    dataSourceId: process.env.NOTION_STUDY_DATA_SOURCE_ID!,
    columns: {
      날짜: "date",
      "한 일": "title", // 만지거나 만든 것 (공부/작업 구분 없이)
      시간: "number",
      집중도: "select",
      기술: "multi_select", // 이 세션에 배우거나 쓴 기술 (techstack DB와 같은 이름 사용)
      메모: "text",
    },
  },
  diary: {
    title: "일기",
    dataSourceId: process.env.NOTION_DIARY_DATA_SOURCE_ID!,
    columns: {
      날짜: "date",
      제목: "title",
      에너지: "select",
      스트레스: "select",
      기분: "text",
    },
  },
  weight: {
    title: "체중",
    dataSourceId: process.env.NOTION_WEIGHT_DATA_SOURCE_ID!,
    columns: {
      날짜: "date",
      체중: "title",
    },
  },
  // 의사결정 로그 — 어떤 선택을 왜 했고, 대안은 뭐였고, 나중에 얼마나 만족했는지.
  // 가치관·판단 패턴을 보려고 쌓는다.
  decision: {
    title: "의사결정",
    dataSourceId: process.env.NOTION_DECISION_DATA_SOURCE_ID!,
    columns: {
      결정: "title",
      분야: "select",
      날짜: "date",
      이유: "text",
      대안: "text",
      교훈: "text",
      만족도: "select",
    },
  },
  techstack: {
    title: "기술 스택",
    dataSourceId: process.env.NOTION_TECHSTACK_DATA_SOURCE_ID!,
    columns: {
      기술: "title",
      수준: "select",
      "프로젝트 경험": "select",
      자신감: "select",
      메모: "text",
    },
  },
  project: {
    title: "프로젝트",
    dataSourceId: process.env.NOTION_PROJECT_DATA_SOURCE_ID!,
    columns: {
      프로젝트: "title",
      상태: "status",
      구분: "select",
      회사: "select",
      역할: "select",
      기술: "multi_select",
      기간: "date",
      메모: "text",
    },
  },
  application: {
    title: "지원 현황",
    dataSourceId: process.env.NOTION_APPLICATION_DATA_SOURCE_ID!,
    columns: {
      회사: "title",
      직무: "select",
      상태: "select",
      지원일: "date",
      메모: "text",
    },
  },
  // 주간 리포트 저장용. 컬럼은 제목(title) 하나뿐이고,
  // AI 분석 요약 본문은 길어서 컬럼이 아니라 페이지 본문에 넣는다(report.ts).
  report: {
    title: "리포트",
    dataSourceId: process.env.NOTION_REPORT_DATA_SOURCE_ID!,
    columns: {
      제목: "title",
    },
  },
};

// ── 시작 시 노션에서 스키마를 동적으로 채운다 ─────────────────────────
// 이 파일을 import 하는 쪽(query/mutate/index)은 top-level await 덕분에
// 스키마가 준비된 "뒤"에야 이어진다. 평소엔 캐시만 읽어 네트워크 0,
// NOTION_PARENT_PAGE_ID가 있고 캐시가 없을 때만 페이지를 한 번 훑는다.
// (schema-sync를 여기서 import하면 순환처럼 보이지만, schema-sync는 이 파일에서
//  '타입'만 가져오므로 런타임 순환이 아니다.)
const { syncSchemas } = await import("./schema-sync.js");
await syncSchemas(schemas);
