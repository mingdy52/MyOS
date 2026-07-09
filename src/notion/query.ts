import { notion } from "./client.js";
import { schemas } from "./schema.js";
import { readProperty } from "./props.js";
import { getPageText } from "./blocks.js";
// 필터 조각 생성기는 부작용 없는 순수 모듈로 분리했다(단위 테스트 대상). filters.test.ts 참고.
import { dateRange, containsFilter } from "./filters.js";

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

// 모든 조회의 단일 진입점. (예전엔 DB마다 리더 파일이 하나씩 있었지만, 이제 이 함수 하나로 통일.)
//  - 그 DB에 날짜 컬럼이 있으면 그 컬럼으로 기간(from/to) 필터 + 최신순 정렬을 자동으로 건다.
//  - contains를 주면 그 컬럼을 부분검색으로 거른다(예: 운동="수영", 지출 유형="식비").
//  - 본문형 DB(제목이 '+'라 hasBody=true)이거나 withBody=true면 각 행의 페이지 본문까지 읽어 붙인다.
//    (withBody를 명시하면 hasBody보다 우선한다. 집계 질문 등에서 false로 꺼 빠르게 조회 가능.)
export async function getRecords(
  database: string,
  opts: {
    from?: string;
    to?: string;
    withBody?: boolean;
    contains?: { column: string; value: string };
  } = {}
) {
  const schema = schemas[database];
  if (!schema) throw new Error(`알 수 없는 데이터베이스: ${database}`);

  // 날짜 컬럼(보통 DB당 하나)을 찾아 정렬·기간 필터에 쓴다.
  const dateColumn = Object.entries(schema.columns).find(
    ([, type]) => type === "date"
  )?.[0];

  const filters: any[] = [];
  if (dateColumn) filters.push(...dateRange(dateColumn, opts.from, opts.to));
  if (opts.contains?.value) {
    const { column, value } = opts.contains;
    filters.push(containsFilter(schema.columns[column], column, value));
  }

  const rows: any[] = await queryDataSource({
    database,
    ...(dateColumn && { sortBy: dateColumn }),
    filters,
  });

  const includeBody = opts.withBody ?? schema.hasBody ?? false;
  if (!includeBody) return rows;
  // 본문까지: 행마다 페이지 본문을 읽어 '본문' 필드로 붙인다(일기·알고리즘 로그 등).
  return Promise.all(
    rows.map(async (row) => ({ ...row, 본문: await getPageText(row.id) }))
  );
}
