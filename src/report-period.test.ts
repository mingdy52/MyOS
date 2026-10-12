import test from "node:test";
import assert from "node:assert/strict";
import { reportPeriod } from "./report-period.js";

// new Date(연, 월-1, 일) — 로컬 시각. reportPeriod도 로컬 기준이라 짝이 맞는다.
const d = (y: number, m: number, day: number) => new Date(y, m - 1, day);

test("주간: 요일과 무관하게 직전 주 월~일", () => {
  // 2026-10-12(월)에 돌리든 2026-10-18(일)에 돌리든 같은 주가 잡혀야 한다.
  for (const day of [12, 15, 18]) {
    const p = reportPeriod(d(2026, 10, day), false);
    assert.equal(p.from, "2026-10-05");
    assert.equal(p.to, "2026-10-11");
    assert.equal(p.title, "2026년 10월 05일 ~ 2026년 10월 11일");
    assert.equal(p.unit, "주");
  }
});

test("주간: 월초에 돌면 지난달로 넘어간다", () => {
  const p = reportPeriod(d(2026, 11, 2), false); // 2026-11-02 월요일
  assert.equal(p.from, "2026-10-26");
  assert.equal(p.to, "2026-11-01");
});

test("월간: 지난달 1일 ~ 말일", () => {
  const p = reportPeriod(d(2026, 11, 1), true);
  assert.equal(p.from, "2026-10-01");
  assert.equal(p.to, "2026-10-31");
  assert.equal(p.title, "2026년 10월");
  assert.equal(p.unit, "달");
});

test("월간: 1월에 돌면 작년 12월", () => {
  const p = reportPeriod(d(2027, 1, 1), true);
  assert.equal(p.from, "2026-12-01");
  assert.equal(p.to, "2026-12-31");
  assert.equal(p.title, "2026년 12월");
});

test("월간: 윤년 2월 말일은 29일", () => {
  assert.equal(reportPeriod(d(2028, 3, 1), true).to, "2028-02-29");
});

test("월간 제목은 월을 0채움한다", () => {
  assert.equal(reportPeriod(d(2026, 10, 1), true).title, "2026년 09월");
  assert.equal(reportPeriod(d(2026, 11, 1), true).title, "2026년 10월");
});
