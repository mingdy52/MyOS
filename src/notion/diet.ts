import { queryDataSource } from "./query.js";
import {
  getTitle,
  getDate,
  getRichText,
} from "./props.js";

export function getDietRecords() {
  return queryDataSource({
    dataSourceId: process.env.NOTION_DIET_DATA_SOURCE_ID!,
    sortBy: "날짜",
    map: (props) => ({
      날짜: getDate(props, "날짜"),
      식사: getTitle(props, "식사"),
      음식: getRichText(props, "음식"),
    }),
  });
}
