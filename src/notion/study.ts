import { queryDataSource, dateRange } from "./query.js";

// dataSourceId와 컬럼 매핑은 schema.ts의 study에서 자동으로 가져온다.
export function getStudyRecords(from?: string, to?: string) {
  return queryDataSource({
    database: "study",
    sortBy: "날짜",
    filters: dateRange("날짜", from, to),
  });
}
