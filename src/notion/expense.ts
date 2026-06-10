import { queryDataSource, dateRange } from "./query.js";

// 유형 예: "식비". 주면 그 유형만 거른다.
// dataSourceId와 컬럼 매핑은 schema.ts의 expense에서 자동으로 가져온다.
export function getExpenses(from?: string, to?: string, 유형?: string) {
  return queryDataSource({
    database: "expense",
    sortBy: "날짜",
    filters: [
      ...dateRange("날짜", from, to),
      ...(유형 ? [{ property: "유형", multi_select: { contains: 유형 } }] : []),
    ],
  });
}
