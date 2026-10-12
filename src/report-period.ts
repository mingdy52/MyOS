// 리포트가 다룰 기간을 정한다. 노션·SDK import가 없는 순수 함수라 테스트 대상이다(report-period.test.ts).
// 주간이든 월간이든 항상 "직전에 완결된 기간"을 돌려준다 —
// 덕분에 스케줄이 밀리든 수동으로 돌리든 같은 날이면 같은 결과가 나온다.

// 로컬 시각 기준으로 연/월/일을 0채움해서 돌려준다. (GitHub 러너는 UTC라 월요일 09시 KST = 월요일 00시 UTC)
function parts(d: Date) {
  return {
    y: d.getFullYear(),
    m: String(d.getMonth() + 1).padStart(2, "0"),
    d: String(d.getDate()).padStart(2, "0"),
  };
}
const iso = (d: Date) => { const p = parts(d); return `${p.y}-${p.m}-${p.d}`; };           // 2026-06-10 (노션 필터용)
const korean = (d: Date) => { const p = parts(d); return `${p.y}년 ${p.m}월 ${p.d}일`; }; // 2026년 06월 10일 (제목용)

export type Period = {
  from: string;   // 노션 날짜 필터용 (YYYY-MM-DD)
  to: string;
  title: string;  // 리포트 페이지 제목
  unit: "주" | "달"; // 프롬프트에서 '이번 주' / '이번 달'로 쓰인다
  span: string;      // 프롬프트에서 '지난 7일치' / '지난 한 달치'로 쓰인다
};

export function reportPeriod(now: Date, monthly: boolean): Period {
  if (monthly) {
    // 지난달 1일 ~ 말일. new Date(y, m, 0)은 "이번 달 0일" = 지난달 말일이라 말일을 직접 셀 필요가 없다.
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const to = new Date(now.getFullYear(), now.getMonth(), 0);
    const p = parts(from);
    return { from: iso(from), to: iso(to), title: `${p.y}년 ${p.m}월`, unit: "달", span: "한 달" };
  }

  // 지난주 월요일 ~ 일요일.
  // getDay(): 0=일 1=월 … 6=토. (월요일까지의 거리) = (getDay()+6)%7 → 월=0, 일=6
  const to = new Date(now);
  to.setDate(now.getDate() - ((now.getDay() + 6) % 7) - 1); // 지난주 일요일 = 이번 주 월요일 - 1
  const from = new Date(to);
  from.setDate(to.getDate() - 6);
  return { from: iso(from), to: iso(to), title: `${korean(from)} ~ ${korean(to)}`, unit: "주", span: "7일" };
}
