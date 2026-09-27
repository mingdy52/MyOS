# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 명령어

```bash
npm run dev        # 대화형 비서 REPL (index.ts). REPL 명령: help / db / memory / refresh / token / clear / /decide / /diet / exit
npm test           # node:test 전체 (src/**/*.test.ts)
node --import tsx --test src/model-router.test.ts   # 테스트 파일 하나만
npx tsc --noEmit   # 타입 체크 (CI가 테스트와 함께 돌린다)
npm run report     # 주간 리포트 배치 수동 실행 (노션에 페이지를 씀 — 실제 쓰기 발생)
npm run portfolio  # 노션 → src/content/portfolio.json 초안 (Claude 호출)
npm run open       # site.ts 빌드 후 docs/index.html 열기
```

`.env` 필요(`.env.example` 참고): `ANTHROPIC_API_KEY`, `NOTION_API_KEY`, `NOTION_DATA_PAGE_ID`, (선택) `YOUTUBE_API_KEY`.
키 없이 돌릴 수 있는 건 `npm test`와 `tsc --noEmit`뿐이다 — 나머지는 전부 실제 API를 부른다.

## 구조의 핵심

전체 파일 목록과 각 설계 결정의 배경은 README.md에 있다. 코드를 고치기 전 알아야 할 것만 여기 적는다.

**엔진은 하나, 도메인은 여럿.** Anthropic 호출 루프는 `src/agent/core.ts`의 `runToolLoop` 하나뿐이다.
모든 에이전트가 이걸 공유하고, 도메인 지식은 각 `agent/*.ts`의 시스템 프롬프트에, 실제 일은 `tools/*.ts`에 둔다.
core.ts에 도메인 분기를 넣지 마라 — 그게 이 구조가 막으려는 것이다.

- **도구 추가** = `tools/*.ts`의 레지스트리에 `ToolDef` 한 개. 다른 파일은 안 고친다.
- **에이전트 추가** = `Agent` 규격(`agent/types.ts`) 객체 하나 + `agent/personal.ts`의 `subAgents` 배열에 한 줄.
  라우터는 없다 — `delegationTools()`가 서브에이전트를 도구로 감싸고, Claude의 도구 선택이 곧 라우팅이다.
- **맥락은 위에서 아래로만.** 서브에이전트는 대화 기록도 장기 기억도 갖지 않는다(요청 1건 = 독립 실행).
  필요한 맥락은 Personal이 조회해서 `request` 문장에 담아 넘긴다.

**prompt caching 불변식** (`core.ts`의 `buildSystem`). 시스템 프롬프트의 정적 블록에만 `cache_control`을 건다.
매 호출 달라지는 것(오늘 날짜, 장기 기억)은 반드시 **캐시 블록 뒤**(`context` 인자)로 보낸다 —
앞에 끼우면 기억 하나 늘 때마다 큰 캐시가 통째로 깨진다. 브레이크포인트는 요청당 4개 한도이고 현재 2개(system + 대화 기록 마지막 블록)를 쓴다.

**쓰기 가드레일.** `ToolDef.isWrite: true`면 실행 직전 `preview()`를 보여주고 `ctx.confirmWrite`로 y/N을 받는다.
쓰기 도구는 캐싱하지 않고, 성공하면 조회 캐시(`queryCache`)를 통째로 비운다. 새 쓰기 도구를 만들 때 이 세 가지를 빠뜨리지 마라.
`confirmWrite`는 주입받는다 — 에이전트 코드가 stdin을 직접 알면 안 된다(배치인 `report.ts`는 다른 방식을 쓴다).

**노션은 스키마 주도.** `src/notion/schema.ts`가 단일 진실 공급원이고, 이 파일은 import 시 top-level await로
`syncSchemas()`를 돌려 노션 부모 페이지에서 발견한 dataSourceId·컬럼으로 스스로를 덮어쓴다(캐시: `.cache/notion-schema.json`).
파일에 적힌 값은 발견 실패 시 fallback seed일 뿐이다.

- 읽기는 전부 `notion/query.ts`의 `getRecords(db, opts)` 하나를 지난다. DB별 리더 파일을 새로 만들지 마라.
- 쓰기는 `notion/mutate.ts`. 컬럼 타입 분기(`FieldType`)는 읽기 `props.ts` / 쓰기 `mutate.ts` 두 곳에 있다 — 타입을 늘리면 둘 다 고친다.
- 도구 설명문(enum, schemaHint)도 `schemas`에서 생성된다. 스키마만 고치면 프롬프트가 따라온다.
- 노션에 DB를 새로 만들었으면 코드 수정 없이 REPL `refresh` + 재시작.

**모델 선택**은 `model-router.ts`의 키워드 규칙(순수 함수, 테스트 있음). 모델 ID도 여기 있다 — 바꿀 일이 생기면 여기만 고친다.
Reflection Agent만 예외로 상위 모델을 고정한다(잘못 읽은 결정이 노션에 남으면 되돌리기 번거로워서).

**테스트 범위.** 부작용 없는 순수 모듈만 테스트한다(`model-router`, `notion/filters`, `youtube`).
새 로직을 테스트하고 싶으면 노션·SDK import 없는 순수 모듈로 먼저 떼어내라 — CI에 키를 넣지 않는 게 전제다.

## 코드 스타일

- ESM + `verbatimModuleSyntax`: 상대 경로 import는 **반드시 `.js` 확장자**, 타입은 `import type`.
- `noUncheckedIndexedAccess` / `exactOptionalPropertyTypes`가 켜져 있다. 인덱스 접근 결과는 `undefined`일 수 있고,
  선택 속성은 조건부 스프레드(`...(x && { k: v })`)로 붙이는 게 이 코드베이스의 관용구다.
- 노션 SDK 응답은 경계에서 `any`로 받고 `props.ts`에서 우리 타입으로 좁힌다. 내부 로직은 좁혀진 타입 위에서만 돈다.
- 주석과 사용자 대상 출력은 **한국어**, 도구·에이전트 이름은 영문 snake_case. 기존 주석은 "왜 이렇게 했는가"를 설명한다 — 그 밀도를 유지한다.
