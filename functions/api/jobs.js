export async function onRequestGet(context) {
  const serviceKey = context.env.PUBLIC_DATA_SERVICE_KEY;

  const baseUrl = "https://apis.data.go.kr/1051000/recruitment/list";

  // ✅ 한 번에 넉넉히 가져오기 (프론트에서 20개씩 페이지네이션)
  const params = new URLSearchParams({
    serviceKey,            // 보통 디코딩 키 그대로 OK
    resultType: "json",
    pageNo: "1",
    numOfRows: "500",      // ✅ 10 -> 500 (필요하면 200/1000으로 조절)
    ongoingYn: "Y",
  });

  const url = `${baseUrl}?${params.toString()}`;

  try {
    const res = await fetch(url, {
      headers: { "Accept": "application/json" },
    });

    const text = await res.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      // ✅ 502 대신 ok:false로 내려서 프론트에서 원인 확인 가능하게
      return new Response(
        JSON.stringify({ ok: false, error: "Upstream is not JSON", raw: text }),
        { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } }
      );
    }

    // ✅ 업스트림 HTTP 에러여도 본문은 내려주기
    if (!res.ok) {
      return new Response(
        JSON.stringify({ ok: false, error: `Upstream HTTP ${res.status}`, data }),
        { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } }
      );
    }

    return new Response(JSON.stringify({ ok: true, data }), {
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: String(err?.message || err) }),
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } }
    );
  }
}