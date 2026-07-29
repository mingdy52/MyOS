import Anthropic from "@anthropic-ai/sdk";
import { writeFile, readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getRecords } from "./notion/query.js";
import { getPageImages } from "./notion/blocks.js";
import { updateRecord, deleteRecord } from "./notion/mutate.js";
import { MODEL_COMPLEX } from "./model-router.js";
import type { ConfirmWrite } from "./agent/types.js";

const execFileP = promisify(execFile);

// 이 모듈은 "/diet" 전용 파이프라인이다.
// /decide 처럼 ask()(에이전트 루프)에 얹지 않고 따로 만든 이유:
//   에이전트 루프는 도구가 '텍스트'만 주고받는데, 사진 분석은 모델에 '이미지'를 직접 넣어야 한다.
//   그래서 여기서 사진을 꺼내 → Claude(vision)에 넣고 → 결과를 식단 DB에 쓰는 흐름을 직접 짠다.
//
// 규칙(음식 칸이 빈 행만 대상):
//   - 사진 있음 → 분석해서 '음식' 칸을 채운다(쓰기 전 y/N 확인).
//   - 사진 없음 → 껍데기 행으로 보고 삭제한다(휴지통, 30일 복구 가능 / 삭제 전 y/N 확인).

const anthropic = new Anthropic();

// Claude vision이 받아주는 이미지 포맷만 media_type으로 쓴다. HEIC는 여기 없다(=지원 안 함).
type ClaudeMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

// 바이트 앞머리(매직 넘버)로 실제 포맷을 알아낸다. content-type 헤더는 못 믿을 때가 있어 바이트로 판별.
function detectFormat(buf: Buffer): "heic" | "jpeg" | "png" | "gif" | "webp" | "unknown" {
  const head4 = buf.subarray(0, 4).toString("hex");
  const ftyp = buf.subarray(4, 16).toString("ascii"); // ISO-BMFF(mp4/heic 계열)의 'ftyp' 브랜드
  if (/ftyp(heic|heix|hevc|hevx|mif1|msf1|hei)/.test(ftyp)) return "heic";
  if (head4.startsWith("ffd8ff")) return "jpeg";
  if (head4 === "89504e47") return "png";
  if (head4 === "47494638") return "gif";
  if (buf.subarray(0, 4).toString("ascii") === "RIFF") return "webp";
  return "unknown";
}

// 노션 이미지 URL 한 장 → Claude가 읽을 수 있는 base64 이미지 블록으로 바꾼다.
// 핵심: 아이폰 기본 포맷인 HEIC를 Claude가 못 읽으므로, macOS 내장 `sips`로 JPEG으로 변환한다.
// (URL을 그대로 넘기면 노션이 주는 원본 HEIC를 Claude가 받아 "file format invalid"로 튕긴다.)
async function toClaudeImage(
  url: string
): Promise<{ media_type: ClaudeMediaType; data: string } | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  let buf = Buffer.from(await res.arrayBuffer());
  let fmt = detectFormat(buf);

  if (fmt === "heic") {
    // 임시 파일로 떨궈 sips로 JPEG 변환 후 다시 읽어들인다.
    const inPath = join(tmpdir(), `myos-${randomUUID()}.heic`);
    const outPath = inPath.replace(/\.heic$/, ".jpg");
    await writeFile(inPath, buf);
    try {
      await execFileP("sips", ["-s", "format", "jpeg", inPath, "--out", outPath]);
      buf = await readFile(outPath);
      fmt = "jpeg";
    } catch {
      // sips가 없거나(비 macOS) 변환 실패 → 이 사진은 건너뛴다.
      return null;
    } finally {
      await unlink(inPath).catch(() => {});
      await unlink(outPath).catch(() => {});
    }
  }

  if (fmt === "unknown") return null;
  return { media_type: `image/${fmt}` as ClaudeMediaType, data: buf.toString("base64") };
}

// 사진(URL 여러 장)을 Claude에 넣어 "음식 이름만 쉼표로" 받아온다.
async function analyzeFood(imageUrls: string[]): Promise<string> {
  // URL을 base64(필요하면 HEIC→JPEG 변환)로 바꾼다. 못 바꾼 사진은 걸러낸다.
  const images = (await Promise.all(imageUrls.map(toClaudeImage))).filter(
    (x): x is { media_type: ClaudeMediaType; data: string } => x !== null
  );
  if (images.length === 0) return "";

  const content: Anthropic.ContentBlockParam[] = [
    ...images.map((img) => ({
      type: "image" as const,
      source: { type: "base64" as const, media_type: img.media_type, data: img.data },
    })),
    {
      type: "text" as const,
      text:
        "이 사진에 있는 음식을 한국어로 알아봐. " +
        "음식 이름만 쉼표로 구분해 한 줄로 답해. " +
        "설명·인사·문장 없이 음식 이름만. 예: 김치찌개, 공깃밥, 계란말이",
    },
  ];

  const res = await anthropic.messages.create({
    model: MODEL_COMPLEX, // vision 가능한 상위 모델
    max_tokens: 300,
    messages: [{ role: "user", content }],
  });

  const block = res.content.find((b) => b.type === "text");
  return block && block.type === "text" ? block.text.trim() : "";
}

// "음식 칸이 빈" 식단 행들을 훑어, 사진이 있으면 채우고 없으면 삭제한다.
export async function runDiet(confirmWrite: ConfirmWrite): Promise<void> {
  const rows: any[] = await getRecords("diet");
  // 음식 칸이 비어 있는 행만 대상으로 삼는다("" / undefined 모두 빈 것으로 본다).
  const pending = rows.filter((r) => !String(r.음식 ?? "").trim());

  if (pending.length === 0) {
    console.log("🍽  음식 칸이 빈 식단 페이지가 없어요.");
    return;
  }

  let filled = 0;
  let deleted = 0;

  for (const row of pending) {
    const label = `${row.날짜 || "(날짜없음)"} · ${row.식사 || "(식사없음)"}`;
    const images = await getPageImages(row.id);

    // ── 사진 없음 → 껍데기 행. 삭제(휴지통)를 y/N으로 확인한다. ──
    if (images.length === 0) {
      const ok = await confirmWrite(
        `🗑  ${label} — 사진이 없는 빈 페이지. 삭제할까요? (y/N) `
      );
      if (!ok) {
        console.log("   건너뜀");
        continue;
      }
      await deleteRecord("diet", row.id);
      console.log("   ✅ 삭제(휴지통으로 이동)");
      deleted++;
      continue;
    }

    // ── 사진 있음 → 분석해서 '음식' 칸 채우기. 쓰기를 y/N으로 확인한다. ──
    console.log(`🔍 ${label} — 사진 ${images.length}장 분석 중...`);
    const foods = await analyzeFood(images);
    if (!foods) {
      console.log("   ⚠️  음식을 알아보지 못했어요. 건너뜀");
      continue;
    }
    console.log(`   → 음식: ${foods}`);

    const ok = await confirmWrite("   이 값으로 '음식' 칸을 채울까요? (y/N) ");
    if (!ok) {
      console.log("   건너뜀");
      continue;
    }
    await updateRecord("diet", row.id, { 음식: foods });
    console.log("   ✅ 기록 완료");
    filled++;
  }

  console.log(`\n🍽  끝. ${filled}건 채우고, ${deleted}건 삭제했어요.`);
}
