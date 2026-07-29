import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDuration } from "./youtube.js";

// 유튜브는 영상 길이를 "PT4M13S" 같은 ISO-8601 기간 문자열로만 준다.
// 이걸 초로 못 바꾸면 "짧은 영상만 골라줘" 같은 요청을 처리할 수 없다.
// (youtube.ts는 네트워크를 모듈 수준에서 건드리지 않아서 그냥 import해도 안전하다.)

test("분·초가 다 있는 형식을 초로 바꾼다", () => {
  assert.equal(parseDuration("PT4M13S"), 253);
});

test("초만 있는 짧은 영상도 읽는다", () => {
  assert.equal(parseDuration("PT45S"), 45);
});

test("시간이 들어간 긴 영상도 읽는다", () => {
  assert.equal(parseDuration("PT1H2M30S"), 3750);
});

test("중간 단위가 빠져도 남은 단위만으로 계산한다", () => {
  // 1시간 30초 (분이 없음) — 유튜브가 실제로 이렇게 준다.
  assert.equal(parseDuration("PT1H30S"), 3630);
});

test("0초짜리도 undefined가 아니라 0으로 준다", () => {
  // 0은 falsy라서, 값이 '없는 것'과 헷갈리지 않는지 확인한다.
  assert.equal(parseDuration("PT0S"), 0);
});

test("형식이 아니면 undefined — 억지로 0으로 만들지 않는다", () => {
  // 못 읽은 걸 0으로 두면 "0초짜리 영상"으로 오해받는다.
  assert.equal(parseDuration(""), undefined);
  assert.equal(parseDuration("4분13초"), undefined);
});
