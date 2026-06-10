import { queryDataSource, dateRange } from "./query.js";

// 운동 예: "수영". 주면 운동 이름에 그 글자가 들어간 것만 거른다.
// dataSourceId와 컬럼 매핑은 schema.ts의 workout에서 자동으로 가져온다.
export function getWorkoutRecords(from?: string, to?: string, 운동?: string) {
  return queryDataSource({
    database: "workout",
    sortBy: "날짜",
    filters: [
      ...dateRange("날짜", from, to),
      ...(운동 ? [{ property: "운동", title: { contains: 운동 } }] : []),
    ],
  });
}
