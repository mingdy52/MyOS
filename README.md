# MyOS

> 노션(Notion)에 흩어진 내 일상 기록을 **자연어로 묻고, 답을 받고, 매주 자동으로 회고 리포트를 받아보는** 개인 비서 에이전트.

"이번 달 식비 얼마야?", "지난주 운동 목표 달성률 분석해줘"처럼 한국어로 물으면 끝입니다.
Claude가 **어떤 노션 DB를 어떤 기간으로 조회할지 스스로 판단해(tool use)** 데이터를 모으고 분석해 답합니다.
조회뿐 아니라 새 기록 추가·수정·삭제, 그리고 **주간 회고 리포트 자동 생성**까지 합니다.

```text
질문> 지난주 운동 목표 달성률 분석해줘

🤖 모델: Sonnet · 복잡 분석
🔧 get_targets(...)
🔧 get_workouts({"from":"2026-06-02","to":"2026-06-08"})

주 3회 목표 중 2회 달성(약 67%).
화·목 운동은 꾸준했지만 주말이 비었어요...
```

<br>


### 1. 비용 — 질문 난이도에 따라 모델을 고른다

모든 질문을 상위 모델로 처리하면, "오늘 체중 알려줘" 같은 단순 조회에도 비싼 값을 치릅니다.
그래서 질문의 키워드(`분석` `비교` `달성률` `왜` `추천` …)를 보고 **추가 API 호출 없이** 모델을 결정합니다.

| 질문 유형 | 사용 모델 |
| --- | --- |
| 단순 조회 | **Haiku** — 싸고 빠름 |
| 분석·추론 | **Sonnet** — 상위 모델 |

> **한계** — 키워드 매칭이라 힌트 단어가 없는 복합 질문은 Haiku로 갑니다. LLM으로 판정하면 정확하지만 그 비용이 절감액을 갉아먹어, 비용 0인 규칙 방식을 택했습니다. 규칙은 [`model-router.ts`](src/model-router.ts)에 있고 [테스트](src/model-router.test.ts)로 지킵니다.

여기에 **prompt caching**을 더했습니다.
시스템 프롬프트·도구 정의·대화 기록은 매 호출마다 똑같이 들어가므로, 캐시 브레이크포인트를 걸어 **두 번째 호출부터는 정가의 ~10%로 재사용**합니다.
매 응답마다 토큰 사용량(입력 / 출력 / 캐시 읽기 / 캐시 쓰기)을 출력해, 캐싱이 실제로 먹히는지 눈으로 확인하며 만들었습니다.

### 2. 유지보수 — DB를 노션에서 자동 발견하는 스키마 주도 설계

DB를 하나 추가할 때마다 데이터소스 id를 `.env`에 적고, 조회·쓰기 코드와 도구 설명을 일일이 고치는 건 비효율적입니다.
그래서 **모든 DB가 들어있는 부모 페이지 하나**만 알려주면, 앱이 시작할 때 그 페이지를 훑어 안의 DB들(데이터소스 id·컬럼·타입)을 **자동으로 발견**하고 캐시에 저장합니다. 읽기·쓰기·도구 설명문은 모두 이 발견된 스키마를 바라봅니다.

> 새 DB는 **노션에서 만들고 `refresh` 한 번**이면 끝 — 코드·설정을 한 줄도 안 고칩니다.

- **캐시 우선** — 평소엔 캐시만 읽어 네트워크 호출 0. 노션에서 DB·컬럼을 바꿨을 때만 `refresh`로 다시 훑습니다.
- **본문형 표시** — 제목이 `+`로 끝나는 DB(일기·알고리즘 로그 등)는 "페이지 본문에 자유 서술을 적는 DB"로 인식해, 조회 시 본문까지 함께 읽어옵니다.
- **단일 조회 진입점** — 모든 읽기는 `getRecords(db, { 기간·필터·본문 })` 하나로 처리해, DB마다 리더 파일을 두지 않습니다.

### 3. 운영 — 안전한 쓰기와 무인 자동화

