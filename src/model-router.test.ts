import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pickModel,
  MODEL_SIMPLE,
  MODEL_COMPLEX,
} from "./model-router.js";

// 라우팅의 핵심 계약:
//  - 평범한 조회는 싼 모델(Haiku)로 간다.
//  - 분석/추론 단어나 쓰기(수정/삭제) 의도가 보이면 상위 모델(Sonnet)로 올린다.
//  - 이 함수가 잘못되면 곧바로 비용이나 정확도로 새므로 회귀 테스트로 못박아 둔다.

test("단순 조회는 싼 모델(Haiku)로 라우팅된다", () => {
  assert.equal(pickModel("오늘 체중 알려줘"), MODEL_SIMPLE);
  assert.equal(pickModel("이번 달 식비 얼마야"), MODEL_SIMPLE);
  assert.equal(pickModel("지난주 운동 기록 보여줘"), MODEL_SIMPLE);
});

test("분석/추론 키워드가 있으면 상위 모델(Sonnet)로 올린다", () => {
  assert.equal(pickModel("지난주 운동 목표 달성률 분석해줘"), MODEL_COMPLEX);
  assert.equal(pickModel("이번 달과 지난 달 식비를 비교해줘"), MODEL_COMPLEX);
  assert.equal(pickModel("요즘 스트레스가 높은 이유가 뭘까"), MODEL_COMPLEX);
  assert.equal(pickModel("내 소비 성향을 평가해줘"), MODEL_COMPLEX);
});

test("쓰기(수정/삭제) 의도가 보이면 상위 모델(Sonnet)로 올린다", () => {
  assert.equal(pickModel("오늘 아침 식단 삭제해줘"), MODEL_COMPLEX);
  assert.equal(pickModel("어제 운동 시간을 30분으로 수정해줘"), MODEL_COMPLEX);
  assert.equal(pickModel("그 지출 유형을 식비로 바꿔줘"), MODEL_COMPLEX);
});

test("추가(create) 의도만 있는 문장은 싼 모델에 머문다", () => {
  // '추가'는 되돌리기 쉬운 작업이라 상위 모델로 올리지 않는 게 의도된 설계다.
  assert.equal(pickModel("오늘 점심에 김밥 추가해줘"), MODEL_SIMPLE);
});

test("빈 문자열은 안전하게 싼 모델로 떨어진다", () => {
  assert.equal(pickModel(""), MODEL_SIMPLE);
});

test("힌트 단어가 문장 중간에 박혀 있어도 잡아낸다", () => {
  // includes 기반이라 부분 일치도 걸린다는 걸 명시적으로 못박아 둔다.
  assert.equal(pickModel("음 이거 왜이래"), MODEL_COMPLEX); // "왜" 포함
});
