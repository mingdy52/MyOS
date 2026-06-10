import { queryDataSource } from "./query.js";

// dataSourceId와 컬럼 매핑은 schema.ts의 project에서 자동으로 가져온다.
export function getProjects() {
  return queryDataSource({
    database: "project",
    sortBy: "기간",
  });
}
