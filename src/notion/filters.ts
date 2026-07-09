// 노션 dataSources.query에 넘길 filter 조각들을 만드는 순수 함수 모음.
// query.ts에서 빼낸 이유: 이 파일은 부작용이 없어(타입만 import) 단위 테스트로 검증할 수 있다.
// (query.ts는 schema.ts를 통해 노션 클라이언트를 딸고 오므로 그냥 import하면 네트워크가 붙는다.)
import type { FieldType } from "./schema.js";

// 날짜 범위 조건들을 배열로 만들어 돌려준다.
// 컬럼명(property)은 DB마다 다를 수 있어 인자로 받는다.
// from만/to만/둘 다/둘 다 없음 모두 처리. (없으면 빈 배열)
export function dateRange(property: string, from?: string, to?: string) {
  const conds = [];
  if (from) conds.push({ property, date: { on_or_after: from } });
  if (to) conds.push({ property, date: { on_or_before: to } });
  return conds;
}

// 컬럼 타입에 맞는 '부분검색(contains)' 필터를 만든다.
// 운동 이름(title 안에 글자 포함)·지출 유형(multi_select 포함) 같은 걸 거를 때 쓴다.
export function containsFilter(
  type: FieldType | undefined,
  column: string,
  value: string
) {
  switch (type) {
    case "multi_select":
      return { property: column, multi_select: { contains: value } };
    case "title":
      return { property: column, title: { contains: value } };
    case "select":
      return { property: column, select: { equals: value } };
    default: // text 등
      return { property: column, rich_text: { contains: value } };
  }
}
