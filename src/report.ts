// 리포트 생성 스크립트 (스케줄러용). 주간이 기본, REPORT_PERIOD=month 면 월간.
// 직전 기간 데이터를 모아 → Claude에게 분석 요약을 받고 → 노션 "리포트" DB에 페이지로 저장한다.
// REPL(index.ts)과 달리 사람이 개입하지 않는 1회성 배치다. GitHub Actions가 주기적으로 이 파일을 실행한다.
import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { notion } from "./notion/client.js";
import { schemas } from "./notion/schema.js";
import { getRecords } from "./notion/query.js";
import { reportPeriod } from "./report-period.js";

const anthropic = new Anthropic();
const MODEL = "claude-sonnet-4-6"; // 분석이 필요하니 상위 모델을 쓴다.

// ── 요약문 → 노션 블록 ──────────────────
// Claude가 준 텍스트를 줄 단위로 노션 블록으로 바꾼다.
// "## 제목"은 heading, "- 항목"은 불릿, 나머지는 문단. (노션 rich_text 한 덩어리는 2000자 한도라 1900자로 자른다)
function richText(content: string) {
  return (content.match(/[\s\S]{1,1900}/g) ?? []).map((chunk) => ({
    type: "text" as const,
    text: { content: chunk },
  }));
}
function toBlocks(text: string): any[] {
  const blocks = text
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== "")
    .map((line) => {
      if (/^---+$/.test(line.trim())) return { type: "divider", divider: {} };
      if (line.startsWith("### ")) return { type: "heading_3", heading_3: { rich_text: richText(line.slice(4)) } };
      if (line.startsWith("## ")) return { type: "heading_2", heading_2: { rich_text: richText(line.slice(3)) } };
      if (line.startsWith("# ")) return { type: "heading_1", heading_1: { rich_text: richText(line.slice(2)) } };
      if (/^[-*] /.test(line)) return { type: "bulleted_list_item", bulleted_list_item: { rich_text: richText(line.slice(2)) } };
      return { type: "paragraph", paragraph: { rich_text: richText(line) } };
    });
  // 노션은 한 요청에 블록 100개까지. 넘으면 앞 100개만.
  return blocks.slice(0, 100);
}

