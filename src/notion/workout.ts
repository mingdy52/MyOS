import { queryDataSource, dateRange } from "./query.js";
import {
  getTitle,
  getDate,
  getRichText,
  getSelect,
} from "./props.js";

// 운동 예: "수영". 주면 운동 이름에 그 글자가 들어간 것만 거른다.
export function getWorkoutRecords(from?: string, to?: string, 운동?: string) {
  return queryDataSource({
    dataSourceId: process.env.NOTION_WORKOUT_DATA_SOURCE_ID!,
    sortBy: "날짜",
    filters: [
      ...dateRange("날짜", from, to),
      ...(운동 ? [{ property: "운동", title: { contains: 운동 } }] : []),
    ],
    map: (props) => ({
      날짜: getDate(props, "날짜"),
      운동: getTitle(props, "운동"),
      시간: getRichText(props, "시간"),
      강도: getSelect(props, "강도"),
    }),
  });
}
