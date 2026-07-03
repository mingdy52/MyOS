// 포트폴리오 "초안" 생성 스크립트 (수동 실행, 가끔).
// 두 종류의 소스를 합쳐 src/content/portfolio.json 을 만든다:
//   1) 프로젝트 페이지 "본문" → 그대로 HTML로 변환해 상세(detailHtml)로. (본인 글, AI가 안 건드림)
//   2) Claude → 자기소개·기술 카테고리·카드용 한 줄 요약/하이라이트만 가공.
// 사람이 읽고 고친 뒤 커밋하면, 배포(site.ts)는 이 확정본만 렌더한다.
import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { writeFile, mkdir } from "node:fs/promises";
import { getRecords } from "./notion/query.js";
import { renderPageHtml } from "./notion/render.js";

const anthropic = new Anthropic();
const MODEL = "claude-sonnet-4-6";
const OUT = "src/content/portfolio.json";

// "2025-08-01 ~ 2026-02-28" / "2026-06-02" → 시작일 문자열(정렬용).
const startOf = (period: string) => String(period ?? "").slice(0, 10);

async function main() {
  console.log("📡 노션 원본을 불러오는 중...");
  // 프로젝트는 본문형(프로젝트+)이지만 상세 본문은 아래 renderPageHtml로 따로 받으므로
  // 여기선 본문을 끈다(withBody:false) — 중복 조회·불필요한 호출 방지.
  const [techstack, projects] = await Promise.all([
    getRecords("techstack"),
    getRecords("project", { withBody: false }),
  ]);
  console.log(`   기술 ${techstack.length}개 · 프로젝트 ${projects.length}개`);

  // 1) 각 프로젝트 페이지 본문을 HTML로 변환. (id별로 따로 호출)
  console.log("📄 프로젝트 페이지 본문을 가져오는 중...");
  const detailById = new Map<string, string>();
  for (const p of projects as any[]) {
    detailById.set(p.id, await renderPageHtml(p.id));
  }

  // 2) Claude에게는 카드용 짧은 글만 맡긴다. (상세 본문은 안 보내도 됨 → 싸고 빠름)
  const shape = `{
  "summary": "2~3문장 자기소개 (1인칭, 담백하게)",
  "skills": [ { "category": "백엔드", "items": ["Java", "Spring Boot", "..."] } ],
  "projectNotes": {
    "0": { "description": "카드에 보일 1문장 요약" }
  }
}`;

  const system =
    "너는 개발자의 노션 데이터를 채용 담당자용 포트폴리오 콘텐츠로 가공하는 편집자다.\n" +
    "절대 규칙: 주어진 데이터에 없는 성과·수치·기술을 지어내지 마라.\n" +
    "할 일:\n" +
    "1) skills — 기술 목록을 백엔드/프론트엔드/데이터베이스/인프라·도구 같은 카테고리로 묶는다. 각 기술은 주어진 '기술' 이름 그대로, 합치지 말고 개별 항목으로 넣는다.\n" +
    "2) summary — 데이터에 드러난 사실(주력 스택, 경력, 개인 프로젝트 성향)만으로 짧은 자기소개를 쓴다.\n" +
    "3) projectNotes — 각 프로젝트의 'id' 값을 키로(문자열 그대로), 카드에 들어갈 1문장 요약을 쓴다. 모든 프로젝트에 대해 빠짐없이 작성한다. 메모가 빈약하면 빈약한 대로 사실만.\n" +
    "출력은 아래 JSON '하나만'. 코드펜스·설명 없이 순수 JSON만:\n" +
    shape;

  const payload = {
    기술스택: techstack,
    프로젝트: (projects as any[]).map((p, i) => ({
      id: String(i),
      이름: p.프로젝트,
      구분: p.구분,
      역할: p.역할,
      기술: p.기술,
      메모: p.메모,
    })),
  };

  console.log("🤖 Claude가 카드 글·기술분류·자기소개를 작성하는 중...");
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system,
    messages: [
      {
        role: "user",
        content: `다음 노션 데이터로 포트폴리오 콘텐츠 JSON을 만들어줘.\n\n${JSON.stringify(payload, null, 2)}`,
      },
    ],
  });

  let text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

  let ai: any;
  try {
    ai = JSON.parse(text);
  } catch {
    throw new Error("Claude 응답을 JSON으로 파싱하지 못했습니다. 앞부분:\n" + text.slice(0, 400));
  }

  // 3) 최종 조립 — 프로젝트의 정체(이름/기술/기간 등)는 코드가 노션 속성에서 직접 채운다.
  //    Claude가 준 건 카드 요약/하이라이트뿐. 상세는 페이지 본문(detailHtml).
  const notes = ai.projectNotes ?? {};
  const finalProjects = (projects as any[])
    .map((p, i) => {
      const note = notes[String(i)] ?? {};
      return {
        name: p.프로젝트,
        type: p.구분,
        org: p.회사 === "-" ? "" : p.회사,
        role: p.역할,
        period: p.기간,
        status: p.상태,
        tech: String(p.기술 ?? "").split(",").map((s) => s.trim()).filter(Boolean),
        description: note.description ?? "",
        detailHtml: detailById.get(p.id) ?? "",
      };
    })
    // 최신 프로젝트가 위로.
    .sort((a, b) => startOf(b.period).localeCompare(startOf(a.period)));

  // techstack 상세 — 스킬 칩 클릭 시 인포박스에 보여줄 "내 정보".
  const techInfo = (techstack as any[]).map((t) => ({
    name: t.기술,
    level: t.수준,
    confidence: t.자신감,
  }));

  const content = {
    summary: ai.summary ?? "",
    skills: ai.skills ?? [],
    techInfo,
    projects: finalProjects,
  };

  await mkdir("src/content", { recursive: true });
  await writeFile(OUT, JSON.stringify(content, null, 2) + "\n", "utf-8");

  console.log(`✅ 초안 저장: ${OUT}`);
  console.log("👉 카드 요약/자기소개를 검수·수정한 뒤 커밋하세요.");
}

main().catch((err) => {
  console.error("❌ 초안 생성 실패:", err);
  process.exit(1);
});
