import { queryDataSource, dateRange } from "./query.js";
import {
  getTitle,
  getDate,
  getNumber,
  getRichText,
  getSelect,
} from "./props.js";

export function getStudyRecords(from?: string, to?: string) {
  return queryDataSource({
    dataSourceId: process.env.NOTION_STUDY_DATA_SOURCE_ID!,
    sortBy: "날짜",
    filters: dateRange("날짜", from, to),
    map: (props) => ({
      날짜: getDate(props, "날짜"),
      과목: getTitle(props, "과목"),
      시간: getNumber(props, "시간"),
      집중도: getSelect(props, "집중도"),
      메모: getRichText(props, "메모"),
    }),
  });
}
