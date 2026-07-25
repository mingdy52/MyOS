import { notion } from "./client.js";

// 페이지 본문(블록)의 텍스트만 뽑아 한 덩어리로 잇는다.
// 일기처럼 자유 서술이 '컬럼(properties)'이 아니라 '페이지 본문'에 들어가는 경우,
// queryDataSource(=properties만 읽음)로는 안 보이므로 이걸로 따로 읽어야 한다.
// 최상위 블록만 읽는다(일기는 보통 평평한 문단/리스트). 100개를 넘으면 페이지네이션으로 이어 읽는다.
export async function getPageText(pageId: string): Promise<string> {
  const lines: string[] = [];
  let cursor: string | undefined = undefined;

  do {
    const res: any = await notion.blocks.children.list({
      block_id: pageId,
      page_size: 100,
      ...(cursor && { start_cursor: cursor }),
    });
    for (const b of res.results) {
      // 문단·제목·리스트 등 거의 모든 텍스트 블록은 b[type].rich_text 에 내용이 있다.
      const rich = b[b.type]?.rich_text;
      const text = Array.isArray(rich)
        ? rich.map((t: any) => t.plain_text).join("")
        : "";
      if (text.trim()) lines.push(text);
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);

  return lines.join("\n");
}

// 페이지 본문에 붙은 '이미지 블록'들의 URL만 뽑는다. (getPageText가 텍스트를 읽는 것과 짝)
// 노션 이미지는 두 종류다:
//   - file    : 노션이 호스팅. url은 1시간쯤 뒤 만료되는 임시 주소 → 쓰기 직전에 읽어야 안전.
//   - external: 외부 링크. 만료 없음.
// 식단 사진처럼 "페이지 안에 넣어둔 사진"을 분석에 넘길 때 쓴다.
export async function getPageImages(pageId: string): Promise<string[]> {
  const urls: string[] = [];
  let cursor: string | undefined = undefined;

  do {
    const res: any = await notion.blocks.children.list({
      block_id: pageId,
      page_size: 100,
      ...(cursor && { start_cursor: cursor }),
    });
    for (const b of res.results) {
      if (b.type !== "image") continue;
      const img = b.image;
      const url = img?.type === "external" ? img.external?.url : img?.file?.url;
      if (url) urls.push(url);
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);

  return urls;
}
