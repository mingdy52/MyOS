import { queryDataSource, dateRange } from "./query.js";
import {
  getTitle,
  getDate,
  getNumber,
  getCheckbox,
  getRichText,
  getMultiSelect,
} from "./props.js";

// 유형 예: "식비". 주면 그 유형만 거른다.
export function getExpenses(from?: string, to?: string, 유형?: string) {
  return queryDataSource({
    dataSourceId: process.env.NOTION_EXPENSE_DATA_SOURCE_ID!,
    sortBy: "날짜",
    filters: [
      ...dateRange("날짜", from, to),
      ...(유형 ? [{ property: "유형", multi_select: { contains: 유형 } }] : []),
    ],
    map: (props) => ({
      내역: getTitle(props, "내역"),
      유형: getMultiSelect(props, "유형"),
      메모: getRichText(props, "메모"),
      금액: getNumber(props, "금액"),
      날짜: getDate(props, "날짜"),
      결제수단: getMultiSelect(props, "결제 수단"),
      줄일수있었는지: getCheckbox(props, "줄일 수 있었나요?"),
    }),
  });
}
