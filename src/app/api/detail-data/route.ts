import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 상세페이지 빌더 저장 데이터 — 프로젝트 루트 data/detail-builder.json
// 클라이언트에서는 withBasePath("/api/detail-data")로 호출한다.
const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "detail-builder.json");
const TMP_FILE = DATA_FILE + ".tmp";
// 과도한 저장 방지 상한 (섹션 JSON은 수백 KB를 넘지 않는다)
const MAX_BYTES = 2 * 1024 * 1024;

function isValidDoc(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === "object" &&
      Array.isArray((value as { sections?: unknown }).sections)
  );
}

export async function GET() {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const doc = JSON.parse(raw);
    if (!isValidDoc(doc)) {
      return NextResponse.json(
        { ok: false, error: "저장 파일 형식이 올바르지 않습니다." },
        { status: 500 }
      );
    }
    return NextResponse.json({ ok: true, doc }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    // 파일이 없으면 "서버에 데이터 없음" — 클라이언트 마이그레이션 트리거 신호
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return NextResponse.json({ ok: true, doc: null }, { headers: { "Cache-Control": "no-store" } });
    }
    console.warn("[detail-data] read failed:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ ok: false, error: "데이터 파일을 읽지 못했습니다." }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body: unknown = await request.json();
    // 기본은 { doc: {...} } 래퍼. doc 객체만 바로 보내도 허용한다.
    const doc =
      body && typeof body === "object" && "doc" in body
        ? (body as { doc?: unknown }).doc
        : body;
    if (!isValidDoc(doc)) {
      return NextResponse.json(
        { ok: false, error: "body.doc.sections 배열이 필요합니다." },
        { status: 400 }
      );
    }
    const raw = JSON.stringify(doc, null, 2);
    const bytes = Buffer.byteLength(raw, "utf8");
    if (bytes > MAX_BYTES) {
      return NextResponse.json({ ok: false, error: "데이터가 너무 큽니다." }, { status: 413 });
    }
    await fs.mkdir(DATA_DIR, { recursive: true });
    // 임시 파일에 쓴 뒤 rename — 도중에 끊겨도 본 파일이 반쯤 덮이지 않게
    await fs.writeFile(TMP_FILE, raw, "utf8");
    await fs.rename(TMP_FILE, DATA_FILE);
    return NextResponse.json({ ok: true, bytes });
  } catch (error) {
    console.warn("[detail-data] write failed:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ ok: false, error: "데이터 파일을 저장하지 못했습니다." }, { status: 500 });
  }
}
