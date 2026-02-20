const API_URL = "/api/jobs";

let __allJobs = [];

/* ---------- 카드 렌더 함수 ---------- */
function renderJobs(jobs, q = "") {
  const container = document.getElementById("jobs-grid");
  if (!container) return;

  container.innerHTML = "";

  jobs.forEach(job => {
    const card = document.createElement("div");
    card.style.border = "1px solid #ccc";
    card.style.padding = "10px";
    card.style.margin = "10px 0";

    const title = job.recrutPbancTtl || "제목 없음";
    const company = job.instNm || "";
    const url = job.srcUrl || "";
    const region = Array.isArray(job.workRgnNmLst) ? job.workRgnNmLst.join(", ") : (job.workRgnNmLst || "");
    const hireType = Array.isArray(job.hireTypeNmLst) ? job.hireTypeNmLst.join(", ") : (job.hireTypeNmLst || "");
    const recruitType = job.recrutSeNm || "";
    const period = `${job.pbancBgngYmd || ""} ~ ${job.pbancEndYmd || ""}`.trim();

    card.innerHTML = `
      <h3 style="margin:0 0 6px 0;">${highlight(title, q)}</h3>
      <p style="margin:0 0 6px 0;"><b>${highlight(company, q)}</b></p>
      <p style="margin:0 0 6px 0; color:#666;">${highlight(region, q)}</p>
      <p style="margin:0 0 10px 0; color:#666;">${highlight(recruitType, q)}${hireType ? " · " + highlight(hireType, q) : ""}</p>
      <p style="margin:0 0 10px 0; color:#666;">${highlight(period, q)}</p>
      ${url ? `<a href="${url}" target="_blank" rel="noopener noreferrer">공고 링크</a>` : ""}
    `;

    container.appendChild(card);
  });
}

/* ---------- 검색어 하이라이트 ---------- */
function highlight(text, q) {
  const s = String(text ?? "");
  const raw = String(q ?? "").trim();
  if (!raw) return s;

  // 공백 기준으로 단어 분리 (2글자 이상만 추천: 너무 짧은 건 하이라이트 과해짐)
  const tokens = raw.split(/\s+/).filter(t => t.length > 0);

  let out = s;
  for (const token of tokens) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`(${escaped})`, "ig"), "<mark>$1</mark>");
  }
  return out;
}

/* ---------- 상단 숫자 업데이트 ---------- */
function updateCount(showing, total) {
  const el = document.getElementById("showing-line");
  if (!el) return;
  el.innerHTML = `<b>Showing:</b> ${showing} / <b>Total:</b> ${total}`;
}

/* ---------- 검색 ---------- */
function matchesQuery(job, q) {
  if (!q) return true;
  const blob = JSON.stringify(job ?? {}).toLowerCase();
  return blob.includes(q);
}

function wireSearch(total) {
  const input = document.getElementById("search") || document.getElementById("searchInput");
  const regionEl = document.getElementById("regionFilter");
  const typeEl = document.getElementById("typeFilter");

  if (!input) return;

  let t = null;

  const regionMap = {
    all: "",
    seoul: "서울",
    gyeonggi: "경기",
  };

  const typeMap = {
    all: "",
    regular: "정규", // 필요하면 "정규직"로 바꿔도 됨
    intern: "인턴",
  };

  const apply = () => {
    const q = input.value.trim().toLowerCase();

    const regionKey = regionEl ? regionEl.value : "all";
    const typeKey = typeEl ? typeEl.value : "all";

    const regionNeedle = (regionMap[regionKey] ?? "").toLowerCase();
    const typeNeedle = (typeMap[typeKey] ?? "").toLowerCase();

    const filtered = __allJobs.filter(job => {
      // 1) 검색어(전체 JSON) 필터
      if (q && !matchesQuery(job, q)) return false;

      // 2) 지역 필터: workRgnNmLst 안에 포함되는지
      if (regionNeedle) {
        const regionText = Array.isArray(job.workRgnNmLst)
          ? job.workRgnNmLst.join(" ").toLowerCase()
          : String(job.workRgnNmLst ?? "").toLowerCase();

        if (!regionText.includes(regionNeedle)) return false;
      }

      // 3) 고용형태 필터: hireTypeNmLst 안에 포함되는지
      if (typeNeedle) {
        const typeText = Array.isArray(job.hireTypeNmLst)
          ? job.hireTypeNmLst.join(" ").toLowerCase()
          : String(job.hireTypeNmLst ?? "").toLowerCase();

        if (!typeText.includes(typeNeedle)) return false;
      }

      return true;
    });

    // 하이라이트는 "검색어" 기준만 유지(원하면 region/type도 합쳐서 하이라이트 가능)
    renderJobs(filtered, q);
    updateCount(filtered.length, total);
  };

  // 검색 디바운스
  input.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(apply, 300);
  });
  input.addEventListener("search", apply);

  // 셀렉트 변경 시 즉시 반영
  if (regionEl) regionEl.addEventListener("change", apply);
  if (typeEl) typeEl.addEventListener("change", apply);

  apply

  // 타이핑 중엔 잠깐 기다렸다가 실행 (디바운스)
  input.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(apply, 300);
  });

  // 검색창 X 버튼(클리어) 눌렀을 때도 반영 (브라우저에 따라 input만으로 부족할 때 있음)
  input.addEventListener("search", apply);

  // 페이지 로드시 1회 적용(혹시 input에 값이 남아있을 때)
  apply();
}

/* ---------- 메인 로딩 ---------- */
async function loadJobs() {
  try {
    const res = await fetch(API_URL, { cache: "no-store" });
    const data = await res.json();

    if (!data.ok) {
      document.body.innerHTML = "<h2>API ok:false</h2>";
      return;
    }

    const jobs = data.data?.result || [];
    const total = data.data?.totalCount ?? jobs.length;

    const root = document.getElementById("jobs");
    if (!root) return;

    root.innerHTML = `
      <p id="showing-line"><b>Showing:</b> ${jobs.length} / <b>Total:</b> ${total}</p>
      <div id="jobs-grid"></div>
    `;

    __allJobs = jobs;

    renderJobs(jobs);
    wireSearch(total);

  } catch (err) {
    console.error(err);
    document.body.innerHTML = "<h2>JS ERROR 발생</h2>";
  }
}

loadJobs();