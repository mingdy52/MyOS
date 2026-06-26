// 주간 리포트 생성 스크립트 (스케줄러용).
// 지난 7일 데이터를 모아 → Claude에게 분석 요약을 받고 → 노션 "리포트" DB에 페이지로 저장한다.
// REPL(index.ts)과 달리 사람이 개입하지 않는 1회성 배치다. GitHub Actions가 주기적으로 이 파일을 실행한다.
import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { notion } from "./notion/client.js";
import { schemas } from "./notion/schema.js";
import { getTargets } from "./notion/target.js";
import { getExpenses } from "./notion/expense.js";
import { getDietRecords } from "./notion/diet.js";
import { getWorkoutRecords } from "./notion/workout.js";
import { getStudyRecords } from "./notion/study.js";
import { getDiaryRecords } from "./notion/diary.js";
import { getWeightRecords } from "./notion/weight.js";

const anthropic = new Anthropic();
const MODEL = "claude-sonnet-4-6"; // 분석이 필요하니 상위 모델을 쓴다.

// ── 날짜 유틸 ──────────────────────────
// 로컬 시각 기준으로 연/월/일을 0채움해서 돌려준다. (GitHub 러너는 UTC라 일요일 21시 KST = 일요일 12시 UTC)
function parts(d: Date) {
  return {
    y: d.getFullYear(),
    m: String(d.getMonth() + 1).padStart(2, "0"),
    d: String(d.getDate()).padStart(2, "0"),
  };
}
const iso = (d: Date) => { const p = parts(d); return `${p.y}-${p.m}-${p.d}`; };           // 2026-06-10 (노션 필터용)
const korean = (d: Date) => { const p = parts(d); return `${p.y}년 ${p.m}월 ${p.d}일`; }; // 2026년 06월 10일 (제목용)

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
  // 기간: 전주 = 지난주 월요일 ~ 지난주 일요일 (7일)
  // 월요일 새벽에 돌지만, 수동 실행 등 어떤 요일에 돌려도 항상 "직전 완결된 한 주"가 잡히도록
  // 오늘 요일을 기준으로 이번 주 월요일을 구한 뒤, 거기서 한 주 앞으로 물러난다.
  // getDay(): 0=일 1=월 … 6=토. (월요일까지의 거리) = (getDay()+6)%7  → 월=0, 일=6
  const now = new Date();
  const daysSinceMonday = (now.getDay() + 6) % 7;
  const to = new Date(now);
  to.setDate(now.getDate() - daysSinceMonday - 1); // 지난주 일요일 (이번 주 월요일 - 1)
  const from = new Date(to);
  from.setDate(to.getDate() - 6);                  // 지난주 월요일
  const fromStr = iso(from);
  const toStr = iso(to);
  const title = `${korean(from)} ~ ${korean(to)}`;

  console.log(`📅 리포트 기간: ${title}`);

  // 지난 7일 데이터를 한 번에 모은다.
  // 목표(targets)만은 기간 필터 없이 전체를 가져온다 — 목표는 계속 유지되는 항목이라,
  // 이번 주 활동과 대조해 진행률을 추정하는 데 쓴다.
  const [targets, expenses, diet, workout, study, diary, weight] = await Promise.all([
    getTargets(),
    getExpenses(fromStr, toStr),
    getDietRecords(fromStr, toStr),
    getWorkoutRecords(fromStr, toStr),
    getStudyRecords(fromStr, toStr),
    getDiaryRecords(fromStr, toStr),
    getWeightRecords(fromStr, toStr),
  ]);
  const data = { 기간: title, 목표: targets, 지출: expenses, 식단: diet, 운동: workout, 공부: study, 일기: diary, 체중: weight };

  // Claude에게 분석 리포트를 받는다.
  const system =
    "너는 사용자의 주간 생활 데이터를 분석해 따뜻하고 솔직한 한국어 리포트를 쓰는 코치다.\n" +
    "주어진 JSON을 근거로만 작성한다. '목표'는 전체 목록이고, 나머지(지출/식단/운동/공부/일기/체중)는 지난 7일치다. 데이터에 없는 사실을 지어내지 마라.\n" +
    "다음 마크다운 구조를 정확히 따른다:\n" +
    "## 이번 주 요약\n(이번 주 전반을 2~3문장으로)\n" +
    "## 목표 진행률\n- (진행 중인 목표별로, 이번 주 실제 활동을 목표값과 대조해 달성률을 추정한다. 예: '주 3회 운동 → 2회 달성(약 67%)'. 계산이 어려우면 '기록 부족으로 추정 불가'라고 적는다. 이미 완료된 목표는 생략)\n" +
    "## 좋은 점\n- (잘한 점들을 불릿으로, 구체적 수치 인용)\n" +
    "## 아쉬운 점\n- (개선이 필요한 점들을 불릿으로)\n" +
    "## 말과 행동의 차이\n" +
    "(일기·목표에 적은 '말·다짐'과 운동·식단·공부·지출 '기록'을 대조해, 어긋난 지점을 짚는다. 예: 일기엔 '이번 주 운동 빡세게'라 썼는데 기록은 1회뿐. 이 섹션만은 위로하지 말고 냉정하게, 듣기 싫은 진실이라도 피하지 마라. 단 데이터로 입증되는 것만 말하고, 추측으로 몰아세우지는 마라. 어긋남이 없으면 '이번 주는 말과 행동이 일치했다'고 솔직히 적는다.)\n" +
    "## 이번 주, 딱 하나\n" +
    "(다음 주에 단 하나만 바꾼다면 무엇일지, 영향도가 가장 큰 문제 1개만 고른다. 여러 개 나열 금지. 왜 그것이 가장 중요한지 1~2문장으로 근거를 대고, 당장 실천할 수 있는 구체적 행동 하나로 끝맺는다.)\n" +
    "기록이 거의 없는 항목은 솔직히 '기록이 부족하다'고 짚어준다. 과장하지 말고 담백하게.";

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
