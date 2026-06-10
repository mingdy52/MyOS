import { queryDataSource } from "./query.js";

// dataSourceId와 컬럼 매핑은 schema.ts의 techstack에서 자동으로 가져온다.
export function getTechStacks() {
  return queryDataSource({
    database: "techstack",
  });
}
