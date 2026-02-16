export async function onRequestGet(context) {
  const serviceKey = context.env.PUBLIC_DATA_SERVICE_KEY;

  // 공공데이터 기본 주소 + 목록조회(/list)
  const baseUrl = "https://apis.data.go.kr/1051000/recruitment/list";

  // 최소 테스트 파라미터 (진행중 + JSON + 10개)
  const params = new URLSearchParams({
    serviceKey,
    resultType: "json",
    pageNo: "1",
    numOfRows: "10",
    ongoingYn: "Y",
  });

  const url = `${baseUrl}?${params.toString()}`;

  try {
    const res = await fetch(url);

    // 공공데이터 API가 가끔 JSON이 아닌 경우도 있어서 텍스트로 받고 파싱
    const text = await res.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      // JSON 파싱 실패하면 원문을 그대로 반환 (디버깅용)
      return new Response(
        JSON.stringify({ ok: false, error: "Upstream is not JSON", raw: text }),
        { status: 502, headers: { "Content-Type": "application/json; charset=utf-8" } }
      );
    }

    return new Response(JSON.stringify({ ok: true, data }), {
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      { status: 502, headers: { "Content-Type": "application/json; charset=utf-8" } }
    );
  }
}
