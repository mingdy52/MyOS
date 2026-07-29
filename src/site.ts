// 포트폴리오 사이트 생성 스크립트 (정적 HTML 빌드).
// 가공·검수가 끝난 src/content/portfolio.json 을 → 파스텔 라이트 테마의 index.html 한 장으로 렌더한다.
//   - 원본 노션을 직접 긁지 않는다. "확정본 JSON"만 본다 → 배포 때마다 내용이 바뀌지 않고 검수된 것만 나간다.
//   - 콘텐츠를 갱신하려면: npm run portfolio (Claude 초안) → JSON 검수·수정 → 커밋 → 배포.
//   - 결과물은 정적 HTML이라 GitHub Pages가 공짜로 서빙한다.
import "dotenv/config";
import { writeFile, mkdir, readFile, cp } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";

// 이미지 파일의 가로·세로 크기를 헤더만 읽어 알아낸다. (PNG·JPEG 지원, 모르면 null)
// 세로가 더 길면 모바일 화면 → 폰 프레임으로 보여주려고 쓴다.
function imageSize(path: string): { w: number; h: number } | null {
  try {
    const b = readFileSync(path);
    if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) {
      return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; // PNG IHDR
    }
    if (b[0] === 0xff && b[1] === 0xd8) {
      let o = 2; // JPEG: SOF 마커에서 크기를 읽는다
      while (o < b.length) {
        if (b[o] !== 0xff) { o++; continue; }
        const m = b[o + 1];
        if (m === undefined) break;
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
          return { h: b.readUInt16BE(o + 5), w: b.readUInt16BE(o + 7) };
        }
        o += 2 + b.readUInt16BE(o + 2);
      }
    }
  } catch {
    /* 못 읽으면 null */
  }
  return null;
}

// ── 프로필 ──
const PROFILE = {
  name: "심민경",
  tagline: "Backend Engineer / Fullstack Developer",
  email: "mincount552@gmail.com",
  github: "https://github.com/mingdy52",
  avatar: "profile.jpg", // assets/profile.jpg 에 넣으면 표시. 없으면 점선 placeholder.
  // 자기소개(문단별). 본인이 직접 쓴 글이라 여기서 관리한다. (비우면 Claude가 만든 summary를 쓴다)
  intro: [
    "저는 여행을 좋아합니다. 정확히는 새로운 장소를 방문하는 것보다, 낯선 환경을 이해하고 그 안에서 길을 찾아가는 과정을 즐깁니다.",
    "남미 2개월 여행을 준비하면서도 여러 국가를 이동하는 복잡한 동선과 불안정한 네트워크 환경을 마주했습니다. 그 과정에서 '오프라인에서도 문제없이 사용할 수 있는 여행 기록 앱이 있으면 좋겠다'는 생각이 들었고, 직접 개발하게 되었습니다.",
    "저는 새로운 환경을 만나면 먼저 불편함을 관찰합니다. 왜 그런 문제가 생기는지 이해하고, 해결할 수 있다면 직접 만들어 봅니다.",
    "개발 역시 저에게는 같은 과정입니다. 기술 자체보다 문제를 탐구하는 일에 더 큰 흥미를 느끼며, 실제 경험에서 얻은 질문을 서비스로 만들어가는 개발자입니다.",
  ],
};


// portfolio.json 의 형태. portfolio-draft.ts(Claude)가 채우는 모양과 같다.
type TechInfo = { name: string; level?: string; confidence?: string | number };
type Content = {
  summary: string;
  skills: { category: string; items: string[] }[];
  techInfo?: TechInfo[];
  projects: {
    name: string;
    type?: string;
    org?: string;
    role?: string;
    period?: string;
    status?: string;
    tech: string[];
    description: string;
    detailHtml?: string;
    images?: { src: string; portrait: boolean }[]; // 화면 스크린샷 (세로면 폰 프레임)
    arch?: string[];   // 아키텍처 이미지 (본문의 이미지 자리에 채움)
  }[];
};

// ── HTML 이스케이프 ──────────────────────────────
function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// 태그(기술 칩)에 돌아가며 입힐 파스텔 색.
const PASTELS = ["#ffd6e0", "#d6e8ff", "#d8f5e3", "#fff0c9", "#e9dcff", "#ffe0cc"];
const pastel = (i: number) => PASTELS[i % PASTELS.length];

