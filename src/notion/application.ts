import { queryDataSource, dateRange } from "./query.js";

// dataSourceId와 컬럼 매핑은 schema.ts의 application에서 자동으로 가져온다.
export function getApplications(from?: string, to?: string) {
  return queryDataSource({
    database: "application",
    sortBy: "지원일",
    filters: dateRange("지원일", from, to),
  });
}
