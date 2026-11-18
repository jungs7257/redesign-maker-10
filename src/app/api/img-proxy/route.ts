import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PNG 내보내기 canvas taint 방지용 같은 출처 이미지 프록시.
// 브라우저에서 외부 출처(100.113.154.123:8081 등) 이미지를 직접 그리면
// canvas가 오염되어 toPng 결과가 백지가 되는 문제가 있어(2026-11 PNG 백지 이슈),
// 서버가 대신 fetch해 같은 출처 응답으로 내려준다.
// SSRF 방어: 화이트리스트 호스트(호스트:포트 정확 일치)만 허용하고,
// 업스트림 리다이렉트는 직접 따라가며 매 홉마다 화이트리스트를 다시 검사한다.
const ALLOWED_HOSTS = new Set([
  "100.113.154.123:8081",
  "localhost:8081",
  "127.0.0.1:8081",
]);
const MAX_REDIRECTS = 3;
// 상세페이지 원본 이미지 1장 상한 (여유 있게)
const MAX_BYTES = 20 * 1024 * 1024;

function jsonError(message: string, status: number) {
  return NextResponse.json(
    { ok: false, error: message },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

type Validated = { url: URL } | { error: string; status: number };

function validateUrl(raw: string): Validated {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { error: "url 파라미터가 올바른 URL이 아닙니다.", status: 400 };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { error: "http/https 프로토콜만 허용됩니다.", status: 400 };
  }
  if (u.username || u.password) {
    return { error: "URL에 자격증명을 포함할 수 없습니다.", status: 400 };
  }
  if (!ALLOWED_HOSTS.has(u.host.toLowerCase())) {
    return { error: "허용되지 않은 호스트입니다.", status: 403 };
  }
  return { url: u };
}

export async function GET(request: NextRequest) {
  const raw = (request.nextUrl.searchParams.get("url") ?? "").trim();
  if (!raw) return jsonError("url 쿼리 파라미터가 필요합니다.", 400);

  let checked = validateUrl(raw);
  if ("error" in checked) return jsonError(checked.error, checked.status);
  let target = checked.url;

  try {
    let upstream: Response | null = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      upstream = await fetch(target, { redirect: "manual", cache: "no-store" });
      if (upstream.status >= 300 && upstream.status < 400) {
        const loc = upstream.headers.get("location");
        if (!loc) break;
        let nextUrl: URL;
        try {
          nextUrl = new URL(loc, target);
        } catch {
          return jsonError("리다이렉트 Location이 올바르지 않습니다.", 502);
        }
        checked = validateUrl(nextUrl.toString());
        if ("error" in checked) {
          return jsonError("리다이렉트 대상이 화이트리스트에 없습니다.", 403);
        }
        target = checked.url;
        continue;
      }
      break;
    }
    if (!upstream || !upstream.ok) {
      const status = upstream ? upstream.status : 0;
      return jsonError("업스트림 이미지 요청 실패 (HTTP " + status + ")", 502);
    }
    const buf = await upstream.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) {
      return jsonError("이미지가 너무 큽니다.", 413);
    }
    // Content-Type은 원본을 그대로 유지, 알 수 없으면 octet-stream
    const type = (upstream.headers.get("content-type") || "").trim() || "application/octet-stream";
    return new NextResponse(buf, {
      status: 200,
      headers: { "Content-Type": type, "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.warn("[img-proxy] fetch failed:", error instanceof Error ? error.message : "unknown");
    return jsonError("이미지를 가져오지 못했습니다.", 502);
  }
}
