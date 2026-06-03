import { queryDataSource } from "./query.js";
import {
  getTitle,
  getDate,
  getStatus,
  getMultiSelect,
  getRichText,
  getSelect,
} from "./props.js";

export function getProjects() {
  return queryDataSource({
    dataSourceId: process.env.NOTION_PROJECT_DATA_SOURCE_ID!,
    sortBy: "기간",
    map: (props) => ({
      프로젝트: getTitle(props, "프로젝트"),
      상태: getStatus(props, "상태"),
      구분: getSelect(props, "구분"),
      회사: getSelect(props, "회사"),
      역할: getSelect(props, "역할"),
      기술: getMultiSelect(props, "기술"),
      기간: getDate(props, "기간"),
      메모: getRichText(props, "메모"),
    }),
  });
}
