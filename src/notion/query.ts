import { notion } from "./client.js";

// 모든 리더가 공통으로 하는 일을 모아둔 헬퍼.
//  - dataSourceId : 어떤 노션 데이터소스를 읽을지
//  - map          : 한 행(page)의 props를 받아서 원하는 모양으로 가공하는 함수
//  - sortBy       : 이 컬럼 기준으로 내림차순 정렬. 없으면 정렬 안 함.
export async function queryDataSource(options: {
  dataSourceId: string;
  map: (props: any) => any;
  sortBy?: string;
}) {
  const { dataSourceId, map, sortBy } = options;

  const response = await notion.dataSources.query({
    data_source_id: dataSourceId,
    // sortBy가 있을 때만 sorts를 붙인다.
    ...(sortBy && {
      sorts: [{ property: sortBy, direction: "descending" as const }],
    }),
  });

  return response.results.map((page: any) => map(page.properties));
}
