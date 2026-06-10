import { notion } from "./client.js";
import { schemas } from "./schema.js";
import { readProperty } from "./props.js";

// 스키마(컬럼 → 타입)만 보고, 한 행(props)을 읽어 객체로 만드는 map 함수를 자동으로 만든다.
// 리더가 getTitle/getNumber... 를 나열할 필요가 없어진다. (queryDataSource가 database를 받으면 내부에서 호출)
// 결과의 키는 노션 컬럼명 그대로라, 쓰기(create/update) 때 쓰는 컬럼명과 똑같아진다.
export function buildMap(database: string) {
  const schema = schemas[database];
  if (!schema) throw new Error(`알 수 없는 데이터베이스: ${database}`);

  return (props: any) => {
    const row: Record<string, any> = {};
    for (const [name, type] of Object.entries(schema.columns)) {
      row[name] = readProperty(props, name, type);
    }
    return row;
  };
}

// 모든 리더가 공통으로 쓰는 조회 헬퍼.
//  - database  : schema에 등록된 DB 이름. 주면 dataSourceId·map을 schema에서 꺼낸다.
//  - dataSourceId / map : 아직 schema에 없는 DB는 이 둘을 직접 넘긴다.
//  - sortBy    : 이 컬럼 기준 내림차순 정렬. 없으면 정렬 안 함.
//  - filters   : 조건들의 배열. 1개 이상이면 { and: [...] }로 묶어 보낸다. (없으면 전체 조회)
export async function queryDataSource(options: {
  database?: string;
  dataSourceId?: string;
  map?: (props: any) => any;
  sortBy?: string;
  filters?: any[];
}) {
  const { database, sortBy, filters } = options;

  // database가 있으면 schema가 단일 진실 공급원: dataSourceId도 map도 거기서 나온다.
  const schema = database ? schemas[database] : undefined;
  const dataSourceId = schema?.dataSourceId ?? options.dataSourceId!;
  const map = options.map ?? (database ? buildMap(database) : (p: any) => p);

  const response = await notion.dataSources.query({
    data_source_id: dataSourceId,
    // sortBy가 있을 때만 sorts를 붙인다.
    ...(sortBy && {
      sorts: [{ property: sortBy, direction: "descending" as const }],
    }),
    // 조건이 1개 이상일 때만 and로 묶어서 filter를 붙인다.
    ...(filters && filters.length > 0 && { filter: { and: filters } }),
  });

  // id를 함께 돌려준다. 수정(update_record) 때 어떤 행인지 가리키는 데 쓴다.
  return response.results.map((page: any) => ({
    id: page.id,
    ...map(page.properties),
  }));
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
