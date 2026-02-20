const API_URL = "/api/jobs";

let __allJobs = [];

/* ---------- 카드 렌더 함수 ---------- */
function renderJobs(jobs) {
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
      <h3 style="margin:0 0 6px 0;">${title}</h3>
      <p style="margin:0 0 6px 0;"><b>${company}</b></p>
      <p style="margin:0 0 6px 0; color:#666;">${region}</p>
      <p style="margin:0 0 10px 0; color:#666;">${recruitType}${hireType ? " · " + hireType : ""}</p>
      <p style="margin:0 0 10px 0; color:#666;">${period}</p>
      ${url ? `<a href="${url}" target="_blank" rel="noopener noreferrer">공고 링크</a>` : ""}
    `;

    container.appendChild(card);
  });
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
  const input = document.getElementById("searchInput");
  if (!input) return;

  let t = null;

  const apply = () => {
    const q = input.value.trim().toLowerCase();
    const filtered = q
      ? __allJobs.filter(job => matchesQuery(job, q))
      : __allJobs;

    renderJobs(filtered);
    updateCount(filtered.length, total);
  };

  // 타이핑 중엔 잠깐 기다렸다가 실행 (디바운스)
  input.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(apply, 200);
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