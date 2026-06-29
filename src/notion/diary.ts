import { queryDataSource, dateRange } from "./query.js";
import { getPageText } from "./blocks.js";

// dataSourceId와 컬럼 매핑은 schema.ts의 diary에서 자동으로 가져온다.
export function getDiaryRecords(from?: string, to?: string) {
  return queryDataSource({
    database: "diary",
    sortBy: "날짜",
    filters: dateRange("날짜", from, to),
  });
}

// 본문(페이지 블록)까지 포함한 일기 상세.
// 일기의 실제 내용은 컬럼이 아니라 페이지 본문에 자유 서술로 들어가므로,
// 본문에서 '결정'을 찾는 /decide 같은 작업에는 이 함수를 써야 한다.
// 일기마다 본문을 따로 한 번씩 조회하므로 get_diaries보다 느리다 → 기간을 좁혀 쓰는 게 좋다.
export async function getDiaryDetails(from?: string, to?: string) {
  const rows: any[] = await getDiaryRecords(from, to);
  return Promise.all(
    rows.map(async (row) => ({ ...row, 본문: await getPageText(row.id) }))
  );
}
