import { notion } from "./client.js";

// 모든 리더가 공통으로 하는 일을 모아둔 헬퍼.
//  - dataSourceId : 어떤 노션 데이터소스를 읽을지
//  - map          : 한 행(page)의 props를 받아서 원하는 모양으로 가공하는 함수
//  - sortBy       : 이 컬럼 기준으로 내림차순 정렬. 없으면 정렬 안 함.
//  - filters      : 조건들의 배열. 1개 이상이면 자동으로 { and: [...] }로 묶어서 보낸다.
//                   (비어 있거나 없으면 필터 없이 전체 조회)
export async function queryDataSource(options: {
  dataSourceId: string;
  map: (props: any) => any;
  sortBy?: string;
  filters?: any[];
}) {
  const { dataSourceId, map, sortBy, filters } = options;

  const response = await notion.dataSources.query({
    data_source_id: dataSourceId,
    // sortBy가 있을 때만 sorts를 붙인다.
    ...(sortBy && {
      sorts: [{ property: sortBy, direction: "descending" as const }],
    }),
    // 조건이 1개 이상일 때만 and로 묶어서 filter를 붙인다.
    ...(filters && filters.length > 0 && { filter: { and: filters } }),
  });

  return response.results.map((page: any) => map(page.properties));
}

// 날짜 범위 조건들을 배열로 만들어 돌려준다.
// 컬럼명(property)은 DB마다 다를 수 있어 인자로 받는다.
// from만/to만/둘 다/둘 다 없음 모두 처리. (없으면 빈 배열)
export function dateRange(property: string, from?: string, to?: string) {
  const conds = [];
  if (from) conds.push({ property, date: { on_or_after: from } });
  if (to) conds.push({ property, date: { on_or_before: to } });
  return conds;
}
