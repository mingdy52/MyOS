# MyOS

> 노션(Notion)에 흩어진 내 일상 기록을 **자연어로 묻고, 답을 받고, 매주 자동으로 회고 리포트를 받아보는** 개인 비서 에이전트.

"이번 달 식비 얼마야?", "지난주 운동 목표 달성률 분석해줘"처럼 한국어로 물으면 끝입니다.
Claude가 **어떤 노션 DB를 어떤 기간으로 조회할지 스스로 판단해(tool use)** 데이터를 모으고 분석해 답합니다.
조회뿐 아니라 새 기록 추가·수정, 그리고 **주간 회고 리포트 자동 생성**까지 합니다.

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

여기에 **prompt caching**을 더했습니다.
시스템 프롬프트·도구 정의·대화 기록은 매 호출마다 똑같이 들어가므로, 캐시 브레이크포인트를 걸어 **두 번째 호출부터는 정가의 ~10%로 재사용**합니다.
매 응답마다 토큰 사용량(입력 / 출력 / 캐시 읽기 / 캐시 쓰기)을 출력해, 캐싱이 실제로 먹히는지 눈으로 확인하며 만들었습니다.

### 2. 유지보수 — DB 정의를 한 곳에 모은 스키마 주도 설계

DB를 하나 추가할 때마다 조회 코드·쓰기 코드·도구 설명을 일일이 고치는 건 비효율적입니다.
그래서 **`schema.ts` 한 파일**에 "이 DB는 어느 데이터소스이고, 어떤 컬럼이 무슨 타입인지"만 정의해 두고, 읽기·쓰기·도구 설명문이 모두 이 한 곳을 바라보게 했습니다.

> 새 DB는 `schema.ts`에 한 덩어리만 추가하면 읽기·쓰기가 자동으로 지원됩니다.

### 3. 운영 — 안전한 쓰기와 무인 자동화

- **쓰기 가드레일** — 조회는 마음껏 하되, 데이터를 바꾸는 추가·수정은 실행 직전에 "무엇을 → 어떤 값으로" 바꿀지 보여주고 `y/N` 확인을 받습니다. 수정 시에는 기존 값을 읽어와 `기존 → 새값`으로 대조해 줍니다.
- **주간 리포트 자동화** — GitHub Actions가 매주 일요일 21시(KST)에 지난 7일 데이터를 모아 Claude에게 분석을 받고, 노션 "리포트" DB에 회고 페이지로 저장합니다. 사람 개입이 없는 1회성 배치라 REPL과 코드 경로를 분리했습니다.

<br>

## 기술 스택

Node.js (ESM) · TypeScript (strict) · [`@anthropic-ai/sdk`](https://www.npmjs.com/package/@anthropic-ai/sdk) (Claude tool use) · [`@notionhq/client`](https://www.npmjs.com/package/@notionhq/client) · GitHub Actions

## 구조

```text
src/
├── index.ts          # 대화형(REPL) 에이전트 — 도구 루프 + 모델 라우팅 + 캐싱
├── report.ts         # 주간 리포트 배치 (스케줄러용)
└── notion/
    ├── schema.ts     # ★ 모든 DB의 컬럼·타입·데이터소스 (단일 진실 공급원)
    ├── query.ts      # 공통 조회
    ├── props.ts      # 속성 파싱
    ├── mutate.ts     # 추가·수정
    └── *.ts          # DB별 리더 (target, diet, workout, study, expense,
                       #            diary, weight, techstack, project, application)
```

## 실행

```bash
npm install
cp .env.example .env   # ANTHROPIC_API_KEY, NOTION_API_KEY, NOTION_*_DATA_SOURCE_ID

npm run dev            # 대화형 비서 (REPL 명령어: help / db / token / clear / exit)
npm run report         # 주간 리포트 수동 생성
```


