import { queryDataSource } from "./query.js";
import {
  getTitle,
  getDate,
  getStatus,
  getRichText,
  getSelect,
} from "./props.js";

export function getApplications() {
  return queryDataSource({
    dataSourceId: process.env.NOTION_APPLICATION_DATA_SOURCE_ID!,
    sortBy: "지원일",
    map: (props) => ({
      회사: getTitle(props, "회사"),
      직무: getSelect(props, "직무"),
      상태: getStatus(props, "상태"),
      지원일: getDate(props, "지원일"),
      메모: getRichText(props, "메모"),
    }),
  });
}