// 스킬명 정규화 (Node.js·NodeJS → nodejs) + "기술명 → 내 정보" 사전. 칩 클릭 시 인포박스에 쓴다.
const normName = (s: string) => String(s).toLowerCase().replace(/[^a-z0-9가-힣]/g, "");
let SKILL_INFO: Record<string, TechInfo> = {};

// ── 기술 섹션 (카테고리별 칩) ─────────────────────
function renderSkills(skills: Content["skills"]): string {
  const groups = skills
    .map((g, gi) => {
      const chips = g.items
        .map((it, i) => {
          const has = SKILL_INFO[normName(it)] ? " has-info" : "";
          return `<span class="chip${has}" style="background:${pastel(gi + i)}">${esc(it)}</span>`;
        })
        .join("");
      return `
      <div class="skill-group">
        <div class="skill-cat">${esc(g.category)}</div>
        <div class="chips">${chips}</div>
      </div>`;
    })
    .join("");

  return `
    <section class="card">
      <h2>Skills</h2>
      <div class="skill-list">${groups || '<p class="dim">등록된 기술이 없습니다.</p>'}</div>
    </section>`;
}

// 카드 하나. idx는 클릭 시 모달이 어떤 프로젝트를 열지 가리키는 전역 번호다.
function renderCard(p: Content["projects"][number], idx: number): string {
  const tags = (p.tech ?? [])
    .map((tag, i) => `<span class="chip" style="background:${pastel(i)}">${esc(tag)}</span>`)
    .join("");
  const metaBits = [p.org, p.role, p.period].filter(Boolean).map(esc).join(" · ");

  return `
      <article class="project" role="button" tabindex="0" data-i="${idx}">
        <div class="project-head">
          <h3>${esc(p.name)}</h3>
          ${p.status ? `<span class="status">${esc(p.status)}</span>` : ""}
        </div>
        ${metaBits ? `<p class="project-meta">${metaBits}</p>` : ""}
        ${p.description ? `<p class="project-desc">${esc(p.description)}</p>` : ""}
        ${tags ? `<div class="chips">${tags}</div>` : ""}
        <span class="more">자세히 보기 →</span>
      </article>`;
}

// period("2025-11-01" 또는 "2025-08-01 ~ 2026-02-28")에서 시작일을 뽑아 정렬 키로 쓴다.
// 날짜가 없으면 빈 문자열 → 맨 뒤로.
const startDate = (period?: string) => String(period ?? "").split("~")[0]?.trim() ?? "";

// ── 프로젝트 섹션: 개인 / 회사로 나눠 각각 2열 그리드 ──────────
function renderProjects(projects: Content["projects"]): string {
  // 원래 인덱스(i)는 모달의 PROJECTS 배열과 매칭되므로 그대로 둔 채, 표시 순서만 바꾼다.
  const indexed = projects.map((p, i) => ({ p, i }));
  // 시작일 기준 최신순(내림차순). 날짜 없는 건 뒤로.
  const ordered = [...indexed].sort((a, b) => startDate(b.p.period).localeCompare(startDate(a.p.period)));
  // 회사(구분=회사)만 회사 섹션, 나머지(개인·팀)는 개인 섹션.
  const company = ordered.filter(({ p }) => String(p.type ?? "").includes("회사"));
  const personal = ordered.filter(({ p }) => !String(p.type ?? "").includes("회사"));

  const group = (title: string, items: { p: Content["projects"][number]; i: number }[]) =>
    items.length
      ? `
    <section>
      <h2 class="section-title">${title}</h2>
      <div class="project-grid">${items.map(({ p, i }) => renderCard(p, i)).join("")}</div>
    </section>`
      : "";

  return group("개인 프로젝트", personal) + group("회사 프로젝트", company);
}

// 모달에서 쓸 프로젝트 데이터를 <script>에 안전하게 심는다.
// (</script> 나 < 가 들어와도 깨지지 않게 < 를 유니코드 이스케이프)
function embedData(projects: Content["projects"]): string {
  const json = JSON.stringify(projects).replace(/</g, "\\u003c");
  return `<script>const PROJECTS = ${json};</script>`;
}