- **쓰기 가드레일** — 조회는 마음껏 하되, 데이터를 바꾸는 추가·수정·삭제는 실행 직전에 "무엇을 → 어떤 값으로" 바꿀지 보여주고 `y/N` 확인을 받습니다. 수정 시에는 기존 값을 읽어와 `기존 → 새값`으로 대조해 줍니다.
- **주간 리포트 자동화** — GitHub Actions가 매주 월요일 오전 9시(KST)에 전주(지난주 월~일) 데이터를 모아 Claude에게 분석을 받고, 노션 "리포트" DB에 회고 페이지로 저장합니다. 사람 개입이 없는 1회성 배치라 REPL과 코드 경로를 분리했습니다.

<br>

## 기술 스택

Node.js (ESM) · TypeScript (strict) · [`@anthropic-ai/sdk`](https://www.npmjs.com/package/@anthropic-ai/sdk) (Claude tool use) · [`@notionhq/client`](https://www.npmjs.com/package/@notionhq/client) · GitHub Actions · [`node:test`](https://nodejs.org/api/test.html)

> strict로 켜 두었지만, 노션 SDK 응답은 경계에서 `any`로 받아 `props.ts`에서 우리 타입으로 파싱합니다. 내부 로직은 그 뒤의 좁혀진 타입 위에서 돕니다.

## 테스트

부작용 없는 순수 로직을 별도 모듈로 분리해 [`node:test`](https://nodejs.org/api/test.html)로 검증합니다 — 추가 의존성·키 없이 돕니다.

- [`model-router.ts`](src/model-router.ts) — 모델 라우팅 규칙
- [`notion/filters.ts`](src/notion/filters.ts) — 노션 필터 조각 생성

```bash
npm test   # *.test.ts (15개)
```

> 노션 실연동은 키가 필요해 수동으로 검증합니다. push·PR마다 CI가 `tsc --noEmit`와 `npm test`를 돌립니다.

## 구조

```text
src/
├── index.ts             # 대화형(REPL) 에이전트 — 도구 루프 + 모델 라우팅 + 캐싱
├── model-router.ts      # 질문 → 모델(Haiku/Sonnet) 라우팅 규칙 (순수·테스트 대상)
├── model-router.test.ts # ↑ 라우팅 규칙 단위 테스트
├── report.ts            # 주간 리포트 배치 (스케줄러용)
├── portfolio-draft.ts   # 포트폴리오 초안 생성 (노션 → 검수용 JSON, 수동 실행)
├── site.ts              # 검수된 JSON → 정적 HTML 빌드 (GitHub Pages 배포)
├── content/             # 검수·확정된 포트폴리오 콘텐츠 (JSON)
└── notion/
    ├── discover.ts      # 부모 페이지 → 안의 DB들(데이터소스·컬럼) 자동 발견
    ├── schema-sync.ts   # 발견 결과를 스키마에 반영 (캐시 우선, refresh로 갱신)
    ├── schema-cache.ts  # 발견 결과 캐시 (.cache/notion-schema.json)
    ├── schema.ts        # DB 스키마(역할·제목·컬럼) — 발견 실패 시 fallback seed
    ├── query.ts         # 공통 조회 — getRecords 단일 진입점 (기간·필터·본문)
    ├── filters.ts       # 노션 필터 조각 생성 (순수·테스트 대상)
    ├── filters.test.ts  # ↑ 필터 생성 단위 테스트
    ├── props.ts         # 속성 파싱
    ├── mutate.ts        # 추가·수정·삭제
    ├── blocks.ts        # 페이지 본문(블록) 텍스트 읽기
    └── render.ts        # 노션 페이지 본문 → HTML 변환
```

## 실행

```bash
npm install
cp .env.example .env   # ANTHROPIC_API_KEY, NOTION_API_KEY, NOTION_DATA_PAGE_ID

npm run dev            # 대화형 비서 (REPL 명령어: help / db / refresh / token / clear / exit)
npm run report         # 주간 리포트 수동 생성
npm run portfolio      # 포트폴리오 콘텐츠 초안 생성 (노션 → 검수용 JSON)
npm run site           # 검수된 JSON → 정적 HTML 빌드 (GitHub Pages 배포물)
```


