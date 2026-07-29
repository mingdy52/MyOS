// ── 유튜브 데이터 API (v3) ────────────────────────────────────
// Media Agent가 "바깥 세상에서 콘텐츠를 새로 찾아오는" 통로.

const API = "https://www.googleapis.com/youtube/v3";

// 검색 결과 한 건. 키를 한글로 둔 이유: 그대로 노션 '콘텐츠' DB에 옮겨 담기 편하고,
// Claude가 읽을 때도 어느 칸에 넣을지 헷갈리지 않는다.
export type YouTubeVideo = {
  videoId: string;
  제목: string;
  URL: string;
  채널: string;
  설명: string;
  길이초?: number;
  조회수?: number;
  게시일?: string;
};

// API 키가 있는지. 없으면 도구 쪽에서 사람이 읽을 안내로 바꿔 준다.
export function hasApiKey(): boolean {
  return Boolean(process.env.YOUTUBE_API_KEY);
}

// "PT4M13S" 같은 ISO-8601 기간 문자열을 초로 바꾼다.
// 유튜브가 영상 길이를 이 형식으로만 주기 때문에 직접 푼다.
// (시/분/초 중 없는 칸은 그냥 빠져 있다: "PT45S", "PT1H2M" 등)
export function parseDuration(iso: string): number | undefined {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return undefined;
  const [h, min, s] = [m[1], m[2], m[3]].map((v) => Number(v ?? 0));
  return h! * 3600 + min! * 60 + s!;
}

// 구글 API를 부르고 JSON을 돌려준다. 실패하면 이유를 담아 던진다.
// (구글은 오류를 { error: { message } } 형태로 준다 — 할당량 초과가 대표적)
async function callApi(path: string, params: Record<string, string>): Promise<any> {
  const url = new URL(`${API}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("key", process.env.YOUTUBE_API_KEY!);

  const res = await fetch(url);
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason = body?.error?.message ?? `HTTP ${res.status}`;
    throw new Error(`유튜브 API 오류: ${reason}`);
  }
  return body;
}

// 영상을 검색한다.
//
// 호출을 두 번 하는 이유: search.list는 제목·채널·설명만 주고 '길이'와 '조회수'를 안 준다.
// 그런데 "15초짜리 짧은 영상"처럼 길이로 고르고 싶은 경우가 많아서,
// 검색으로 id를 모은 뒤 videos.list로 상세를 한 번에 채워 넣는다.
// (할당량: search.list 100 + videos.list 1 = 검색 1회당 101 units.
//  기본 일일 할당량 10,000이면 하루 약 99번 검색할 수 있다.)
export async function searchVideos(opts: {
  query: string;
  maxResults?: number;
  // 유튜브가 정한 구간: short=4분 미만, medium=4~20분, long=20분 초과
  duration?: "any" | "short" | "medium" | "long";
}): Promise<YouTubeVideo[]> {
  const search = await callApi("search", {
    part: "snippet",
    q: opts.query,
    type: "video",
    maxResults: String(Math.min(opts.maxResults ?? 5, 10)),
    ...(opts.duration && opts.duration !== "any" && { videoDuration: opts.duration }),
    // 위로용 콘텐츠를 찾는 도구라 자극적인 결과는 아예 막는다.
    safeSearch: "strict",
    // 한국어 결과를 우선한다(완전히 한국어만 나오는 건 아니다).
    regionCode: "KR",
    relevanceLanguage: "ko",
  });

  const items: any[] = search.items ?? [];
  if (items.length === 0) return [];

  const videos: YouTubeVideo[] = items.map((it) => ({
    videoId: it.id.videoId,
    제목: it.snippet.title,
    URL: `https://www.youtube.com/watch?v=${it.id.videoId}`,
    채널: it.snippet.channelTitle,
    // 설명 전문은 길고 대부분 광고·해시태그라, 앞부분만 잘라 토큰을 아낀다.
    설명: String(it.snippet.description ?? "").slice(0, 200),
    게시일: String(it.snippet.publishedAt ?? "").slice(0, 10),
  }));

  // 2차 호출: 길이·조회수를 채운다. 실패해도 검색 결과 자체는 살린다.
  try {
    const detail = await callApi("videos", {
      part: "contentDetails,statistics",
      id: videos.map((v) => v.videoId).join(","),
    });
    const byId = new Map<string, any>(
      (detail.items ?? []).map((it: any) => [it.id, it])
    );
    for (const v of videos) {
      const d = byId.get(v.videoId);
      if (!d) continue;
      // 못 읽은 값은 아예 안 넣는다(undefined를 대입하지 않는다).
      // tsconfig의 exactOptionalPropertyTypes 때문이기도 하고,
      // "길이초: undefined"가 Claude에게 가면 괜히 헷갈리기도 한다.
      const seconds = parseDuration(d.contentDetails?.duration ?? "");
      if (seconds !== undefined) v.길이초 = seconds;
      const views = Number(d.statistics?.viewCount);
      if (Number.isFinite(views)) v.조회수 = views;
    }
  } catch {
    // 상세를 못 받아도 제목·링크만으로 추천/저장은 가능하다.
  }

  return videos;
}
