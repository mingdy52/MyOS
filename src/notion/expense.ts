import { 
    notion,
    getTitle,
    getDate,
    getNumber,
    getCheckbox,
    getRichText,
    getMultiSelect,
 } from "./client.js";


export async function getExpenses() {
  const response = await notion.dataSources.query({
    data_source_id: process.env.NOTION_EXPENSE_DATA_SOURCE_ID!,
    sorts: [{ property: "날짜", direction: "descending" }],
  });

  return response.results.map((page: any) => {
    const props = page.properties;
    return {
      내역: getTitle(props, "내역"),
      유형: getMultiSelect(props, "유형"),
      메모: getRichText(props, "메모"),
      금액: getNumber(props, "금액"),
      날짜: getDate(props, "날짜"),
      결제수단: getMultiSelect(props, "결제 수단"),
      줄일수있었는지: getCheckbox(props, "줄일 수 있었나요?"),
    };
  });
}
