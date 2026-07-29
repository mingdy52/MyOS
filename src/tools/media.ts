import { getRecords } from "../notion/query.js";
import { createRecord, deleteRecord } from "../notion/mutate.js";
import { schemas } from "../notion/schema.js";
import { printWritePreview } from "./notion.js";
import type { ToolRegistry } from "../agent/types.js";

// ── 콘텐츠 도구 모음 ──────────────────────────────────────────
// Media Agent만 쓰는 도구들. 노션 "콘텐츠" DB 하나만 만진다.
//
// 왜 범용 create_record/get_records를 안 쓰고 전용 도구를 두는가:
// 서브에이전트에겐 자기 도메인 도구만 쥐여 주는 게 원칙이다. 그래야
//  (1) 실수로 가계부를 지우는 일이 구조적으로 불가능하고,
//  (2) 도구 설명이 "콘텐츠 DB에선 이 컬럼을 이렇게 쓴다"까지 구체적으로 적힐 수 있다.

// 감정 라벨은 자유 입력이지만, 저장할 때마다 말이 달라지면 나중에 검색이 안 된다
// (예: "우울" / "우울함" / "다운"). 그래서 권장 목록을 도구 설명에 박아 통일시킨다.
const EMOTIONS = ["우울", "불안", "지침", "외로움", "화남", "무기력", "기쁨", "평온"];
const KINDS = ["영상", "음악", "사진", "글귀", "ASMR"];

// 노션에 "콘텐츠" DB가 아직 없으면 dataSourceId가 비어 있다.
// 그대로 조회하면 노션 SDK 오류 문구가 그대로 튀어나와 무엇이 문제인지 알기 어려우니,
// 도구 앞에서 미리 걸러 사람이 읽을 수 있는 안내로 바꿔 준다.
function missingDb(): string | null {
  if (schemas.media?.dataSourceId) return null;
  return (
    "노션에 '콘텐츠' DB가 아직 없다(또는 아직 발견되지 않았다). " +
    "사용자에게 이렇게 안내해라: 데이터 부모 페이지에 '콘텐츠' DB를 만들고 " +
    "컬럼을 제목(title)·URL(텍스트)·유형(선택)·감정(다중 선택)·태그(다중 선택)·메모(텍스트)로 둔 뒤 " +
    "비서에서 refresh 명령을 실행하면 된다."
  );
}

// 콘텐츠 한 행이 조회 결과로 나올 때의 모양. (노션 컬럼명 그대로)
// 날짜 컬럼은 없다 — 이 DB는 "언제 저장했나"보다 "무엇에 잘 듣나"가 중요해서다.
type MediaRow = {
  id: string;
  제목?: string;
  URL?: string;
  유형?: string;
  감정?: string[];
  태그?: string[];
  메모?: string;
};

// 값이 배열이든 문자열이든 문자열 배열로 맞춘다.
// (노션 multi_select는 배열로 오지만, 비어 있으면 undefined일 수 있다.)
const asList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(String) : v ? [String(v)] : [];

// 저장된 콘텐츠가 조건(감정/유형/태그)에 맞는지 본다.
// 노션 필터는 한 번에 한 조건만 걸기 편해서, 조건 조합은 여기 JS에서 처리한다.
// (보관함은 수백 건 수준이라 전체를 받아 거르는 편이 단순하고 충분히 빠르다.)
function matches(
  row: MediaRow,
  want: { emotion?: string; kind?: string; tag?: string }
): boolean {
  if (want.emotion && !asList(row.감정).includes(want.emotion)) return false;
  if (want.kind && row.유형 !== want.kind) return false;
  if (want.tag) {
    const hay = [...asList(row.태그), row.제목 ?? ""].join(" ");
    if (!hay.includes(want.tag)) return false;
  }
  return true;
}