async function main() {
  // 주간이 기본, REPORT_PERIOD=month 면 월간(지난달 1일~말일). 기간 계산은 report-period.ts(테스트 있음).
  const monthly = process.env.REPORT_PERIOD === "month";
  const { from: fromStr, to: toStr, title, unit, span } = reportPeriod(new Date(), monthly);

  console.log(`📅 ${monthly ? "월간" : "주간"} 리포트 기간: ${title}`);

  // 리포트에 넣을 DB 목록은 노션이 정한다 — schemas(= 부모 페이지에서 발견된 것)를 그대로 돈다.
  // 노션에 DB를 만들거나 지우면 이 파일은 안 고친다. 예외만 아래 두 집합에 적는다.
  const EXCLUDE = new Set(["report", "media"]); // 리포트 자신 / 기분 처방용 보관함 — 주간 활동 기록이 아니다.
  const FULL = new Set(["target"]);             // 기간 필터 없이 전체. 목표는 계속 유지되는 항목이라 주간 활동과 대조해야 한다.

  // 키는 노션 DB 제목 그대로 쓴다(= 발견된 이름). 새 DB가 코드 수정 없이 제 이름으로 등장한다.
  // 본문은 전부 끈다 — 리포트는 구조화된 컬럼만 보고, 본문까지 넣으면 토큰이 터진다.
  // (일기 본문에 담긴 '무엇을 하기로 했는가'는 의사결정 로그가 대신 채워 준다.)
  const data: Record<string, any> = { 기간: title };
  await Promise.all(
    Object.entries(schemas)
      .filter(([db]) => !EXCLUDE.has(db))
      .map(async ([db, schema]) => {
        const opts = FULL.has(db) ? {} : { from: fromStr, to: toStr };
        data[schema.title ?? db] = await getRecords(db, { ...opts, withBody: false });
      })
  );

  // Claude에게 분석 리포트를 받는다.
  // ponytail: 항목 목록은 data에서 자동 생성되지만, 아래 '의사결정'·'일기'·'지원 현황' 설명 문단은
  // 그 DB들이 있다고 전제한다. 셋 중 하나를 노션에서 지우면 그 문단만 손으로 지워라
  // (문단별 조건부 조립까지는 DB를 실제로 지울 때 하면 된다).
  const system =
    `너는 사용자의 생활 데이터를 분석해 따뜻하고 솔직한 한국어 리포트를 쓰는 코치다.\n` +
    // 항목 목록은 실제로 넘긴 데이터에서 만든다 — 노션에서 지운 DB를 프롬프트가 부르면
    // Claude가 그 DB를 "기록 0건"이라고 나무란다(없는 걸 없다고 혼내는 꼴).
    `주어진 JSON을 근거로만 작성한다. '목표'는 전체 목록이고, 나머지(${Object.keys(data).filter((k) => k !== "기간" && k !== "목표").join("/")})는 지난 ${span}치다. 데이터에 없는 사실을 지어내지 마라.\n` +
    `'의사결정'은 그 ${unit}에 사용자가 내린 결정들을 정리해 둔 로그다(결정/분야/이유/대안/교훈/만족도). ` +
    `'일기'에는 감정지표만 있고 본문이 없으니, 그 ${unit}에 무엇을 하기로 했는지는 이 의사결정 로그에서 읽어라.\n` +
    `'지원 현황'은 그 ${unit}에 넣은 입사 지원이다. 커리어 분야 결정이 실제 행동으로 이어졌는지 여기서 확인한다. ` +
    `다만 지원은 매${unit} 있는 일이 아니니, 0건이라는 것만으로 몰아세우지는 마라 — 그 ${unit}에 '지원하겠다'는 결정이 있었을 때만 대조한다.\n` +
    `다음 마크다운 구조를 정확히 따른다:\n` +
    `## 이번 ${unit} 요약\n(이번 ${unit} 전반을 2~3문장으로)\n` +
    `## 목표 진행률\n- (진행 중인 목표별로, 이번 ${unit}의 실제 활동을 목표값과 대조해 달성률을 추정한다. 예: '주 3회 운동 → 2회 달성(약 67%)'. 계산이 어려우면 '기록 부족으로 추정 불가'라고 적는다. 이미 완료된 목표는 생략)\n` +
    `## 좋은 점\n- (잘한 점들을 불릿으로, 구체적 수치 인용)\n` +
    `## 아쉬운 점\n- (개선이 필요한 점들을 불릿으로)\n` +
    `## 말과 행동의 차이\n` +
    `(의사결정·목표에 적은 '하기로 한 것'과 위 JSON의 '실제 기록'을 대조해, 어긋난 지점을 짚는다. ` +
    `의사결정 로그가 이 대조의 핵심 재료다 — 무엇을 하기로 했는지가 거기 명시돼 있으니, 그것부터 하나씩 실제 기록과 맞춰 봐라. ` +
    `예: '평일 아침 운동하기로 함'이라 적혀 있는데 운동 기록은 주말 1회뿐. ` +
    `결정에 '만족도'나 '교훈'이 적혀 있으면 그것도 함께 본다 — 본인이 이미 아쉬워한 부분은 다시 몰아세우지 말고 짚어만 준다. ` +
    `이 섹션만은 위로하지 말고 냉정하게, 듣기 싫은 진실이라도 피하지 마라. 단 데이터로 입증되는 것만 말하고, 추측으로 몰아세우지는 마라. ` +
    `의사결정 로그가 비어 있으면 목표·감정지표로만 대조하되, '이번 ${unit}은 결정 기록이 없어 대조할 근거가 얇다'고 솔직히 밝힌다. ` +
    `어긋남이 없으면 '이번 ${unit}은 말과 행동이 일치했다'고 솔직히 적는다.)\n` +
    `## 이번 ${unit}, 딱 하나\n` +
    `(다음 ${unit}에 단 하나만 바꾼다면 무엇일지, 영향도가 가장 큰 문제 1개만 고른다. 여러 개 나열 금지. 왜 그것이 가장 중요한지 1~2문장으로 근거를 대고, 당장 실천할 수 있는 구체적 행동 하나로 끝맺는다.)\n` +
    (monthly
      // 한 달치는 주간과 달리 "흐름"이 보인다. 주 단위 등락을 짚으라고 한 줄 더 준다.
      ? `한 달치 데이터이므로, 한 주 한 주의 등락과 월 전반의 추세(나아졌는지 꺾였는지)를 함께 짚어라. 특정 하루의 사건보다 반복되는 패턴을 우선한다.\n`
      : ``) +
    `기록이 거의 없는 항목은 솔직히 '기록이 부족하다'고 짚어준다. 과장하지 말고 담백하게.`;

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system,
    messages: [
      {
        role: "user",
        content: `기간 ${title}의 데이터다. 이걸 분석해 리포트를 써줘.\n\n${JSON.stringify(data, null, 2)}`,
      },
    ],
  });
  const summary = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  if (!summary) throw new Error("Claude가 빈 응답을 반환했습니다.");
  if (response.stop_reason === "max_tokens") {
    console.warn("⚠️ 응답이 max_tokens에 걸려 잘렸을 수 있습니다. max_tokens를 더 올리세요.");
  }

  // 노션 리포트 DB에 페이지를 만든다. (제목=기간, 본문=분석 요약)
  const report = schemas.report;
  if (!report) throw new Error("schema.ts에 report 스키마가 없습니다.");
  const page = await notion.pages.create({
    parent: { type: "data_source_id", data_source_id: report.dataSourceId },
    properties: {
      제목: { title: [{ text: { content: title } }] },
    },
    children: toBlocks(summary),
  });

  console.log(`✅ 리포트 생성 완료: ${(page as any).url ?? page.id}`);
}

main().catch((err) => {
  console.error("❌ 리포트 생성 실패:", err);
  process.exit(1); // 실패를 종료코드로 알려야 GitHub Actions가 빨간불로 표시한다.
});
