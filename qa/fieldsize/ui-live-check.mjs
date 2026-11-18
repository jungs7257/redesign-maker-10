// [검증 4-보조] 실제 서빙 페이지(http://localhost:3002/redesign/15)에서
// CDP(Node 내장 WebSocket, 의존성 추가 없음)로 '상세페이지 빌더' 탭을 눌러
// DetailBuilder 편집 폼이 실제로 렌더링되는지 확인한다.
//   - 배지 1/2/3 개별 라벨 존재(작업2)
//   - 필드별 Aa 크기 조절기 존재(작업1)
//   - 미리보기에 배지가 한 줄(· 구분)로 출력
//   - 데이터 로드(서버 단일 출처) 후 렌더 — "불러오는 중" 아님
// 실행: node qa/fieldsize/ui-live-check.mjs
import { spawn } from "node:child_process";

const URL = process.env.BUILDER_URL ?? "http://localhost:3002/redesign/15";
const PORT = 39777;

const chrome = spawn("google-chrome", [
  "--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=" + PORT,
  "--user-data-dir=/tmp/opencode/chrome-ui-check", "--no-first-run",
  "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // 디버그 엔드포인트 대기
  let targets = null;
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      targets = await res.json();
      if (targets.length) break;
    } catch {}
    await sleep(250);
  }
  const page = targets.find((t) => t.type === "page");
  if (!page) throw new Error("페이지 타겟 없음");

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

  let seq = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++seq;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });

  await send("Page.enable");
  await send("Runtime.enable");
  const nav = await send("Page.navigate", { url: URL });
  if (nav.errorText) throw new Error("이동 실패: " + nav.errorText);

  // 수화 + 데이터 로드 대기: '상세페이지 빌더' 탭 버튼이 생길 때까지 폴링
  const evalJs = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    return r.result?.result?.value;
  };
  let clicked = false;
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    const found = await evalJs(
      "Array.from(document.querySelectorAll('button')).some(b => b.textContent.includes('상세페이지 빌더'))"
    );
    if (found) {
      await evalJs(
        "Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('상세페이지 빌더'))?.click()"
      );
      clicked = true;
      break;
    }
  }
  if (!clicked) throw new Error("빌더 탭 버튼을 찾지 못함(수화 실패?)");

  // 편집 폼 렌더 대기 — '저장된 상세페이지 데이터를 불러오는 중'이 사라지고 배지 라벨 등장
  let dom = "";
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    dom = await evalJs("document.body.innerText");
    if (dom.includes("배지 1") && dom.includes("배지 2") && dom.includes("배지 3")) break;
  }

  const result = {
    url: URL,
    tabClicked: clicked,
    loadingGone: !dom.includes("불러오는 중"),
    badgeLabels: ["배지 1", "배지 2", "배지 3"].every((t) => dom.includes(t)),
    sectionHeader: dom.includes("섹션 1 · 히어로"),
    fieldControls: await evalJs(
      "Array.from(document.querySelectorAll('[title^=\"이 칸만의 글자 크기\"]')).length"
    ),
    badgeLineInPreview: await evalJs(
      "(document.getElementById('builder-preview-sheet')?.innerText || '').includes('·')"
    ),
    serverDataLoaded: await evalJs(
      "fetch('/redesign/15/api/detail-data').then(r=>r.json()).then(j=>j.ok && j.doc.sections.length)"
    ),
  };
  console.log(JSON.stringify(result, null, 1));

  ws.close();
  chrome.kill();
  const ok =
    result.tabClicked && result.loadingGone && result.badgeLabels && result.sectionHeader &&
    result.fieldControls > 0 && result.badgeLineInPreview && result.serverDataLoaded === 10;
  console.log(ok ? "\nPASS" : "\nFAIL");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error("ERROR:", e.message);
  chrome.kill();
  process.exit(1);
});
