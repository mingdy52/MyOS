// 에이전트 계층의 공용 규격(타입)만 모은 파일.

// 쓰기 도구를 실행하기 직전, 사용자에게 y/N 확인을 받는 방법.
// 어떻게 물어볼지는 호출자가 정한다(REPL은 stdin, 배치는 자동 승인 등).
export type ConfirmWrite = (promptText: string) => Promise<boolean>;

// 도구/에이전트가 실행 중에 필요로 하는 바깥 사정.
// 매 질문마다 새로 만들어 도구까지 그대로 흘려보낸다(전역 상태를 안 만들기 위해).
export type AgentContext = {
  // 쓰기 확인 콜백.
  confirmWrite: ConfirmWrite;
  // 이 질문을 처리하는 기준 날짜(KST, YYYY-MM-DD).
  today: string;
  // 진행 상황 출력. 서브에이전트는 들여쓰기를 붙여 누가 한 일인지 구분한다.
  log: (message: string) => void;
  // 이번 질문에 쓴 토큰을 모으는 그릇(선택). 서브에이전트도 같은 ctx를 물려받으므로
  // 위임해서 쓴 토큰까지 여기 한 곳에 쌓인다 — "이번 질문 비용"이 정직해진다.
  usage?: Tokens;
};

// Claude에게 노출할 도구 하나의 정의.
export type ToolDef = {
  // Claude가 "이 도구를 언제 쓸지" 판단하는 근거. 사실상 이게 도구의 사용설명서다.
  description: string;
  // 입력 스키마의 properties. 없으면 입력이 없는 도구(전체 조회 등).
  properties?: Record<string, unknown>;
  // 데이터를 바꾸는 도구인가. true면 실행 전에 preview를 보여주고 y/N 확인을 받는다.
  isWrite?: boolean;
  // 쓰기 직전에 "무엇을 어떻게 바꿀지" 사람에게 보여준다. (isWrite일 때만 호출됨)
  preview?: (input: any) => Promise<void>;
  // 실제 실행기. Claude가 준 입력(input)을 받아 진짜 일을 한다.
  run: (input: any, ctx: AgentContext) => Promise<unknown>;
};

// 도구 이름 → 정의. 에이전트마다 자기 레지스트리를 하나씩 갖는다.
export type ToolRegistry = Record<string, ToolDef>;

// 토큰 사용량 집계 단위. (자세한 설명은 core.ts)
export type Tokens = {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
};

// ── 서브에이전트 규격 ──────────────────────────────────────────
// 도구(ToolDef)와 에이전트(Agent)의 차이:
//   도구  = 시키는 대로 한 가지 일만 한다. 판단하지 않는다. (예: 노션에서 식단을 읽어온다)
//   에이전트 = 자기 도메인의 도구들을 들고, 무엇을 어떤 순서로 할지 스스로 판단한다.
//
// 오케스트레이터(Personal Agent)는 이 규격만 알면 되고, 서브에이전트 내부는 모른다.
// 새 도메인(여행·건강·재무)이 생기면 이 규격을 만족하는 객체를 하나 더 만들어
// 오케스트레이터의 배열에 추가하기만 하면 된다.
export type Agent = {
  // 위임 도구의 이름이 되므로 영문 snake_case. (예: "media_agent")
  name: string;
  // 오케스트레이터가 "이 요청을 얘한테 넘길까?"를 판단하는 근거.
  description: string;
  // 위임할 때 request에 무엇을 담아야 하는지에 대한 안내.
  requestHint: string;
  // 요청 문장 하나를 받아 스스로 처리하고, 결과를 텍스트로 돌려준다.
  // 대화 기록을 갖지 않는다(요청 1건 = 독립 실행). 맥락은 request에 담겨 온다.
  run: (request: string, ctx: AgentContext) => Promise<string>;
};
