import type { DbSchema } from "./schema.js";
import { discoverFromPage, type DiscoveredSchemas } from "./discover.js";
import { loadCache, saveCache } from "./schema-cache.js";

// 발견 결과(제목 → { ds, 컬럼 })를 실제 schemas 객체에 반영한다.
//  - 발견한 제목이 기존 역할(role)의 title과 같으면 → 그 역할의 dataSourceId·컬럼을
//    노션 기준으로 갱신한다(노션이 진실. 컬럼을 손으로 안 적어도 됨).
//  - 어느 역할과도 안 맞으면 → 제목을 그대로 키로 새로 추가한다.
//    (=코드 한 줄 안 고쳐도 새 DB가 조회/쓰기 도구에 바로 등장한다.)
//  - 발견되지 않은 역할(예: 부모 페이지 밖에 있는 가계부)은 정적 스키마 그대로 둔다.
function apply(
  schemas: Record<string, DbSchema>,
  found: DiscoveredSchemas
): void {
  // title → role 역방향 색인.
  const roleByTitle = new Map<string, string>();
  for (const [role, s] of Object.entries(schemas)) {
    if (s.title) roleByTitle.set(s.title, role);
  }

  for (const [title, disc] of Object.entries(found)) {
    const role = roleByTitle.get(title);
    if (role) {
      schemas[role]!.dataSourceId = disc.dataSourceId;
      schemas[role]!.columns = disc.columns;
      schemas[role]!.hasBody = disc.hasBody;
    } else {
      schemas[title] = {
        title,
        dataSourceId: disc.dataSourceId,
        columns: disc.columns,
        hasBody: disc.hasBody,
      };
    }
  }
}

// 스키마를 노션에서 동적으로 채운다.
//  - 평소: 캐시 파일만 읽어 반영 → 네트워크 호출 0.
//  - refresh=true: 부모 페이지를 다시 훑어 캐시를 갱신하고 반영.
//  - 부모 페이지도 캐시도 없으면: 정적 스키마(seed)로만 동작(기존과 동일).
// 발견에 실패해도 앱이 죽지 않도록 통째로 감싼다.
export async function syncSchemas(
  schemas: Record<string, DbSchema>,
  opts: { refresh?: boolean } = {}
): Promise<void> {
  // 모든 DB가 들어있는 부모 페이지 id. 이것만 알면 안의 DB들을 훑을 수 있다.
  const pageId = process.env.NOTION_DATA_PAGE_ID;

  try {
    let found = opts.refresh ? null : loadCache();

    if (!found) {
      if (!pageId) {
        if (opts.refresh) {
          console.log(
            "⚠️  NOTION_DATA_PAGE_ID 가 없어 동적 발견을 건너뜁니다(정적 스키마 사용)."
          );
        }
        return;
      }
      console.log("🔎 노션 부모 페이지에서 DB 스키마를 발견하는 중…");
      found = await discoverFromPage(pageId);
      saveCache(found);
      console.log(
        `   ✓ ${Object.keys(found).length}개 DB 발견 → 캐시에 저장했어요.`
      );
    }

    apply(schemas, found);
  } catch (e: any) {
    console.log(
      `⚠️  스키마 동적 발견 실패(정적 스키마로 계속 진행): ${e?.message ?? e}`
    );
  }
}