// ── 전체 페이지 ────────────────────────────────
function renderPage(c: Content): string {
  // 기술명 → 내 정보 사전. 스킬 칩 클릭 시 인포박스에서 쓴다.
  SKILL_INFO = {};
  for (const t of c.techInfo ?? []) if (t.name) SKILL_INFO[normName(t.name)] = t;
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(PROFILE.name)} · Portfolio</title>
<style>
  :root {
    --bg1:#fef6fb; --bg2:#eef4ff; --card:#ffffff; --ink:#4a4a5e;
    --dim:#9a9aae; --accent:#f7a8c4;
  }
  * { box-sizing: border-box; }
  body {
    margin:0; padding:0 16px 64px; color:var(--ink);
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Apple SD Gothic Neo",sans-serif;
    background:linear-gradient(160deg,var(--bg1),var(--bg2)); min-height:100vh; line-height:1.5;
  }
  .wrap { max-width:1000px; margin:0 auto; }
  h2 { margin:0 0 16px; font-size:20px; }
  .dim { color:var(--dim); }

  /* Hero — 왼쪽: 사진+링크 / 오른쪽: 이름·소개 */
  header.hero {
    display:flex; align-items:center; justify-content:center; gap:44px;
    padding:64px 0 40px; text-align:left; flex-wrap:wrap;
  }
  .hero-left { flex:0 0 auto; display:flex; flex-direction:column; align-items:center; gap:18px; }
  .avatar {
    width:280px; height:280px; border-radius:50%; overflow:hidden;
    box-shadow:0 10px 30px rgba(150,130,200,.25); background:#fff;
  }
  .avatar img { width:100%; height:100%; object-fit:cover; display:block; }
  .avatar.placeholder {
    display:flex; align-items:center; justify-content:center;
    background:#fff; border:2px dashed #d8cdef; color:var(--dim); font-size:15px;
  }
  .hero-text { flex:1; min-width:0; max-width:640px; }
  header h1 { margin:0 0 8px; font-size:42px; letter-spacing:-.5px; }
  header .tag { margin:0 0 16px; color:var(--dim); font-size:17px; }
  .summary { margin:0 0 10px; font-size:15px; line-height:1.7; }
  .summary:last-of-type { margin-bottom:20px; }
  @media (max-width:640px) {
    header.hero { flex-direction:column; text-align:center; gap:24px; padding:48px 0 32px; }
    .avatar { width:200px; height:200px; }
  }
  .links { display:flex; flex-wrap:wrap; justify-content:center; gap:8px; max-width:280px; }
  .links a, .links button {
    display:inline-block; padding:8px 18px; border-radius:999px;
    background:#fff; color:var(--ink); text-decoration:none; font-size:14px; cursor:pointer;
    border:none; font-family:inherit; box-shadow:0 2px 10px rgba(150,130,200,.12); transition:transform .15s;
  }
  .links a:hover, .links button:hover { transform:translateY(-2px); }
  .copy-mail.copied { background:#d8f5e3; color:#3f8f6a; }

  /* Card */
  .card {
    background:var(--card); border-radius:20px; padding:28px;
    box-shadow:0 6px 24px rgba(150,130,200,.12); margin-bottom:40px;
  }

  /* Skills */
  .skill-group { margin:16px 0; }
  .skill-cat { font-weight:600; margin-bottom:8px; font-size:14px; color:#7a6a8e; }

  /* Chips */
  .chips { display:flex; flex-wrap:wrap; gap:6px; }
  .chip { font-size:12px; padding:4px 10px; border-radius:999px; color:#5a5a6e; }
  .chip.has-info { cursor:help; }
  .chip.has-info:hover { filter:brightness(.96); box-shadow:0 0 0 2px rgba(150,130,200,.25); }
  .chip.more-chip { background:#ece6f4; color:#7a6a8e; font-weight:600; }

  /* 스킬 인포박스 (팝오버) */
  .skillpop {
    position:fixed; z-index:60; display:none; max-width:320px; width:max-content;
    background:#fff; border-radius:16px; padding:16px 18px; pointer-events:none;
    box-shadow:0 12px 36px rgba(80,70,110,.28);
  }
  .skillpop.open { display:block; }
  .skillpop .sp-title { font-weight:700; font-size:15px; margin-bottom:8px; }
  .skillpop .sp-meta { display:flex; flex-wrap:wrap; gap:6px 14px; font-size:12.5px; color:var(--dim); margin-bottom:8px; }
  .skillpop .sp-meta b { color:#7a6a8e; font-weight:600; }
  .skillpop .sp-memo { margin:0; font-size:13.5px; line-height:1.6; }

  /* Projects — 한 줄에 2개 */
  .section-title { padding-left:4px; }
  .project-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:20px; margin-bottom:40px; }
  .project {
    background:var(--card); border-radius:20px; padding:22px;
    box-shadow:0 6px 24px rgba(150,130,200,.12); display:flex; flex-direction:column;
    cursor:pointer; transition:transform .15s, box-shadow .15s;
  }
  .project:hover, .project:focus {
    transform:translateY(-3px); box-shadow:0 10px 30px rgba(150,130,200,.22); outline:none;
  }
  .project-head { display:flex; align-items:center; justify-content:space-between; gap:8px; }
  .project-head h3 { margin:0; font-size:18px; }
  .status { font-size:12px; padding:4px 10px; border-radius:999px; background:#eef4ff; color:#6a7ba8; white-space:nowrap; }
  .project-meta { margin:8px 0 0; font-size:13px; color:var(--dim); }
  .project-desc { margin:12px 0 0; font-size:14px; }
  .project .chips { margin-top:14px; }
  .more { margin-top:auto; padding-top:14px; font-size:13px; color:var(--accent); font-weight:600; }

  /* Modal */
  .overlay {
    position:fixed; inset:0; background:rgba(80,70,110,.35); backdrop-filter:blur(3px);
    display:none; align-items:center; justify-content:center; padding:20px; z-index:50;
  }
  .overlay.open { display:flex; }
  .modal {
    background:#fff; border-radius:24px; padding:44px 52px; max-width:1080px; width:100%;
    max-height:90vh; overflow:auto; box-shadow:0 20px 60px rgba(80,70,110,.3);
  }
  @media (max-width:600px) { .modal { padding:28px 22px; } }
  .modal h3 { margin:0 0 6px; font-size:24px; }
  .modal .project-meta { margin:0 0 14px; }
  .modal .chips { margin:0 0 20px; }
  /* 닫기 버튼은 스크롤을 내려도 계속 보이게 sticky. 스크롤되는 건 .modal 자신이다.
     음수 margin으로 본문 폭 바깥(좌우 여백)에 띄워 글자를 가리지 않게 한다. */
  .modal-close {
    position:sticky; top:0; z-index:3; float:right; margin-right:-34px;
    border:none; background:#f0ecf8; color:var(--ink); cursor:pointer;
    width:34px; height:34px; border-radius:50%; font-size:18px; line-height:1;
    box-shadow:0 2px 10px rgba(80,70,110,.18);
  }
  @media (max-width:600px) { .modal-close { margin-right:-12px; } }

  /* 화면 스크린샷 — 폰 목업 프레임 나란히 */
  .phones {
    display:flex; flex-wrap:wrap; justify-content:center; gap:22px;
    margin:4px 0 26px; padding:8px 0;
  }
  .phone {
    flex:0 0 auto; width:230px; background:#1f1d2b; border-radius:34px;
    padding:10px; box-shadow:0 12px 30px rgba(80,70,110,.28); position:relative;
  }
  .phone::before { /* 상단 노치 */
    content:""; position:absolute; top:16px; left:50%; transform:translateX(-50%);
    width:64px; height:6px; border-radius:6px; background:#3a3750; z-index:2;
  }
  .phone img { width:100%; border-radius:26px; display:block; vertical-align:top; }
  @media (max-width:600px) { .phone { width:150px; border-radius:26px; } .phone img { border-radius:20px; } }

  /* 가로·정사각 스크린샷 — 고정 크기 캐러셀 */
  .carousel { position:relative; margin:4px 0 26px; }
  .carousel .frame {
    height:440px; border-radius:16px; background:#f6f2fc; overflow:hidden;
    display:flex; align-items:center; justify-content:center;
  }
  .carousel .slide { display:none; max-width:100%; max-height:100%; object-fit:contain; animation:fade .4s ease; }
  .carousel .slide.active { display:block; }
  @keyframes fade { from { opacity:.3; } to { opacity:1; } }
  .cbtn {
    position:absolute; top:50%; transform:translateY(-50%); border:none; cursor:pointer;
    width:40px; height:40px; border-radius:50%; font-size:24px; line-height:1; color:var(--ink);
    background:rgba(255,255,255,.9); box-shadow:0 2px 8px rgba(80,70,110,.2);
  }
  .cbtn:hover { background:#fff; }
  .cbtn.prev { left:12px; } .cbtn.next { right:12px; }
  .dots { position:absolute; bottom:12px; left:0; right:0; display:flex; justify-content:center; gap:8px; }
  .dots .dot { width:9px; height:9px; border-radius:50%; background:rgba(120,110,150,.35); cursor:pointer; }
  .dots .dot.active { background:var(--accent); }
  @media (max-width:600px) { .carousel .frame { height:300px; } }
  /* 본문 안에 들어가는 이미지(아키텍처 등) */
  .page-img { margin:16px 0; }
  .page-img img {
    width:100%; max-height:80vh; object-fit:contain; display:block;
    border-radius:14px; background:#f6f2fc;
  }

  /* 아키텍처 (본문 아래) */
  .arch-title { font-size:19px; margin:28px 0 12px; }
  .arch img {
    width:100%; max-height:80vh; object-fit:contain;
    border-radius:16px; background:#f6f2fc; display:block; margin:0 0 14px;
  }

  /* 노션 본문 렌더 스타일 */
  .detail { font-size:16.5px; line-height:1.8; }
  .detail h2 { font-size:22px; margin:26px 0 10px; }
  .detail h3 { font-size:19px; margin:24px 0 10px; }
  .detail h4, .detail h5 { font-size:16.5px; margin:18px 0 6px; color:#7a6a8e; }
  /* 노션에서 제목에 볼드를 먹인 것과 아닌 것이 섞여 들어온다.
     제목은 이미 굵기 700인데 브라우저 기본 strong 규칙이 'bolder'(상대값)라 900까지 올라가,
     같은 h4끼리도 굵기가 달라 보인다. 제목 안의 볼드는 무시해 굵기를 통일한다. */
  .detail :is(h2,h3,h4,h5) strong { font-weight:inherit; }
  .detail p { margin:8px 0; }
  .detail ul, .detail ol { margin:8px 0; padding-left:20px; }
  .detail li { margin:5px 0; }
  .detail ul.todo { list-style:none; padding-left:2px; }
  .detail .sub { padding-left:16px; }
  .detail hr { border:none; border-top:1px solid #efeaf6; margin:18px 0; }
  .detail a { color:#c77fa0; }
  .detail code { background:#f4f0fa; padding:1px 6px; border-radius:6px; font-size:13px; }
  .detail pre { background:#f7f4fc; padding:14px; border-radius:12px; overflow:auto; }
  .detail pre code { background:none; padding:0; }
  .detail blockquote { margin:12px 0; padding:8px 14px; border-left:3px solid var(--accent); background:#fdf3f8; border-radius:0 8px 8px 0; }
  .detail .callout { margin:12px 0; padding:12px 14px; background:#f6f2fc; border-radius:12px; }
  .detail table { border-collapse:collapse; width:100%; margin:12px 0; font-size:13.5px; }
  .detail td { border:1px solid #ece6f4; padding:7px 10px; }
  .detail .cols { display:flex; flex-wrap:wrap; gap:16px; }
  .detail .cols > * { flex:1; min-width:180px; }
  .detail details { margin:8px 0; }
  .detail summary { cursor:pointer; font-weight:600; }

  footer { text-align:center; color:var(--dim); font-size:13px; margin-top:48px; }

  @media (max-width:600px) { .project-grid { grid-template-columns:1fr; } }
</style>
</head>
<body>
  <div class="wrap">
    <header class="hero">
      <div class="hero-left">
        ${
          PROFILE.avatar && existsSync("assets/" + PROFILE.avatar)
            ? `<div class="avatar"><img src="assets/${esc(PROFILE.avatar)}" alt="${esc(PROFILE.name)}"></div>`
            : `<div class="avatar placeholder">사진</div>`
        }
        <div class="links">
          <a href="${esc(PROFILE.github)}" target="_blank" rel="noopener">GitHub</a>
          <button type="button" class="copy-mail" data-mail="${esc(PROFILE.email)}">Email</button>
        </div>
      </div>
      <div class="hero-text">
        <h1>${esc(PROFILE.name)}</h1>
        <p class="tag">${esc(PROFILE.tagline)}</p>
        ${
          PROFILE.intro && PROFILE.intro.length
            ? PROFILE.intro.map((t) => `<p class="summary">${esc(t)}</p>`).join("")
            : c.summary ? `<p class="summary">${esc(c.summary)}</p>` : ""
        }
      </div>
    </header>

    ${renderSkills(c.skills ?? [])}
    ${renderProjects(c.projects ?? [])}

    <footer>노션 데이터 기반 · ${new Date().toISOString().slice(0, 10)}</footer>
  </div>

  <!-- 카드 클릭 시 뜨는 상세 모달 -->
  <div class="overlay" id="overlay">
    <div class="modal" id="modal" role="dialog" aria-modal="true"></div>
  </div>

  <!-- 스킬 칩 클릭 시 뜨는 인포박스 -->
  <div class="skillpop" id="skillpop"></div>

  ${embedData(c.projects ?? [])}
  <script>
    const PASTELS = ${JSON.stringify(PASTELS)};
    const SKILL_INFO = ${JSON.stringify(SKILL_INFO)};
    const normName = (s) => String(s).toLowerCase().replace(/[^a-z0-9가-힣]/g, "");
    const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (m) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[m]));
    const overlay = document.getElementById("overlay");
    const modal = document.getElementById("modal");

    function openModal(i) {
      const p = PROJECTS[i];
      if (!p) return;
      const meta = [p.org, p.role, p.period, p.status].filter(Boolean).map(esc).join(" · ");
      const tags = (p.tech || []).map((t, k) =>
        '<span class="chip" style="background:' + PASTELS[k % PASTELS.length] + '">' + esc(t) + '</span>').join("");
      // 본문(노션 변환 HTML)의 이미지 자리(@@IMG@@) 처리.
      // '아키텍처/Architecture' 제목 바로 뒤의 자리에만 아키텍처 이미지를 넣고, 나머지 자리표(로고 등)는 지운다.
      let body = p.detailHtml || ("<p>" + esc(p.description || "") + "</p>");
      const archPool = (p.arch || []).slice();
      const headMatch = /<h[2-5][^>]*>[^<]*(?:아키텍처|architecture)/i.exec(body);
      const archPos = headMatch ? body.indexOf("@@IMG@@", headMatch.index + headMatch[0].length) : -1;
      const fig = (src) => '<figure class="page-img"><img src="' + esc(src) + '" alt="아키텍처" loading="lazy"></figure>';
      body = body.replace(/@@IMG@@/g, (_m, offset) =>
        (offset === archPos && archPool.length) ? fig(archPool.shift()) : "");
      // 본문에 둘 자리가 없던 아키텍처 이미지는 맨 아래에 둔다(폴백).
      const leftover = archPool.length
        ? '<h2 class="arch-title">📐 Architecture</h2><div class="arch">' +
          archPool.map((src) => '<img src="' + esc(src) + '" alt="아키텍처" loading="lazy">').join("") + "</div>"
        : "";
      modal.innerHTML =
        '<button class="modal-close" aria-label="닫기" onclick="closeModal()">×</button>' +
        "<h3>" + esc(p.name) + "</h3>" +
        (meta ? '<p class="project-meta">' + meta + "</p>" : "") +
        (tags ? '<div class="chips">' + tags + "</div>" : "") +
        media(p.images || []) +
        '<div class="detail">' + body + "</div>" +
        leftover;
      overlay.classList.add("open");
      modal.scrollTop = 0;
      initCarousel();
    }
    function closeModal() { overlay.classList.remove("open"); stopCarousel(); }

    // 화면 스크린샷: 세로(모바일)는 폰 프레임에 나란히, 가로·정사각은 고정 크기 캐러셀.
    function media(imgs) {
      if (!imgs.length) return "";
      const port = imgs.filter((i) => i.portrait);
      const land = imgs.filter((i) => !i.portrait);
      let h = "";
      if (port.length)
        h += '<div class="phones">' +
          port.map((i) => '<div class="phone"><img src="' + esc(i.src) + '" alt="화면" loading="lazy"></div>').join("") + "</div>";
      if (land.length) h += carousel(land);
      return h;
    }

    // 고정 크기 박스 안에서 한 장씩 보여주는 캐러셀. 이미지 크기가 달라도 박스는 일정하다.
    function carousel(imgs) {
      const slides = imgs.map((i, k) =>
        '<img class="slide' + (k === 0 ? ' active' : '') + '" src="' + esc(i.src) + '" alt="화면" loading="lazy">').join("");
      if (imgs.length === 1) return '<div class="carousel"><div class="frame">' + slides + "</div></div>";
      const dots = imgs.map((_, k) => '<span class="dot' + (k === 0 ? ' active' : '') + '" data-k="' + k + '"></span>').join("");
      return '<div class="carousel"><div class="frame">' + slides + "</div>" +
        '<button class="cbtn prev" aria-label="이전">‹</button>' +
        '<button class="cbtn next" aria-label="다음">›</button>' +
        '<div class="dots">' + dots + "</div></div>";
    }

    let carTimer = null;
    function stopCarousel() { if (carTimer) { clearInterval(carTimer); carTimer = null; } }
    function initCarousel() {
      stopCarousel();
      const car = modal.querySelector(".carousel");
      if (!car) return;
      const slides = [...car.querySelectorAll(".slide")];
      const dots = [...car.querySelectorAll(".dot")];
      if (slides.length < 2) return;
      let cur = 0;
      const show = (n) => {
        cur = (n + slides.length) % slides.length;
        slides.forEach((s, k) => s.classList.toggle("active", k === cur));
        dots.forEach((d, k) => d.classList.toggle("active", k === cur));
      };
      const auto = () => { stopCarousel(); carTimer = setInterval(() => show(cur + 1), 3500); };
      car.querySelector(".next").addEventListener("click", () => { show(cur + 1); auto(); });
      car.querySelector(".prev").addEventListener("click", () => { show(cur - 1); auto(); });
      dots.forEach((d) => d.addEventListener("click", () => { show(Number(d.dataset.k)); auto(); }));
      auto();
    }

    // 카드 클릭 / 엔터로 열기
    document.querySelectorAll(".project").forEach((el) => {
      const open = () => openModal(Number(el.dataset.i));
      el.addEventListener("click", open);
      el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
    });
    // 배경 클릭 / Esc로 닫기
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

    // ── 스킬 칩 인포박스 ──────────────────────────
    const skillpop = document.getElementById("skillpop");
    function skillHTML(info) {
      const rows = [];
      if (info.level) rows.push(["수준", info.level]);
      if (info.confidence) rows.push(["자신감", info.confidence]);
      let h = '<div class="sp-title">' + esc(info.name) + "</div>";
      if (rows.length) h += '<div class="sp-meta">' + rows.map((r) => "<span><b>" + r[0] + "</b> " + esc(r[1]) + "</span>").join("") + "</div>";
      else h += '<p class="sp-memo dim">등록된 정보가 없습니다.</p>';
      return h;
    }
    function openSkill(chip) {
      const info = SKILL_INFO[normName(chip.textContent)];
      if (!info) return;
      skillpop.innerHTML = skillHTML(info);
      skillpop.classList.add("open");
      // 칩 아래에 위치. 화면 밖으로 안 나가게 좌우 보정.
      const r = chip.getBoundingClientRect();
      const w = skillpop.offsetWidth;
      let left = r.left + r.width / 2 - w / 2;
      left = Math.max(10, Math.min(left, window.innerWidth - w - 10));
      skillpop.style.left = left + "px";
      skillpop.style.top = (r.bottom + 8) + "px";
    }
    function closeSkill() { skillpop.classList.remove("open"); }
    // 마우스를 올리면 뜨고, 벗어나면 닫힌다.
    document.querySelectorAll(".chip.has-info").forEach((chip) => {
      chip.addEventListener("mouseenter", () => openSkill(chip));
      chip.addEventListener("mouseleave", closeSkill);
    });
    window.addEventListener("scroll", closeSkill, true);

    // 카드의 기술 칩이 2줄을 넘으면 잘라내고 '…' 칩을 붙인다. (상세에선 전부 보여줌)
    function clampChips() {
      document.querySelectorAll(".project .chips").forEach((box) => {
        const first = box.firstElementChild;
        if (!first) return;
        const rowH = first.offsetHeight;
        const limit = rowH * 2 + 8; // 2줄 + 여유
        if (box.scrollHeight <= limit) return;
        const more = document.createElement("span");
        more.className = "chip more-chip";
        more.textContent = "…";
        box.appendChild(more);
        while (box.scrollHeight > limit && more.previousElementSibling) {
          box.removeChild(more.previousElementSibling);
        }
      });
    }
    clampChips();

    // 이메일: 클릭하면 클립보드에 복사하고 잠깐 '복사됨' 표시.
    const mailBtn = document.querySelector(".copy-mail");
    if (mailBtn) {
      const orig = mailBtn.textContent;
      mailBtn.addEventListener("click", async () => {
        const mail = mailBtn.dataset.mail;
        try {
          await navigator.clipboard.writeText(mail);
        } catch {
          // clipboard API가 막힌 환경(http 등) 폴백
          const t = document.createElement("textarea");
          t.value = mail; document.body.appendChild(t); t.select();
          document.execCommand("copy"); t.remove();
        }
        mailBtn.textContent = "복사됨 ✓";
        mailBtn.classList.add("copied");
        setTimeout(() => { mailBtn.textContent = orig; mailBtn.classList.remove("copied"); }, 1400);
      });
    }
  </script>
</body>
</html>`;
}

async function main() {
  // 확정본 콘텐츠를 읽는다. 없으면 npm run portfolio 부터 돌리라고 안내.
  let c: Content;
  try {
    c = JSON.parse(await readFile("src/content/portfolio.json", "utf-8"));
  } catch {
    throw new Error(
      "src/content/portfolio.json 이 없습니다. 먼저 `npm run portfolio` 로 초안을 만들고 검수·커밋하세요."
    );
  }

  // 이미지 매핑(프로젝트명 → 파일목록)을 읽어 프로젝트에 붙인다.
  // 이미지는 Claude와 무관하므로 여기서 직접 합친다 → 이미지 추가/순서변경은 `npm run site`만으로 끝.
  let imageMap: Record<string, string[]> = {};
  try {
    imageMap = JSON.parse(await readFile("src/content/images.json", "utf-8"));
  } catch {
    /* images.json이 없으면 이미지 없이 진행 */
  }
  for (const p of c.projects ?? []) {
    // 이름이 정확히 일치하거나 이름에 키가 포함되면 매칭 (제목에 이모지·설명을 붙여도 안 깨짐).
    const key = Object.keys(imageMap).find((k) => k !== "_사용법" && (p.name === k || p.name.includes(k)));
    const files = (key ? imageMap[key] ?? [] : []).filter((f) => {
      const ok = existsSync("assets/" + f); // assets/에 실제로 있는 파일만 (깨진 이미지 방지)
      if (!ok) console.warn(`⚠️ 이미지 없음 (건너뜀): assets/${f}  [${p.name}]`);
      return ok;
    });
    // 파일명에 'arch'가 들어가면 아키텍처(본문 자리에 채움), 나머지는 화면(상단).
    p.arch = files.filter((f) => /arch/i.test(f)).map((f) => "assets/" + f);
    p.images = files
      .filter((f) => !/arch/i.test(f))
      .map((f) => {
        const s = imageSize("assets/" + f);
        // 아주 길쭉한 것(세로:가로 ≥ 1.6)만 폰 화면으로 보고 프레임을 씌운다.
        // 정사각·가로(터미널/데스크톱 캡처)는 일반 이미지로.
        return { src: "assets/" + f, portrait: !!(s && s.h / s.w >= 1.6) };
      });
  }

  const html = renderPage(c);
  await mkdir("docs", { recursive: true });
  await writeFile("docs/index.html", html, "utf-8");

  // assets/(이미지)를 docs/assets로 복사해 같이 배포한다.
  try {
    await cp("assets", "docs/assets", { recursive: true });
    console.log("🖼️  assets → docs/assets 복사 완료");
  } catch {
    // assets 폴더가 없거나 비어도 무시.
  }

  console.log("✅ 생성 완료: docs/index.html");
}

main().catch((err) => {
  console.error("❌ 사이트 생성 실패:", err);
  process.exit(1);
});
