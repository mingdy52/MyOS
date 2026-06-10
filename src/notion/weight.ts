import { queryDataSource, dateRange } from "./query.js";

// dataSourceId와 컬럼 매핑은 schema.ts의 weight에서 자동으로 가져온다.
export function getWeightRecords(from?: string, to?: string) {
  return queryDataSource({
    database: "weight",
    sortBy: "날짜",
    filters: dateRange("날짜", from, to),
  });
}
