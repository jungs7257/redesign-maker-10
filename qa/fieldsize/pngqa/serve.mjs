// [검증 5 보조] 의존성 없는 정적 파일 서버 — ES 모듈이 file://에서 CORS로 막히기
// 때문에 사용. 실행: node qa/fieldsize/pngqa/serve.mjs <port> <dir>
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const port = Number(process.argv[2] ?? 38215);
const dir = process.argv[3] ?? ".";
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://x");
    const p = normalize(join(dir, url.pathname)).replace(/^(\.\.[/\\])+/, "");
    const body = await readFile(p);
    res.writeHead(200, { "Content-Type": mime[extname(p)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
}).listen(port, "127.0.0.1", () => console.log("serving on", port));
