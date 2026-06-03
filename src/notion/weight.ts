import { queryDataSource } from "./query.js";
import {
  getTitle,
  getDate,
} from "./props.js";

export function getWeightRecords() {
  return queryDataSource({
    dataSourceId: process.env.NOTION_WEIGHT_DATA_SOURCE_ID!,
    sortBy: "날짜",
    map: (props) => ({
      날짜: getDate(props, "날짜"),
      체중: getTitle(props, "체중"),
    }),
  });
}
