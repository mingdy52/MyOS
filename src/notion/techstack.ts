import { queryDataSource } from "./query.js";
import {
  getTitle,
  getSelect,
  getRichText,
} from "./props.js";

export function getTechStacks() {
  return queryDataSource({
    dataSourceId: process.env.NOTION_TECHSTACK_DATA_SOURCE_ID!,
    map: (props) => ({
      기술: getTitle(props, "기술"),
      수준: getSelect(props, "수준"),
      프로젝트경험: getSelect(props, "프로젝트 경험"),
      자신감: getSelect(props, "자신감"),
      메모: getRichText(props, "메모"),
    }),
  });
}
