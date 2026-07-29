import { readFile, writeFile, mkdir } from "node:fs/promises";

// ── 장기 기억 ─────────────────────────────────────────────────
// 대화 기록(messages)과는 다른 물건이다.
//   대화 기록 = 이번 대화 안에서만 유효. "clear"를 치거나 프로그램을 끄면 사라진다.
//   장기 기억 = 그 둘을 다 넘어서 남는다. 다음 주에 다시 켜도 그대로 있다.
//
// 왜 필요한가: 지금은 "요즘 어때?"를 물을 때마다 일기를 처음부터 다시 읽는다.
// 그런데 "월요일마다 방전된다" 같은 건 한 번 알아내면 계속 참인 사실이다.
// 그걸 적어두면 매번 다시 읽지 않아도 되고, 무엇보다 비서가 나를 '알게' 된다.
//
// 저장은 로컬 파일이다. 노션이 아닌 이유: 이 기억은 질문할 때마다 매번 읽는다.
// 노션에 두면 질문 하나당 네트워크 왕복이 한 번씩 더 붙는다(파일은 사실상 0).
// 나중에 노션으로 옮기고 싶으면 이 파일만 고치면 된다 — 바깥에서는 아래 함수들만 쓴다.
//
// .cache/ 에 두지 않은 이유: 캐시는 지워도 refresh로 다시 만들 수 있지만,
// 기억은 지우면 영영 사라진다. 성격이 달라서 폴더를 나눴다.
const FILE = "data/memory.json";

// 기억이 무한정 쌓이면 매 질문의 시스템 프롬프트가 계속 무거워진다.
// 한도에 닿으면 새로 못 넣게 막고, 오래된 걸 지우라고 알려준다.
// (오래된 것을 자동으로 버리지 않는 이유: 무엇이 덜 중요한지는 사람이 정할 일이다.)
export const MAX_MEMORIES = 50;

// 기억의 갈래. 이 네 가지 말고는 받지 않아서 표현이 제멋대로 늘어나는 걸 막는다.
export const CATEGORIES = ["패턴", "선호", "상황", "목표"] as const;

export type Memory = {
  id: string; // "m1", "m2" … 지울 때 가리키는 이름
  분류: (typeof CATEGORIES)[number];
  내용: string;
  날짜: string; // 기억한 날 (YYYY-MM-DD). 오래된 기억을 의심할 근거가 된다.
};

// 파일을 매 질문마다 읽지 않으려고 한 번 읽어서 들고 있는다.
// (이 프로세스가 유일한 필자라서 남이 몰래 바꿀 걱정이 없다.)
let cache: Memory[] | null = null;

export async function loadMemories(): Promise<Memory[]> {
  if (cache) return cache;
  try {
    cache = JSON.parse(await readFile(FILE, "utf8"));
  } catch {
    // 파일이 아직 없거나 깨졌으면 빈 기억으로 시작한다(첫 실행이 이 경우다).
    cache = [];
  }
  return cache!;
}

async function save(list: Memory[]): Promise<void> {
  await mkdir("data", { recursive: true });
  // 사람이 열어볼 파일이라 들여쓰기를 준다. 직접 고치거나 지워도 된다.
  await writeFile(FILE, JSON.stringify(list, null, 2) + "\n", "utf8");
  cache = list;
}

// 다음 id. 지운 자리를 재사용하지 않으려고 "가장 큰 번호 + 1"로 매긴다.
// (재사용하면 방금 지운 기억의 id가 다른 기억을 가리키게 되어 헷갈린다.)
function nextId(list: Memory[]): string {
  const max = list.reduce((n, m) => Math.max(n, Number(m.id.slice(1)) || 0), 0);
  return `m${max + 1}`;
}

// 새 기억을 더한다. 한도를 넘으면 더하지 않고 이유를 돌려준다.
export async function addMemory(
  분류: Memory["분류"],
  내용: string,
  날짜: string
): Promise<{ ok: boolean; message: string; memory?: Memory }> {
  const list = [...(await loadMemories())];

  // 똑같은 내용을 또 적지 않는다. (글자가 완전히 같을 때만 — 비슷한 건 사람이 판단할 몫)
  const same = list.find((m) => m.내용 === 내용);
  if (same) {
    return { ok: false, message: `이미 같은 기억이 있다 (${same.id}).` };
  }

  if (list.length >= MAX_MEMORIES) {
    return {
      ok: false,
      message:
        `기억이 한도(${MAX_MEMORIES}개)에 찼다. ` +
        "덜 중요하거나 낡은 기억을 forget으로 먼저 지운 뒤 다시 시도해라.",
    };
  }

  const memory: Memory = { id: nextId(list), 분류, 내용, 날짜 };
  list.push(memory);
  await save(list);
  return { ok: true, message: "기억했다.", memory };
}

// 기억 하나를 지운다. 없는 id면 false.
export async function removeMemory(id: string): Promise<boolean> {
  const list = await loadMemories();
  const next = list.filter((m) => m.id !== id);
  if (next.length === list.length) return false;
  await save(next);
  return true;
}

// 시스템 프롬프트에 붙일 문자열로 만든다.
// 기억이 없으면 빈 문자열 — 괜히 "기억 없음" 같은 문구로 토큰을 쓰지 않는다.
export function formatMemories(list: Memory[]): string {
  if (list.length === 0) return "";
  const lines = list.map((m) => `- (${m.id} · ${m.분류} · ${m.날짜}) ${m.내용}`);
  return `[사용자에 대해 기억하고 있는 것]\n${lines.join("\n")}`;
}
