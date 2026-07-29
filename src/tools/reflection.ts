import { getRecords } from "../notion/query.js";
import { createRecord } from "../notion/mutate.js";
import { printWritePreview } from "./notion.js";
import type { ToolRegistry } from "../agent/types.js";

// ── 회고 도구 모음 ────────────────────────────────────────────
// Reflection Agent만 쓰는 도구들. 일기를 읽고 의사결정 로그를 남기는 데 필요한 것만 있다.
//
// Personal의 노션 도구와 겹쳐 보이지만(get_diary_details 등) 일부러 따로 둔다.
// 서브에이전트에게는 자기 도메인 도구만 쥐여 주는 게 원칙이고, 그래야
// 회고하다가 실수로 가계부를 지우는 일이 구조적으로 불가능해진다.
// 여기엔 쓰기 도구가 딱 하나(add_decision) 있고, 그것도 decision DB만 건드린다.

const dateRange = {
  from: { type: "string", description: '시작 날짜, "YYYY-MM-DD" 형식' },
  to: { type: "string", description: '끝 날짜, "YYYY-MM-DD" 형식' },
} as const;

// 의사결정 로그의 분야. 자유 입력으로 두면 "커리어"/"진로"/"일"처럼 말이 갈려서
// 나중에 분야별로 모아 보는 게 불가능해진다. 그래서 목록을 고정한다.
const FIELDS = ["커리어", "건강", "관계", "돈", "공부", "생활"];

export const reflectionTools: ToolRegistry = {
  read_diaries: {
    description:
      "일기를 본문까지 읽는다. 회고의 출발점이라 대부분의 작업이 이 도구로 시작한다. " +
      "일기의 실제 내용은 '본문' 필드에 있다(컬럼에는 날짜·제목·감정지표만 있다). " +
      "일기마다 본문을 따로 읽어 느리니 기간을 좁게 잡아라.",
    properties: { ...dateRange },
    run: (i) => getRecords("diary", { from: i.from, to: i.to, withBody: true }),
  },

  read_moods: {
    description:
      "일기의 감정지표(기분/에너지/스트레스)만 빠르게 조회한다. 본문은 안 들어온다. " +
      "여러 주에 걸친 감정 추이를 볼 때처럼, 본문 없이 숫자만 필요할 때 쓴다. " +
      "본문 내용이 필요하면 read_diaries를 써라.",
    properties: { ...dateRange },
    run: (i) => getRecords("diary", { from: i.from, to: i.to, withBody: false }),
  },

  read_decisions: {
    description:
      "이미 기록해 둔 의사결정 로그를 조회한다. " +
      "새 결정을 추가하기 전 중복 확인에 쓰고, 판단 성향·후회 패턴을 볼 때도 쓴다.",
    properties: { ...dateRange },
    run: (i) => getRecords("decision", { from: i.from, to: i.to }),
  },

  add_decision: {
    description:
      "의사결정 로그에 새 결정을 하나 추가한다. 결정마다 한 번씩 부른다. " +
      "부르기 전에 반드시 read_decisions로 '같은 날짜 + 같은 결정'이 이미 있는지 확인해라. " +
      "일기 본문에 근거가 있는 칸만 채우고, 모르는 칸은 비워 둔다(추측으로 채우지 마라). " +
      `분야는 이 중에서 고른다: ${FIELDS.join(", ")}.`,
    properties: {
      decision: {
        type: "string",
        description: "무엇을 하기로 했는지 짧은 제목. 예: \"전주 회사에 지원하기로 함\"",
      },
      field: { type: "string", enum: FIELDS, description: "어느 분야의 결정인지" },
      date: { type: "string", description: '그 일기의 날짜 "YYYY-MM-DD"' },
      reason: { type: "string", description: "왜 그렇게 정했는지" },
      alternative: { type: "string", description: "고려했지만 택하지 않은 선택지(있으면)" },
      lesson: { type: "string", description: "그 일에서 얻은 교훈(있으면)" },
      satisfaction: {
        type: "string",
        description: "결정에 대한 만족도가 일기에 드러나면. 안 드러나면 비워 둔다",
      },
    },
    isWrite: true,
    preview: (i) =>
      printWritePreview("create", { database: "decision", fields: toFields(i) }),
    run: (i) => createRecord("decision", toFields(i)),
  },
};

// 도구 입력(영문 키) → 노션 컬럼(한글 키).
// 값이 없는 칸은 아예 넣지 않는다 — 빈 문자열을 넣으면 노션에 빈 값이 '기록'되고,
// "안 적은 것"과 "없다고 적은 것"이 구분되지 않는다.
function toFields(i: any): Record<string, any> {
  return {
    결정: i.decision,
    ...(i.field && { 분야: i.field }),
    ...(i.date && { 날짜: i.date }),
    ...(i.reason && { 이유: i.reason }),
    ...(i.alternative && { 대안: i.alternative }),
    ...(i.lesson && { 교훈: i.lesson }),
    ...(i.satisfaction && { 만족도: i.satisfaction }),
  };
}