export const mediaTools: ToolRegistry = {
  list_media: {
    description:
      "저장해 둔 콘텐츠를 조회한다. 조건 없이 부르면 전부 가져온다. " +
      "감정(emotion)·유형(kind)·태그(tag)로 거를 수 있고, 조건은 함께 쓸 수 있다. " +
      "여기 있는 것은 모두 사용자가 직접 저장한, 이미 검증된 콘텐츠다 — 새로 찾은 것보다 우선해서 추천해라. " +
      "추천을 하려면 먼저 이 도구로 후보를 확인해야 한다 — 저장되지 않은 콘텐츠를 지어내면 안 된다. " +
      `감정 값: ${EMOTIONS.join(", ")} / 유형 값: ${KINDS.join(", ")}`,
    properties: {
      emotion: {
        type: "string",
        enum: EMOTIONS,
        description: "이 감정에 잘 듣는 것만 고른다",
      },
      kind: { type: "string", enum: KINDS, description: "콘텐츠 유형 필터" },
      tag: {
        type: "string",
        description: '태그·제목에 이 낱말이 들어간 것만. 예: "강아지"',
      },
    },
    run: async (i) => {
      const missing = missingDb();
      if (missing) return missing;
      const rows: MediaRow[] = await getRecords("media");
      // 제목도 링크도 없는 행은 노션에서 실수로 생긴 빈 줄이다. 추천 후보가 될 수 없으니 뺀다.
      const real = rows.filter((r) => r.제목 || r.URL);
      return real.filter((r) => matches(r, i));
    },
  },

  save_media: {
    description:
      "새 콘텐츠를 보관함에 저장한다. " +
      "감정(emotions)과 태그(tags)는 사용자가 지정하지 않았으면 제목·URL·설명을 보고 네가 직접 판단해 채워라 — " +
      "나중에 감정으로 찾아 쓰려면 이 라벨이 붙어 있어야 한다. " +
      "저장 전에 list_media로 같은 URL이 이미 있는지 확인하고, 있으면 저장하지 말고 그렇다고 답해라. " +
      "저장한다는 건 '사용자가 이걸 좋아했다'는 뜻이다. 사용자가 마음에 들어 한 것만 저장해라. " +
      `감정 값은 이 목록에서 고른다(여러 개 가능): ${EMOTIONS.join(", ")}. ` +
      `유형 값: ${KINDS.join(", ")}`,
    properties: {
      title: { type: "string", description: "콘텐츠 제목. 없으면 내용을 요약해 짧게 지어라" },
      url: { type: "string", description: "링크 주소" },
      kind: { type: "string", enum: KINDS, description: "콘텐츠 유형" },
      emotions: {
        type: "array",
        items: { type: "string", enum: EMOTIONS },
        description: "이 콘텐츠가 위로가 되는 감정들",
      },
      tags: {
        type: "array",
        items: { type: "string" },
        description: '내용 태그. 예: ["강아지", "잔잔함"]',
      },
      note: { type: "string", description: "메모(선택)" },
    },
    isWrite: true,
    // 노션 쓰기 미리보기를 그대로 재사용한다(create_record와 같은 모양으로 넘겨준다).
    preview: (i) =>
      printWritePreview("create", { database: "media", fields: toFields(i) }),
    run: async (i) => missingDb() ?? createRecord("media", toFields(i)),
  },

  delete_media: {
    description:
      "보관함에서 콘텐츠를 하나 지운다(노션 휴지통으로 가며 복구 가능). " +
      "사용자가 저장해 둔 걸 보고 '별로였다'고 하면 이걸로 뺀다. " +
      "먼저 list_media로 지울 항목의 id를 정확히 확인한 뒤 부른다.",
    properties: {
      id: { type: "string", description: "지울 항목의 id (list_media 결과에 있다)" },
    },
    isWrite: true,
    preview: (i) => printWritePreview("delete", { database: "media", id: i.id }),
    run: (i) => deleteRecord("media", i.id),
  },
};

// 도구 입력(영문 키) → 노션 컬럼(한글 키)으로 옮긴다.
// 도구 입력을 영문으로 둔 이유: Claude가 스키마를 덜 헷갈리고, 컬럼명이 바뀌어도 여기만 고치면 된다.
function toFields(i: any): Record<string, any> {
  return {
    제목: i.title,
    URL: i.url,
    ...(i.kind && { 유형: i.kind }),
    ...(i.emotions?.length && { 감정: i.emotions }),
    ...(i.tags?.length && { 태그: i.tags }),
    ...(i.note && { 메모: i.note }),
  };
}
