// ── 모델 라우팅(비용 절감) ──────────────────────────────────────
// 단순 조회는 싸고 빠른 하이쿠로, 분석·추론이 필요한 질문만 상위 모델(소넷)로 올린다.
// 토큰 단가가 몇 배 차이 나므로, 쉬운 질문을 하이쿠로 처리하는 것만으로 비용이 크게 준다.
//
// 이 모듈은 순수 함수라 부작용이 없다(노션·SDK를 import하지 않는다).
// 덕분에 REPL을 띄우지 않고도 단위 테스트로 라우팅 규칙을 검증할 수 있다.
export const MODEL_SIMPLE = "claude-haiku-4-5-20251001"; // 간단 조회용 (쌈)
export const MODEL_COMPLEX = "claude-sonnet-4-6"; // 복잡 분석용 (상위 모델)

// 이 단어가 질문에 들어 있으면 "단순 조회를 넘어 분석/추론이 필요하다"고 보고 상위 모델로 올린다.
// 새 단어가 필요하면 여기만 늘리면 된다.
export const COMPLEX_HINTS = [
  "분석", "비교", "달성률", "추세", "추이", "패턴", "상관관계", "상관",
  "왜", "이유", "원인", "평가", "추천", "예측", "전망", "인사이트", "개선",
  "가치관", "성향", "후회", "교훈",
];

// 데이터를 바꾸는(수정/삭제) 의도가 보이면 상위 모델로 올린다.
// 어떤 행을 고치고 지울지 정확히 가려내는 판단이 필요하고, 되돌리기 번거로운 작업이라
// 약한 모델이 빈 칸을 "기록 없음"으로 오판하는 식의 실수를 막는다. (조회/추가는 그대로 Haiku)
export const WRITE_HINTS = [
  "삭제", "지워", "지울", "제거", "없애", "수정", "고쳐", "바꿔", "변경",
];

// 질문을 보고 어떤 모델로 처리할지 고른다. (추가 API 호출 없이 키워드만으로 판단 → 비용 0)
export function pickModel(question: string): string {
  const needsComplex =
    COMPLEX_HINTS.some((w) => question.includes(w)) ||
    WRITE_HINTS.some((w) => question.includes(w));
  return needsComplex ? MODEL_COMPLEX : MODEL_SIMPLE;
}
