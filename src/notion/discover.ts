import { notion } from "./client.js";
import type { FieldType } from "./schema.js";

// 노션 부모 페이지 하나만 알면, 그 안의 데이터베이스들을 훑어
//   제목 → { dataSourceId, 컬럼:타입 } 로 만들어 돌려준다.
// .env에 DB마다 id를 적어두지 않아도 되고, 새 DB가 늘어도 코드/설정을 안 고쳐도 된다.
//
// 흐름(노션 v5 기준):
//   (1) blocks.children.list(페이지)      → 페이지 안의 블록들. DB는 child_database 블록으로 나온다.
//   (2) databases.retrieve(블록id)         → 그 DB의 data source 목록 (블록 id = database id).
//   (3) dataSources.retrieve(dataSourceId) → 실제로 조회/쓰기에 쓰는 컬럼(properties).

// 노션 속성 타입 → 우리 FieldType(props.ts/mutate.ts가 다루는 타입).
// 여기 없는 타입(relation·formula·rollup·people·files·created_time 등)은
// 지금 읽기/쓰기가 처리하지 못하므로 스키마에서 조용히 건너뛴다.
const TYPE_MAP: Record<string, FieldType> = {
  title: "title",
  rich_text: "text",
  number: "number",
  select: "select",
  multi_select: "multi_select",
  status: "status",
  date: "date",
  checkbox: "checkbox",
};

// 노션 rich_text 배열에서 순수 텍스트만 이어붙인다(제목 뽑을 때 사용).
const plainText = (t: any): string =>
  Array.isArray(t) ? t.map((x: any) => x.plain_text).join("") : "";

// 발견 결과: DB 제목 → { 조회에 쓸 dataSourceId, 컬럼명:타입, 본문형 여부 }.
// hasBody: 노션 제목이 '+'로 끝나면(본문형 표시) true. 페이지 본문에 자유 서술을 적는 DB라는 뜻.
export type DiscoveredSchemas = Record<
  string,
  { dataSourceId: string; columns: Record<string, FieldType>; hasBody: boolean }
>;

export async function discoverFromPage(
  parentPageId: string
): Promise<DiscoveredSchemas> {
  const blocks = await listAllChildren(parentPageId);
  const dbBlocks = blocks.filter((b: any) => b.type === "child_database");

  const result: DiscoveredSchemas = {};
  for (const block of dbBlocks) {
    // child_database 블록의 id = database(컨테이너) id.
    const db: any = await notion.databases.retrieve({ database_id: block.id });

    // 한 database 안에 data source가 여러 개일 수도 있어 모두 훑는다(보통 1개).
    for (const ref of db.data_sources) {
      const ds: any = await notion.dataSources.retrieve({
        data_source_id: ref.id,
      });
      // 제목 끝의 '+'는 "본문형 DB" 표시다. 떼어내서 hasBody로 옮기고,
      // 키·이름은 깔끔한 제목(예: "알고리즘 로그")으로 쓴다.
      let title = (plainText(ds.title) || ref.name || "(제목 없음)").trim();
      let hasBody = false;
      if (title.endsWith("+")) {
        hasBody = true;
        title = title.slice(0, -1).trim();
      }

      const columns: Record<string, FieldType> = {};
      const skipped: string[] = [];
      for (const [name, prop] of Object.entries<any>(ds.properties)) {
        const mapped = TYPE_MAP[prop.type];
        if (mapped) columns[name] = mapped;
        else skipped.push(`${name}(${prop.type})`);
      }
      if (skipped.length) {
        console.log(
          `   ⚠️  [${title}] 지원하지 않는 컬럼은 제외: ${skipped.join(", ")}`
        );
      }
      result[title] = { dataSourceId: ref.id, columns, hasBody };
    }
  }
  return result;
}

// 페이지의 자식 블록을 100개씩 끝까지 이어 읽는다(페이지네이션).
// 최상위 블록만 본다 — DB를 페이지에 쭉 나열해두면 여기서 다 잡힌다.
// (컬럼/토글 안에 DB를 숨겨두면 그 컨테이너까지 파고들어야 하지만, 지금은 그렇게 쓰지 않는다.)
async function listAllChildren(pageId: string): Promise<any[]> {
  const all: any[] = [];
  let cursor: string | undefined = undefined;
  do {
    const res: any = await notion.blocks.children.list({
      block_id: pageId,
      page_size: 100,
      ...(cursor && { start_cursor: cursor }),
    });
    all.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return all;
}
