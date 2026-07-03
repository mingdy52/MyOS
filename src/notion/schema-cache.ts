import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { DiscoveredSchemas } from "./discover.js";

// 발견한 스키마를 저장해 두는 파일. 있으면 노션을 다시 안 훑고 여기서 바로 읽는다.
// (프로젝트 루트/.cache/notion-schema.json — .gitignore로 커밋에서 제외한다.)
const CACHE_PATH = fileURLToPath(
  new URL("../../.cache/notion-schema.json", import.meta.url)
);

export function loadCache(): DiscoveredSchemas | null {
  if (!existsSync(CACHE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CACHE_PATH, "utf8"));
  } catch {
    // 캐시가 깨졌으면 없는 셈 치고 다시 발견하게 한다.
    return null;
  }
}

export function saveCache(data: DiscoveredSchemas): void {
  mkdirSync(dirname(CACHE_PATH), { recursive: true });
  writeFileSync(CACHE_PATH, JSON.stringify(data, null, 2), "utf8");
}
