import { test } from "node:test";
import assert from "node:assert/strict";
import { topFoods } from "./diet-rank.js";

// 계약: 같은 식사(점심 등)만 세고, 많이 먹은 순 → 같으면 최근 순, 빈 칸은 무시.
test("같은 식사만 세고 많이 먹은 순으로 준다", () => {
  const rows = [
    { 식사: "점심", 음식: "김치찌개" }, // 최신순으로 들어온다고 가정
    { 식사: "저녁", 음식: "삼겹살" },
    { 식사: "점심", 음식: "된장찌개" },
    { 식사: "점심", 음식: "김치찌개" },
    { 식사: "점심", 음식: "  " },
    { 식사: "점심" },
  ];
  assert.deepEqual(topFoods(rows, "점심"), [
    { 음식: "김치찌개", 횟수: 2 },
    { 음식: "된장찌개", 횟수: 1 },
  ]);
});

test("횟수가 같으면 더 최근에 먹은 음식이 위로 온다", () => {
  const rows = [
    { 식사: "아침", 음식: "샐러드" },
    { 식사: "아침", 음식: "토스트" },
  ];
  assert.deepEqual(topFoods(rows, "아침").map((t) => t.음식), ["샐러드", "토스트"]);
});
