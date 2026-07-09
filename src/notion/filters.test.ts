import { test } from "node:test";
import assert from "node:assert/strict";
import { dateRange, containsFilter } from "./filters.js";

// ── dateRange: from/to 조합에 따라 노션 date 필터 조각을 만든다 ──
// 이 함수가 어긋나면 "이번 주", "지난 달" 같은 기간 질의가 통째로 틀린 데이터를 긁어온다.

test("from만 주면 on_or_after 하나만 만든다", () => {
  assert.deepEqual(dateRange("날짜", "2026-06-01", undefined), [
    { property: "날짜", date: { on_or_after: "2026-06-01" } },
  ]);
});

test("to만 주면 on_or_before 하나만 만든다", () => {
  assert.deepEqual(dateRange("날짜", undefined, "2026-06-30"), [
    { property: "날짜", date: { on_or_before: "2026-06-30" } },
  ]);
});

test("from/to 둘 다 주면 두 조건을 만든다", () => {
  assert.deepEqual(dateRange("지원일", "2026-06-01", "2026-06-30"), [
    { property: "지원일", date: { on_or_after: "2026-06-01" } },
    { property: "지원일", date: { on_or_before: "2026-06-30" } },
  ]);
});

test("둘 다 없으면 빈 배열(=필터 없음, 전체 조회)", () => {
  assert.deepEqual(dateRange("날짜"), []);
});

test("컬럼명은 인자로 받은 걸 그대로 쓴다(DB마다 다름)", () => {
  const [cond] = dateRange("기간", "2026-01-01", undefined);
  assert.equal(cond?.property, "기간");
});

// ── containsFilter: 컬럼 타입에 맞는 부분검색 필터를 만든다 ──
// title/multi_select/select/그 외(text)에서 노션이 요구하는 연산자가 각각 다르다.

test("title은 title.contains로 부분검색한다", () => {
  assert.deepEqual(containsFilter("title", "운동", "수영"), {
    property: "운동",
    title: { contains: "수영" },
  });
});

test("multi_select는 multi_select.contains로 검색한다", () => {
  assert.deepEqual(containsFilter("multi_select", "유형", "식비"), {
    property: "유형",
    multi_select: { contains: "식비" },
  });
});

test("select는 부분검색이 아니라 equals로 정확히 맞춘다", () => {
  assert.deepEqual(containsFilter("select", "강도", "높음"), {
    property: "강도",
    select: { equals: "높음" },
  });
});

test("text·기타·미상(undefined) 타입은 rich_text.contains로 떨어진다", () => {
  const expected = { property: "메모", rich_text: { contains: "회고" } };
  assert.deepEqual(containsFilter("text", "메모", "회고"), expected);
  assert.deepEqual(containsFilter(undefined, "메모", "회고"), expected);
});
