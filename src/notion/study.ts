import { queryDataSource } from "./query.js";
import {
  getTitle,
  getDate,
  getNumber,
  getRichText,
  getSelect,
} from "./props.js";

export function getStudyRecords() {
  return queryDataSource({
    dataSourceId: process.env.NOTION_STUDY_DATA_SOURCE_ID!,
    sortBy: "날짜",
    map: (props) => ({
      날짜: getDate(props, "날짜"),
      과목: getTitle(props, "과목"),
      시간: getNumber(props, "시간"),
      집중도: getSelect(props, "집중도"),
      메모: getRichText(props, "메모"),
    }),
  });
}
