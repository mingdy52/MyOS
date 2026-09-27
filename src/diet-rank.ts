// 최근 식단 행들을 "자주 먹은 음식" 순으로 센다.
// 노션·SDK import가 없는 순수 함수라 키 없이 테스트할 수 있어 diet.ts에서 떼어냈다.
// 음식 문자열은 쪼개지 않고 통째로 센다 — "김치찌개, 공깃밥"처럼 한 끼 구성 그대로 골라 넣는 게 목적이라서.
export type DietRow = { 식사?: string; 음식?: string };

export function topFoods(
  rows: DietRow[],
  meal: string
): { 음식: string; 횟수: number }[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (String(row.식사 ?? "").trim() !== meal) continue;
    const food = String(row.음식 ?? "").trim();
    if (!food) continue;
    counts.set(food, (counts.get(food) ?? 0) + 1);
  }
  // 정렬은 안정적이고 Map은 삽입 순서를 지킨다 → 같은 횟수면 더 최근에 먹은 게 위로 온다
  // (호출부가 최신순으로 정렬된 행을 넘기므로).
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([음식, 횟수]) => ({ 음식, 횟수 }));
}
