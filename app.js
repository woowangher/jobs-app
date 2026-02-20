const API_URL = "/api/jobs";

async function loadJobs() {
  try {
    console.log("[STEP] loadJobs start");                 //테스트용

    const res = await fetch(API_URL, { cache: "no-store" });
    const data = await res.json();
    
    console.log("API DATA:", data);

    console.log("[STEP] fetched json, ok=", data.ok);     //테스트용

    if (!data.ok) {
      document.body.innerHTML = "<h2>API ok:false</h2>";
      return;
    }

    const jobs = data.data?.result || [];
    const loaded = data.data?.totalCount ?? jobs.length;


    const root = document.getElementById("jobs");       //테스트용

    console.log("[STEP] root exists =", !!root);

    if (!root) {
      console.error("index.html에 #jobs 없음");
      return;
    }

    root.innerHTML = `
      <p><b>Showing:</b> ${jobs.length} / <b>Total:</b> ${total}</p>
      <div id="jobs-grid"></div>
    `;

const container = document.getElementById("jobs-grid");

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

  } catch (err) {
    console.error(err);
    document.body.innerHTML = "<h2>JS ERROR 발생</h2>";
  }
}

loadJobs();