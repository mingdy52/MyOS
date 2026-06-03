import { queryDataSource } from "./query.js";
import {
  getTitle,
  getDate,
  getRichText,
  getSelect,
} from "./props.js";

export function getDiaryRecords() {
  return queryDataSource({
    dataSourceId: process.env.NOTION_DIARY_DATA_SOURCE_ID!,
    sortBy: "날짜",
    map: (props) => ({
      날짜: getDate(props, "날짜"),
      제목: getTitle(props, "제목"),
      에너지: getSelect(props, "에너지"),
      스트레스: getSelect(props, "스트레스"),
      기분: getRichText(props, "기분"),
    }),
  });
}
