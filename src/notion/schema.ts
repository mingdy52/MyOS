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
  // 어느 노션 데이터소스에 쓸지.
  dataSourceId: string;
  // 노션 컬럼명 → 타입. (컬럼명은 노션에 보이는 그대로, 띄어쓰기까지 정확히 적는다.)
  columns: Record<string, FieldType>;
};

// database 이름(도구 입력) → 스키마.
// 새 DB는 여기에 한 덩어리만 추가하면 읽기·쓰기 도구가 자동으로 지원한다.
export const schemas: Record<string, DbSchema> = {
  expense: {
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
    dataSourceId: process.env.NOTION_DIET_DATA_SOURCE_ID!,
    columns: {
      날짜: "date",
      식사: "title",
      음식: "text",
    },
  },
  target: {
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
    dataSourceId: process.env.NOTION_WORKOUT_DATA_SOURCE_ID!,
    columns: {
      날짜: "date",
      운동: "title",
      시간: "text",
      강도: "select",
    },
  },
  study: {
    dataSourceId: process.env.NOTION_STUDY_DATA_SOURCE_ID!,
    columns: {
      날짜: "date",
      과목: "title",
      시간: "number",
      집중도: "select",
      메모: "text",
    },
  },
  diary: {
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
    dataSourceId: process.env.NOTION_WEIGHT_DATA_SOURCE_ID!,
    columns: {
      날짜: "date",
      체중: "title",
    },
  },
  techstack: {
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
    dataSourceId: process.env.NOTION_REPORT_DATA_SOURCE_ID!,
    columns: {
      제목: "title",
    },
  },
};
