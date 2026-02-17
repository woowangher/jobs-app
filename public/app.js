console.log("APP.JS LOADED ✅");
const els = {
  list: document.getElementById("jobList"),
  meta: document.getElementById("resultMeta")
};

function renderMissingElementError() {
  if (document.body) {
    document.body.textContent = "요소 없음";
  }
}

function hasRequiredElements() {
  return Boolean(els.list && els.meta);
}

function renderTitles(jobs) {
  const top3 = jobs.slice(0, 3);

  if (!top3.length) {
    els.meta.textContent = "0 jobs";
    els.list.innerHTML = '<div class="empty">공고가 없습니다.</div>';
    return;
  }

  els.meta.textContent = `${top3.length} jobs`;
  els.list.innerHTML = top3
    .map((job) => `<article class="card"><h3>${job.recrutPbancTtl ?? ""}</h3></article>`)
    .join("");
}

function renderError() {
  els.meta.textContent = "";
  els.list.textContent = "에러";
}

async function loadJobs() {
  if (!hasRequiredElements()) {
    renderMissingElementError();
    return;
  }

  try {
    const res = await fetch("/api/jobs");
    const data = await res.json();

    if (!res.ok || data?.ok !== true || !Array.isArray(data?.data?.result)) {
      throw new Error("Invalid response");
    }

    renderTitles(data.data.result);
  } catch (err) {
    console.error(err);
    renderError();
  }
}

document.addEventListener("DOMContentLoaded", () => {
  loadJobs();
});
