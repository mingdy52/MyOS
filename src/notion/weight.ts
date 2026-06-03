import { queryDataSource, dateRange } from "./query.js";
import {
  getTitle,
  getDate,
} from "./props.js";

export function getWeightRecords(from?: string, to?: string) {
  return queryDataSource({
    dataSourceId: process.env.NOTION_WEIGHT_DATA_SOURCE_ID!,
    sortBy: "날짜",
    filters: dateRange("날짜", from, to),
    map: (props) => ({
      날짜: getDate(props, "날짜"),
      체중: getTitle(props, "체중"),
    }),
  });
}
