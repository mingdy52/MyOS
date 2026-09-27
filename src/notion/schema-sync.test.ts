import { test } from "node:test";
import assert from "node:assert/strict";
import { apply } from "./schema-sync.js";
import type { DbSchema } from "./schema.js";
import type { DiscoveredSchemas } from "./discover.js";

// 발견 결과 한 건을 짧게 만드는 헬퍼(컬럼 내용은 이 테스트의 관심사가 아니다).
const disc = (): DiscoveredSchemas[string] => ({
  dataSourceId: "ds-new",
  columns: { 제목: "title" },
  hasBody: false,
});

test("노션에서 지운 DB는 refresh 시 스키마에서도 빠진다", () => {
  const schemas: Record<string, DbSchema> = {
    diet: { title: "식단", dataSourceId: "ds-old", columns: {} },
    // 발견으로 자동 추가된(역할 없는) DB — 키가 곧 제목이다.
    "알고리즘 로그": { title: "알고리즘 로그", dataSourceId: "ds-x", columns: {} },
    // 부모 페이지 밖이라 발견된 적이 없는 DB(정적 seed).
    expense: { title: "가계부", dataSourceId: "ds-env", columns: {} },
  };
  const prev: DiscoveredSchemas = { 식단: disc(), "알고리즘 로그": disc() };

  apply(schemas, { 식단: disc() }, prev); // 알고리즘 로그를 노션에서 삭제한 상황

  assert.deepEqual(Object.keys(schemas), ["diet", "expense"]);
  assert.equal(schemas.diet!.dataSourceId, "ds-new"); // 남은 DB는 갱신된다
  assert.equal(schemas.expense!.dataSourceId, "ds-env"); // 정적 seed는 건드리지 않는다
});
