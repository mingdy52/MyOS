// 노션 "페이지 본문"(블록들)을 HTML로 변환한다.
// 프로젝트 상세 모달에 본인이 노션에 써둔 내용을 서식 그대로 보여주기 위한 모듈.
//   - rich_text의 굵게/기울임/코드/취소선/링크 같은 서식을 살린다.
//   - 자식이 있는 블록(중첩 리스트·토글·표·컬럼)은 재귀로 따라 들어간다.
//   - 이미지는 노션 업로드 파일 URL이 1시간이면 만료돼 깨지므로 건너뛴다.
import { notion } from "./client.js";

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// rich_text 배열 → 서식 입힌 HTML 조각.
function richText(rts: any[] | undefined): string {
  return (rts ?? [])
    .map((rt) => {
      let t = esc(rt.plain_text);
      const a = rt.annotations ?? {};
      if (a.code) t = `<code>${t}</code>`;
      if (a.bold) t = `<strong>${t}</strong>`;
      if (a.italic) t = `<em>${t}</em>`;
      if (a.strikethrough) t = `<s>${t}</s>`;
      if (a.underline) t = `<u>${t}</u>`;
      if (rt.href) t = `<a href="${esc(rt.href)}" target="_blank" rel="noopener">${t}</a>`;
      return t;
    })
    .join("");
}

// 한 블록의 자식 전부를 페이지네이션까지 따라가며 가져온다.
async function fetchChildren(blockId: string): Promise<any[]> {
  const out: any[] = [];
  let cursor: string | undefined;
  do {
    const res: any = await notion.blocks.children.list({
      block_id: blockId,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    out.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return out;
}

// 블록 배열 → HTML. 연속된 리스트 아이템은 <ul>/<ol>로 묶는다.
async function renderBlocks(blocks: any[]): Promise<string> {
  let html = "";
  let i = 0;
  while (i < blocks.length) {
    const type = blocks[i].type;

    // 연속된 같은 종류의 리스트 아이템을 한 덩어리로 묶는다.
    if (type === "bulleted_list_item" || type === "numbered_list_item") {
      const tag = type === "bulleted_list_item" ? "ul" : "ol";
      let items = "";
      while (i < blocks.length && blocks[i].type === type) {
        const it = blocks[i];
        let inner = richText(it[type].rich_text);
        if (it.has_children) inner += await renderBlocks(await fetchChildren(it.id));
        items += `<li>${inner}</li>`;
        i++;
      }
      html += `<${tag}>${items}</${tag}>`;
      continue;
    }

    html += await renderBlock(blocks[i]);
    i++;
  }
  return html;
}

async function renderBlock(b: any): Promise<string> {
  const type = b.type;

  // 제목류(heading_1~4)는 들여보이게 등급만 매핑.
  if (type.startsWith("heading_")) {
    const lvl = Math.min(Number(type.split("_")[1]) || 3, 4) + 1; // h2~h5
    return `<h${lvl}>${richText(b[type].rich_text)}</h${lvl}>`;
  }

  switch (type) {
    case "paragraph": {
      const t = richText(b.paragraph.rich_text);
      return t.trim() ? `<p>${t}</p>` : ""; // 빈 문단은 버린다
    }
    case "quote":
      return `<blockquote>${richText(b.quote.rich_text)}</blockquote>`;
    case "callout":
      return `<div class="callout">${richText(b.callout.rich_text)}</div>`;
    case "code":
      return `<pre><code>${esc(b.code.rich_text?.map((r: any) => r.plain_text).join("") ?? "")}</code></pre>`;
    case "divider":
      return "<hr>";
    case "toggle": {
      const body = b.has_children ? await renderBlocks(await fetchChildren(b.id)) : "";
      return `<details><summary>${richText(b.toggle.rich_text)}</summary>${body}</details>`;
    }
    case "table": {
      const rows = await fetchChildren(b.id);
      const trs = rows
        .map((r) => `<tr>${r.table_row.cells.map((c: any) => `<td>${richText(c)}</td>`).join("")}</tr>`)
        .join("");
      return `<table>${trs}</table>`;
    }
    case "column_list": {
      const cols = await fetchChildren(b.id);
      let h = "";
      for (const col of cols) h += await renderBlocks(await fetchChildren(col.id));
      return `<div class="cols">${h}</div>`;
    }
    case "image":
      // 노션 이미지 URL은 만료되므로 본문에 직접 넣지 않는다.
      // 대신 '이미지가 있던 자리' 표시만 남긴다 → 빌드 때 로컬 아키텍처 이미지로 채운다(site.ts).
      return "@@IMG@@";
    default:
      // 모르는 블록도 rich_text가 있으면 문단으로라도 살린다.
      return b[type]?.rich_text ? `<p>${richText(b[type].rich_text)}</p>` : "";
  }
}

// 페이지(블록 id) 하나의 본문 전체를 HTML로 돌려준다.
export async function renderPageHtml(pageId: string): Promise<string> {
  return renderBlocks(await fetchChildren(pageId));
}
