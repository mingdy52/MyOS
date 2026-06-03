import { queryDataSource } from "./query.js";
import {
  getTitle,
  getDate,
  getRichText,
  getSelect,
} from "./props.js";

export function getWorkoutRecords() {
  return queryDataSource({
    dataSourceId: process.env.NOTION_WORKOUT_DATA_SOURCE_ID!,
    sortBy: "날짜",
    map: (props) => ({
      날짜: getDate(props, "날짜"),
      운동: getTitle(props, "운동"),
      시간: getRichText(props, "시간"),
      강도: getSelect(props, "강도"),
    }),
  });
}
