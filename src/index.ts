import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { schemas } from "./notion/schema.js";
import { syncSchemas } from "./notion/schema-sync.js";
// 에이전트는 agent/ 아래로 분리했다.
//   agent/core.ts     — 도구 루프 엔진(도메인 무관)
//   agent/personal.ts — 사용자와 대화하는 오케스트레이터. ask()가 여기 있다.
//   agent/media.ts    — 콘텐츠 담당 서브에이전트
// 이 파일은 대화형(REPL) 껍데기 — 입력을 받아 명령을 가르고, 질문은 ask()에 넘긴다.
import { ask, resetConversation } from "./agent/personal.js";
import { getSessionSummary, todayKST } from "./agent/core.js";
// "/diet" 전용 파이프라인(사진 분석 → 음식 칸 채우기 / 빈 페이지 삭제)은 diet.ts에 있다.
import { runDiet } from "./diet.js";

// ── 대화형(REPL) 루프 ────────────────────────────────────────
// 한 번 켜두고 질문을 계속 받는다. "exit"/"quit"/빈 줄이면 종료.
const rl = createInterface({ input: process.stdin, output: process.stdout });

// 쓰기 도구 실행 직전 확인(y/N)을 stdin으로 받는 콜백. ask()에 주입한다.
// (에이전트는 stdin을 직접 알지 않고, 확인 방식만 이 콜백으로 위임받는다.)
async function confirmWrite(promptText: string): Promise<boolean> {
  const answer = (await rl.question(promptText)).trim().toLowerCase();
  return answer === "y" || answer === "yes";
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
  console.log("   /decide              오늘 일기를 분석해 의사결정 로그 작성");
  console.log("   /decide <날짜>       그 날짜(YYYY-MM-DD) 일기로 작성");
  console.log("   /decide <부터> <까지> 그 기간 일기를 몰아서 작성");
  console.log("   /diet         음식 칸이 빈 식단 페이지의 사진을 분석해 음식 입력");
  console.log("                 (사진 없는 빈 페이지는 삭제, 둘 다 y/N 확인)");
  console.log("   token         이번 세션 누적 토큰 사용량 보기");
  console.log("   refresh       노션에서 DB 스키마 다시 발견(새 DB·컬럼 반영)");
  console.log("   clear         대화 기록·조회 캐시 비우기");
  console.log("   exit          종료 (Ctrl+C 도 가능)");
  console.log("   그 외 입력    질문으로 처리\n");
}

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
    resetConversation();
    console.log("\n🧹 대화 기록과 조회 캐시를 비웠어요.\n");
    continue; // ask() 안 부르고 다음 질문으로.
  }

  // "token" → 이번 세션에 쓴 토큰 누적을 보여준다.
  if (question === "token") {
    console.log(`\n📊 세션 누적 토큰 — ${getSessionSummary()}\n`);
    continue;
  }

  // "refresh" → 노션 부모 페이지를 다시 훑어 스키마 캐시를 갱신한다.
  // 노션에서 DB를 새로 만들었거나 컬럼을 바꿨을 때만 쓰면 된다(평소엔 캐시라 네트워크 0).
  // 이미 만들어진 조회/쓰기 도구 설명(enum)은 다음 실행부터 새 DB를 반영한다.
  if (question === "refresh") {
    console.log();
    await syncSchemas(schemas, { refresh: true });
    console.log(`\n📋 현재 DB: ${Object.keys(schemas).join(", ")}`);
    console.log("   (새로 생긴 DB를 조회/쓰기 도구에도 노출하려면 한 번 재시작하세요.)\n");
    continue;
  }

  // "/decide" 또는 "/decide <YYYY-MM-DD>" → 그날 일기를 분석해 의사결정 로그를 작성한다.
  // 일기는 노션에 직접 써 두고, 이 명령으로 분석만 돌린다. (인자 없으면 오늘)
  // 결국 ask()에 정해진 질문을 흘려보내는 단축키라, 도구 호출·쓰기 y/N 확인 흐름을 그대로 탄다.
  if (question === "/decide" || question.startsWith("/decide ")) {
    // 인자 0개 → 오늘 하루, 1개 → 그날 하루, 2개 → from~to 기간(밀린 일기 몰아서 처리).
    const args = question.slice("/decide".length).trim().split(/\s+/).filter(Boolean);
    const from = args[0] || todayKST();
    const to = args[1] || from;
    const span = from === to ? `${from} 일기를` : `${from}부터 ${to}까지의 일기를`;
    const prompt =
      `${span} get_diary_details로 본문까지 읽고 분석해서, 그동안 내가 내린 결정들을 ` +
      `의사결정 로그(decision)에 기록해줘. 하루에 결정이 여러 개면 다 뽑되, ` +
      `같은 날 같은 결정(제목)이 이미 있으면 그건 건너뛰어.`;
    console.log();
    await ask(prompt, confirmWrite);
    console.log();
    continue;
  }

  // "/diet" → 식단 DB에서 음식 칸이 빈 페이지를 훑는다.
  // 페이지 안 사진이 있으면 분석해 '음식'을 채우고, 없으면 껍데기로 보고 삭제한다(둘 다 y/N 확인).
  if (question === "/diet") {
    console.log();
    await runDiet(confirmWrite);
    console.log();
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
  await ask(question, confirmWrite);
  console.log();
}

rl.close();
console.log("👋 종료합니다.");
