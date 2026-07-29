import { addMemory, removeMemory, CATEGORIES, MAX_MEMORIES } from "../memory.js";
import type { ToolRegistry } from "../agent/types.js";

// ── 기억 도구 ─────────────────────────────────────────────────
// 읽는 도구가 없는 게 특징이다. 기억은 매 질문의 시스템 프롬프트에 이미 실려 오므로
// (personal.ts 참고) 따로 "기억 조회" 도구를 부를 필요가 없다.
// 그래서 여기 있는 건 쓰는 쪽 둘뿐 — 새로 적기, 지우기.
//
// 노션 쓰기와 달리 y/N 확인을 받지 않는다. 이건 사용자의 진짜 기록이 아니라
// 비서가 자기 수첩에 적는 메모라, 매번 확인을 물으면 대화가 끊긴다.
// 대신 무엇을 적었는지 화면에 그대로 보여줘서 몰래 쌓이지 않게 한다.

export const memoryTools: ToolRegistry = {
  remember: {
    description:
      "사용자에 대해 오래 갈 사실을 기억해 둔다. 다음에 다시 켜도 남는다. " +
      // 무엇을 적을지보다 '언제 부를지'를 앞에 둔다 — 이게 없으면 도구가 있어도 안 부른다.
      "부르는 시점: 기록을 조회·분석해서 반복되는 패턴이나 지속되는 상황을 알아낸 직후, " +
      "그리고 사용자가 자기 이야기를 직접 해줬을 때. 답변만 하고 지나가지 마라. " +
      "기억할 만한 것: 반복되는 패턴, 취향, 한동안 이어지는 상황, 목표. " +
      '예: "월요일마다 에너지가 방전되는 일이 반복된다", "잔잔한 자연 영상을 좋아한다". ' +
      // 무엇을 기억하지 '말아야' 하는지가 더 중요하다 — 안 그러면 노션의 복사본이 된다.
      "기억하지 말 것: 노션을 조회하면 언제든 알 수 있는 값(오늘 체중, 이번 달 식비, 어제 운동 시간), " +
      "곧 변할 일시적인 사실, 그리고 한 번 있었을 뿐인 사건. " +
      "판단 기준은 '한 달 뒤에도 이 문장이 참일까'다. 아니면 기억하지 마라. " +
      "이미 있는 기억이 틀렸거나 낡았으면 새로 적기 전에 forget으로 그것부터 지워라. " +
      `분류는 이 중 하나: ${CATEGORIES.join(", ")}. 최대 ${MAX_MEMORIES}개까지 저장된다.`,
    properties: {
      category: {
        type: "string",
        enum: [...CATEGORIES],
        description:
          "패턴=반복되는 경향, 선호=좋아하고 싫어하는 것, 상황=한동안 이어지는 형편, 목표=이루려는 것",
      },
      fact: {
        type: "string",
        description:
          "기억할 내용을 완결된 한 문장으로. 나중에 이 문장만 읽어도 뜻이 통해야 한다 " +
          '(예: "그렇다"가 아니라 "야근이 잦아 평일 운동을 거의 못 한다")',
      },
    },
    run: async (i, ctx) => {
      const result = await addMemory(i.category, String(i.fact ?? "").trim(), ctx.today);
      if (result.ok && result.memory) {
        ctx.log(`   🧠 기억했어요 — [${result.memory.분류}] ${result.memory.내용}`);
      }
      return result.message;
    },
  },

  forget: {
    description:
      "기억을 하나 지운다. 기억이 사실과 달라졌거나, 더는 해당되지 않을 때 쓴다. " +
      "id는 시스템 프롬프트의 기억 목록에 (m1 · 패턴 · 날짜) 형태로 적혀 있다. " +
      "사용자가 '그건 이제 아니야'라고 하면 바로 지워라.",
    properties: {
      id: { type: "string", description: '지울 기억의 id. 예: "m3"' },
    },
    run: async (i, ctx) => {
      const ok = await removeMemory(i.id);
      if (ok) ctx.log(`   🧠 기억을 지웠어요 — ${i.id}`);
      return ok ? "지웠다." : `그런 id의 기억이 없다: ${i.id}`;
    },
  },
};
