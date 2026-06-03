import { queryDataSource, dateRange } from "./query.js";
import {
  getTitle,
  getDate,
  getNumber,
  getRichText,
  getSelect,
  getStatus,
} from "./props.js";

export function getTargets(from?: string, to?: string) {
  return queryDataSource({
    dataSourceId: process.env.NOTION_TARGET_DATA_SOURCE_ID!,
    sortBy: "날짜",
    filters: dateRange("날짜", from, to),
    map: (props) => ({
      목표: getTitle(props, "목표"),
      카테고리: getSelect(props, "카테고리"),
      목표값: getNumber(props, "목표값"),
      단위: getRichText(props, "단위"),
      날짜: getDate(props, "날짜"),
      중요도: getSelect(props, "중요도"),
      상태: getStatus(props, "상태"),
    }),
  });
}
