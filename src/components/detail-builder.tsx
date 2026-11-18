"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn, withBasePath } from "@/lib/utils";
import {
  PNG_PLACEHOLDER,
  PNG_WIDTH,
  PNG_PIXEL_RATIO,
  MAX_SLICE_HEIGHT,
  prepareCaptureImages,
  waitForStableHeight,
  planSlices,
  capturePngSlices,
} from "@/lib/png-slices";
import {
  DEFAULT_FONT_SIZE,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  KIND_LABELS,
  SECTION_TEMPLATES,
  TEMPLATE_LABELS,
  buildHtml,
  clampFontSize,
  defaultDoc,
  fieldSize,
  isFreeServiceSection,
  isShippingSection,
  makeSection,
  migrateDoc,
  sectionFontSize,
  validateHtml,
  type Doc,
  type Kind,
  type Section,
} from "@/lib/detail-html";

const STORAGE_KEY = "jjungs:detail-builder:v1";
const BACKUP_KEY = "jjungs:detail-builder:v1.bak";
// 서버 저장 API — basePath(/redesign/15)를 붙여 호출한다.
const DATA_API = withBasePath("/api/detail-data");
// 서버 PUT 디바운스 — 입력마다 요청이 나가는 것을 막는다. localStorage은 즉시 저장된다.
const SERVER_SAVE_DEBOUNCE_MS = 400;

// F8 — CHECK POINT(차별점) 입력은 '기능 나열'이 아니라 '구매 이유(이득)'을 유도하는 예시
const CHECK_EXAMPLES = [
  "01 적은 세제로도 거품이 잘 남",
  "02 구석까지 닿는 타원형 폭",
  "03 쓰고 버려도 아깝지 않은 가격",
];

const REVIEW_EXAMPLES = [
  "01 둥째날부터 설거지가 편해졌어요",
  "02 사이즈가 생각보다 알차요",
  "03 재구매 각입니다",
];

// [2] 이미지 크기 표시 — 주소를 넣으면 Image()로 원본 픽셀 크기와 표시 배율을 보여준다.
function ImageMeta({ url }: { url: string }) {
  const trimmed = (url || "").trim();
  const [state, setState] = React.useState<{ w: number; h: number } | "loading" | "error" | null>(null);

  React.useEffect(() => {
    if (!trimmed) {
      setState(null);
      return;
    }
    let cancelled = false;
    setState("loading");
    const img = new Image();
    img.onload = () => {
      if (!cancelled) setState({ w: img.naturalWidth, h: img.naturalHeight });
    };
    img.onerror = () => {
      if (!cancelled) setState("error");
    };
    img.src = trimmed;
    return () => {
      cancelled = true;
    };
  }, [trimmed]);

  if (!trimmed) return null;
  if (state === "loading") {
    return <div className="mt-1 text-[11px] text-muted-foreground">원본 크기 확인 중... 권장: 폭 780px 이상</div>;
  }
  if (state === "error") {
    return <div className="mt-1 text-[11px] text-muted-foreground">원본 크기를 확인할 수 없습니다. 권장: 폭 780px 이상</div>;
  }
  if (!state) return null;
  const { w, h } = state;
  if (!w || !h) return null;
  const pct = Math.round((780 / w) * 100);
  const small = w < 780;
  return (
    <div className={"mt-1 text-[11px] leading-relaxed " + (small ? "text-amber-700" : "text-muted-foreground")}>
      원본 {w}×{h}px · 표시 폭 780px · 배율 {pct}%{small ? " (확대됨)" : ""} — 권장: 폭 780px 이상
      {small && " · 원본 폭이 780px보다 작아서 화질이 저하될 수 있어요."}
    </div>
  );
}

// [1] 섹션별 글자 크기 조절 — 숫자 입력 + 상승/하강 버튼. 기본값이면 fontSize 필드를 아예 두지 않는다.
function FontSizeControl({ sec, onSet }: { sec: Section; onSet: (n: number | undefined) => void }) {
  const def = DEFAULT_FONT_SIZE[sec.type] ?? 18;
  const current = sectionFontSize(sec);
  // 입력 중 초깃값(예: "3")이 즉시 8로 튀지 않게 초안 문자열을 잠시 들고 있는다.
  const [draft, setDraft] = React.useState<string | null>(null);
  const shown = draft ?? String(current);
  const commit = (raw: string) => {
    const n = parseInt(raw, 10);
    onSet(Number.isNaN(n) ? def : clampFontSize(n));
    setDraft(null);
  };
  return (
    <div className="mt-2">
      <label className="mb-1 block text-xs text-muted-foreground">글자 크기 (px) — 기본 {def}</label>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="rounded border px-2 py-1 text-xs"
          onClick={() => { setDraft(null); onSet(clampFontSize(current - 2)); }}
        >▼</button>
        <input
          type="number"
          min={FONT_SIZE_MIN}
          max={FONT_SIZE_MAX}
          step={1}
          className="w-20 rounded-md border bg-background px-2 py-1 text-sm"
          value={shown}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        />
        <button
          type="button"
          className="rounded border px-2 py-1 text-xs"
          onClick={() => { setDraft(null); onSet(clampFontSize(current + 2)); }}
        >▲</button>
        {typeof sec.fontSize === "number" && (
          <button
            type="button"
            className="rounded border px-2 py-1 text-xs text-muted-foreground"
            onClick={() => { setDraft(null); onSet(undefined); }}
          >기본값</button>
        )}
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground">값을 키우면 섹션 안의 모든 글자가 비례해 커집니다(미리보기·PNG 동일 반영). 칸마다 따로 지정할 크기는 각 입력칸 옆의 Aa 조절기를 쓰세요.</div>
    </div>
  );
}

// [작업1] 개별 텍스트 칸 단위 글자 크기 조절 — FontSizeControl을 필드 단위로 일반화한
// 소형 컨트롤. 값이 비어 있으면 섹션 기본(fontSize → fontScale)을 상속한다
// (= fieldSizes에서 이 키를 지운다). 범위 8~72px.
function FieldSizeControl({ sec, fieldKey, onSet }: {
  sec: Section;
  fieldKey: string;
  onSet: (px: number | undefined) => void;
}) {
  const inherit = sectionFontSize(sec);
  const set = fieldSize(sec, fieldKey);
  // 입력 중 초안 문자열을 잠시 들고 있는다(FontSizeControl과 같은 패턴).
  const [draft, setDraft] = React.useState<string | null>(null);
  const shown = draft ?? (set === undefined ? "" : String(set));
  const commit = (raw: string) => {
    const t = raw.trim();
    if (t === "") {
      onSet(undefined); // 비우면 상속
    } else {
      const n = parseInt(t, 10);
      if (!Number.isNaN(n)) onSet(clampFontSize(n));
    }
    setDraft(null);
  };
  return (
    <div
      className="flex shrink-0 items-center gap-0.5"
      title={"이 칸만의 글자 크기(px). 비우면 섹션 기본값(" + inherit + "px)을 상속합니다."}
    >
      <span className="text-[10px] font-bold text-muted-foreground">Aa</span>
      <button
        type="button"
        className="rounded border px-1 py-0.5 text-[10px] leading-none"
        onClick={() => { setDraft(null); onSet(clampFontSize((set ?? inherit) - 2)); }}
      >▼</button>
      <input
        type="number"
        min={FONT_SIZE_MIN}
        max={FONT_SIZE_MAX}
        step={1}
        className="w-14 rounded-md border bg-background px-1 py-0.5 text-center text-xs"
        placeholder={String(inherit)}
        value={shown}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      />
      <button
        type="button"
        className="rounded border px-1 py-0.5 text-[10px] leading-none"
        onClick={() => { setDraft(null); onSet(clampFontSize((set ?? inherit) + 2)); }}
      >▲</button>
      {set !== undefined && (
        <button
          type="button"
          className="rounded border px-1 py-0.5 text-[10px] leading-none text-muted-foreground"
          title={"섹션 기본값(" + inherit + "px) 상속"}
          onClick={() => { setDraft(null); onSet(undefined); }}
        >↺</button>
      )}
    </div>
  );
}

type PngState = { status: "idle" | "working" | "done" | "error"; message: string };

// F9 — 빈 PNG 방어: 생성된 dataUrl을 축소 렌더해 픽셀을 샘플링하고,
// 단색(사실상 흰 캔버스)이면 파일을 저장하지 않고 실패로 보고한다.
async function assertPngHasContent(dataUrl: string): Promise<void> {
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("생성된 PNG 이미지를 읽을 수 없습니다."));
    img.src = dataUrl;
  });
  const w = 120;
  const h = Math.max(1, Math.round((img.naturalHeight / Math.max(1, img.naturalWidth)) * w));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const colors = new Set<string>();
  for (let i = 0; i < data.length; i += 4) {
    colors.add(data[i] + "," + data[i + 1] + "," + data[i + 2]);
  }
  if (colors.size < 3) {
    throw new Error("내용이 비어 있는 PNG(단색)가 생성되어 저장을 중단했습니다. 미리보기 내용을 확인한 뒤 다시 시도해 주세요.");
  }
}

export function DetailBuilder() {
  const [doc, setDoc] = React.useState<Doc>(() => defaultDoc());
  const [ready, setReady] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);
  // 서버 통신 불가로 localStorage 폴백/기본 문서를 보여주고 있음을 알리는 안내 문구.
  // PUT 성공으로 서버 동기가 확인되면 해제한다.
  const [offlineNotice, setOfflineNotice] = React.useState<string | null>(null);
  const [copyLabel, setCopyLabel] = React.useState("쿠팡 HTML 복사");
  const [pngState, setPngState] = React.useState<PngState>({ status: "idle", message: "" });
  const fileRef = React.useRef<HTMLInputElement | null>(null);
  // pagehide 플러시용 최신 doc 참조
  const docRef = React.useRef<Doc>(doc);

  // 로드: 서버가 우선. 서버가 비어 있고 localStorage에 데이터가 있으면
  // 그 데이터를 서버로 1회 PUT 마이그레이션한 뒤 사용한다.
  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const local = readLocalDoc();
      const server = await fetchServerDoc();
      if (cancelled) return;
      if (server.state === "ok") {
        setDoc(server.doc);
      } else if (server.state === "empty" && local) {
        await putServerDoc(local);
        setDoc(local);
      } else if (local) {
        // 서버 통신 불가 — localStorage 데이터로 오프라인 대체 (서버 덮어쓰기 없음)
        setDoc(local);
        setOfflineNotice("서버 연결 없음 — 로컬 백업 표시 중");
      } else if (server.state === "unreachable") {
        // 서버 통신 불가 + 로컬 백업도 없음 — 기본 문서로 두고 연결 문제만 안내
        setOfflineNotice("서버 연결 없음 — 서버 데이터를 불러올 수 없습니다");
      }
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    docRef.current = doc;
  }, [doc]);

  // 저장: localStorage은 즉시(백업), 서버 PUT은 짧게 디바운스.
  React.useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
    } catch {}
    const t = setTimeout(() => {
      void putServerDoc(doc).then((ok) => {
        if (ok) {
          setServerError(null);
          // PUT이 성공했으면 서버가 살아있고 현재 문서가 저장된 상태 — 폴백 안내 해제
          setOfflineNotice(null);
        } else {
          setServerError("서버 저장에 실패했습니다. 이 브라우저 백업은 그대로 유지됩니다.");
        }
      });
    }, SERVER_SAVE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [doc, ready]);

  // 탭 닫기/이동 시 디바운스를 기다리지 않고 마지막 편집 내용을 서버로 플러시한다.
  React.useEffect(() => {
    if (!ready) return;
    const onHide = () => {
      void putServerDoc(docRef.current, true);
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [ready]);

  // 섹션 경계선 표시 — 미리보기에서 각 섹션의 영역을 보여준다(기본 켬).
  // 출력물(복사/HTML/PNG)에는 경계선이 포함되지 않는다.
  const [showBoundary, setShowBoundary] = React.useState(true);
  const html = React.useMemo(() => buildHtml(doc, false, showBoundary), [doc, showBoundary]);
  const copyIssues = React.useMemo(() => validateHtml(html), [html]);

  const update = (fn: (d: Doc) => Doc) => setDoc((prev) => fn(structuredClone(prev)));

  // [3] 섹션 순서 변경(위아래 이동) — 기존 기능 유지
  const moveSection = (i: number, dir: -1 | 1) =>
    update((d) => {
      const j = i + dir;
      if (j < 0 || j >= d.sections.length) return d;
      [d.sections[i], d.sections[j]] = [d.sections[j], d.sections[i]];
      return d;
    });

  const removeSection = (i: number) =>
    update((d) => {
      d.sections.splice(i, 1);
      return d;
    });

  // [3] 섹션 추가 — 8종 템플릿으로 만든다. like를 넘기면 그 섹션과 같은 형태로 만든다.
  const addSection = (type: Section["type"], like?: Section) =>
    update((d) => {
      d.sections.push(makeSection(type, like));
      return d;
    });

  const patchSection = (i: number, patch: Partial<Section>) =>
    update((d) => {
      d.sections[i] = { ...d.sections[i], ...patch } as Section;
      return d;
    });

  // [작업1] 필드(개별 텍스트 칸) 글자 크기 변경 — px를 지정하면 fieldSizes[key]에
  // 넣고, undefined(비우기/↺)면 키를 지운다(섹션 기본 상속).
  // 남는 키가 하나도 없으면 fieldSizes 필드 자체를 두지 않는다(데이터 최소 형태 유지).
  const patchFieldSize = (i: number, key: string, px: number | undefined) =>
    update((d) => {
      const s = d.sections[i] as Section;
      const sizes: Record<string, number> = { ...(s.fieldSizes ?? {}) };
      if (px === undefined) delete sizes[key];
      else sizes[key] = clampFontSize(px);
      if (Object.keys(sizes).length > 0) s.fieldSizes = sizes;
      else delete s.fieldSizes;
      return d;
    });

  const onExportJson = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" }));
    a.download = "detail-builder.json";
    a.click();
  };

  const onImportJson = (f: File) => {
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const parsed = JSON.parse(String(rd.result));
        if (parsed && Array.isArray(parsed.sections)) setDoc(migrateDoc(parsed));
      } catch {}
    };
    rd.readAsText(f);
  };

    const onDownloadHtml = () => {
    const full = "<!DOCTYPE html><html><head><meta charset=\"utf-8\"></head><body>" + publishHtml + "</body></html>";
    const blob = new Blob([full], { type: "text/html;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "detail-page.html";
    a.click();
  };

  // F9 — PNG 다운로드: 780px 폭·pixelRatio 2, 높이 3,000px 초과 시 분할.
  // 실패 시 조용히 넘기지 않고 pngState에 사유를 표시한다.
  const onDownloadPng = async () => {
    setPngState({ status: "working", message: "PNG 생성 중... 잠시만 기다려 주세요." });
    let measureHost: HTMLDivElement | null = null;
    try {
      const mod = await import("html-to-image");
      const toPng = mod.toPng;

      // 캡처 전용 DOM에는 섹션 wrapper를 붙여 경계를 식별한다. 복사/HTML 내보내기
      // 결과는 buildHtml(doc) 그대로이므로 예전 출력과 바이트 단위로 동일하다.
      const captureHtml = buildHtml(doc, true);
      if (!captureHtml) throw new Error("캡처할 내용이 없습니다. 내용을 채운 뒤 다시 시도해 주세요.");

      // 화면 밖 배치는 host가 맡고, toPng에 넘는 루트에는 left/top 오프셋을
      // 두지 않는다. 캡처 노드에 left:-99999px가 있으면 클론의 computed 스타일이
      // 이를 다시 덮어써 흰 PNG가 나오는 사고가 있었다(2026-11 이슈 재발 방지).
      measureHost = document.createElement("div");
      measureHost.style.cssText = "position:absolute;left:-99999px;top:0;width:" + PNG_WIDTH + "px;";
      const measureRoot = document.createElement("div");
      measureRoot.style.cssText = "width:" + PNG_WIDTH + "px;background:#ffffff;overflow:hidden;";
      measureRoot.innerHTML = captureHtml;
      measureHost.appendChild(measureRoot);
      document.body.appendChild(measureHost);

      // 이미지 안정화: 프록시 → data URL → decode → naturalWidth 기준 크기 고정.
      await prepareCaptureImages(
        measureRoot,
        (raw) => withBasePath("/api/img-proxy") + "?url=" + encodeURIComponent(raw)
      );
      const totalHeight = await waitForStableHeight(measureRoot);
      if (totalHeight < 10) throw new Error("캡처할 내용이 없습니다. 내용을 채운 뒤 다시 시도해 주세요.");

      // 섹션 경계 우선 분할. translateY 방식은 쓰지 않고 조각마다 새 host를 만든다.
      const { plans } = planSlices(measureRoot, MAX_SLICE_HEIGHT);
      if (plans.length === 0) throw new Error("캡처할 섹션이 없습니다. 내용을 채운 뒤 다시 시도해 주세요.");

      const slices = await capturePngSlices(plans, {
        toPng,
        width: PNG_WIDTH,
        maxSliceHeight: MAX_SLICE_HEIGHT,
        pixelRatio: PNG_PIXEL_RATIO,
        imagePlaceholder: PNG_PLACEHOLDER,
        onProgress: (current, total) => {
          setPngState({ status: "working", message: "PNG 생성 중... " + current + "/" + total });
        },
      });

      const files: string[] = [];
      for (let i = 0; i < slices.length; i++) {
        const slice = slices[i];
        // 첫 조각은 픽셀을 샘플링해 단색(빈 캔버스) 여부를 검사한다.
        if (i === 0) await assertPngHasContent(slice.dataUrl);
        const name = slices.length > 1 ? "detail-page-" + (i + 1) + ".png" : "detail-page.png";
        const a = document.createElement("a");
        a.href = slice.dataUrl;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        files.push(name + " (" + PNG_WIDTH + "×" + slice.height + ")");
        if (i < slices.length - 1) await new Promise((r) => setTimeout(r, 350));
      }

      const extra = slices.length > 1 ? " — 브라우저가 여러 파일 다운로드를 허용할지 물어볼 수 있어요." : "";
      setPngState({ status: "done", message: "PNG 저장 완료 — " + files.join(", ") + extra });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setPngState({ status: "error", message: "PNG 생성 실패 — " + msg });
    } finally {
      if (measureHost && measureHost.parentNode) measureHost.parentNode.removeChild(measureHost);
    }
  };

  // 섹션별 PNG 내보내기 — 해당 섹션 1개만 담은 캡처 DOM을 만들어 저장한다.
  // 높이가 3,000px를 넘으면 전체 PNG과 같은 규칙으로 분할한다.
  const onDownloadSectionPng = async (i: number) => {
    setPngState({ status: "working", message: "섹션 " + (i + 1) + " PNG 생성 중..." });
    let captureHost: HTMLDivElement | null = null;
    try {
      const mod = await import("html-to-image");
      const toPng = mod.toPng;
      const sec = doc.sections[i];
      if (!sec) throw new Error("섹션을 찾을 수 없습니다.");
      const secHtml = buildHtml({ ...doc, sections: [sec] }, true);
      if (!secHtml) throw new Error("이 섹션에는 출력할 내용이 없습니다. 내용을 채운 뒤 다시 시도해 주세요.");
      captureHost = document.createElement("div");
      captureHost.style.cssText = "position:absolute;left:-99999px;top:0;width:" + PNG_WIDTH + "px;";
      const root = document.createElement("div");
      root.style.cssText = "width:" + PNG_WIDTH + "px;background:#ffffff;overflow:hidden;";
      root.innerHTML = secHtml;
      captureHost.appendChild(root);
      document.body.appendChild(captureHost);
      await prepareCaptureImages(
        root,
        (raw) => withBasePath("/api/img-proxy") + "?url=" + encodeURIComponent(raw)
      );
      const totalHeight = await waitForStableHeight(root);
      if (totalHeight < 10) throw new Error("이 섹션에는 출력할 내용이 없습니다.");
      const { plans } = planSlices(root, MAX_SLICE_HEIGHT);
      if (plans.length === 0) throw new Error("캡처할 섹션이 없습니다.");
      const slices = await capturePngSlices(plans, {
        toPng,
        width: PNG_WIDTH,
        maxSliceHeight: MAX_SLICE_HEIGHT,
        pixelRatio: PNG_PIXEL_RATIO,
        imagePlaceholder: PNG_PLACEHOLDER,
        onProgress: (current, total) => {
          setPngState({ status: "working", message: "섹션 " + (i + 1) + " PNG 생성 중... " + current + "/" + total });
        },
      });
      await assertPngHasContent(slices[0].dataUrl);
      const files: string[] = [];
      for (let k = 0; k < slices.length; k++) {
        const slice = slices[k];
        const name = slices.length > 1
          ? "section-" + (i + 1) + "-" + (k + 1) + ".png"
          : "section-" + (i + 1) + ".png";
        const a = document.createElement("a");
        a.href = slice.dataUrl;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        files.push(name + " (" + PNG_WIDTH + "x" + slice.height + ")");
        if (k < slices.length - 1) await new Promise((r) => setTimeout(r, 350));
      }
      const extra = slices.length > 1 ? " — 섹션이 길어 " + slices.length + "장으로 나눴어요." : "";
      setPngState({ status: "done", message: "섹션 " + (i + 1) + " PNG 저장 완료 — " + files.join(", ") + extra });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setPngState({ status: "error", message: "섹션 PNG 생성 실패 — " + msg });
    } finally {
      if (captureHost && captureHost.parentNode) captureHost.parentNode.removeChild(captureHost);
    }
  };

  // 쿠팡 업로드용 순수 출력물 — 미리보기용 경계선(showBoundary)을 절대 포함하지 않는다.
  const publishHtml = React.useMemo(() => buildHtml(doc, false, false), [doc]);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(publishHtml);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = publishHtml;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    if (copyIssues.length > 0) {
      setCopyLabel("경고 " + copyIssues.length + "건과 함께 복사됨");
    } else {
      setCopyLabel("검증 통과 · 복사됨 ✓");
    }
    setTimeout(() => setCopyLabel("쿠팡 HTML 복사"), 2400);
  };

  const label = (t: string, i: number) => (
    <label key={i} className="mb-1 block text-xs text-muted-foreground">{t}</label>
  );

  const input = (value: string, onChange: (v: string) => void, ph?: string) => (
    <input
      type="text"
      className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
      value={value}
      placeholder={ph}
      onChange={(e) => onChange(e.target.value)}
    />
  );

  // [2] 이미지 주소 입력 + 원본 픽셀 크기/표시 배율 표시를 세트로 쓴다.
  const imageInput = (value: string, onChange: (v: string) => void, ph?: string, key?: React.Key) => (
    <div key={key}>
      {input(value, onChange, ph)}
      <ImageMeta url={value} />
    </div>
  );

  const area = (value: string, onChange: (v: string) => void, rows = 3) => (
    <textarea
      className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
      rows={rows}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );

  const field = (t: string, node: React.ReactNode, key: React.Key) => (
    <div key={key} className="rounded-xl border p-3">
      <div className="mb-2 text-xs font-bold text-muted-foreground">{t}</div>
      {node}
    </div>
  );

  // 비동기 로드 중 편집창을 잠깐 가려서, 로드 완료 전 입력이 덮여 사라지는 일을 막는다.
  if (!ready) {
    return (
      <div className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground">
        저장된 상세페이지 데이터를 불러오는 중...
      </div>
    );
  }

  const missingImgs: string[] = [];
  // 내부(사설) 주소 이미지 검사 — Tailscale IP·localhost·내망 포트는 외부에서 접근 불가.
  const privateImgUrls: string[] = [];
  for (const sec of doc.sections) {
    const urls: string[] = [];
    if (sec.type === "hero") urls.push(sec.image);
    else if (sec.type === "problem" || sec.type === "change" || sec.type === "howto") urls.push(sec.image);
    else if (sec.type === "evidence") urls.push(sec.image);
    else if (sec.type === "detail") urls.push(...sec.images);
    for (const u of urls) {
      const v = (u || "").trim();
      if (!v) continue;
      if (/^(http:\/\/)?(100\.(6[4-9]|[7-9]\d|1\d\d|2[0-4]\d|25[0-5])\.|10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|localhost)/i.test(v) || /:(8080|8081|3000|5678)\//.test(v)) {
        if (!privateImgUrls.includes(v)) privateImgUrls.push(v);
      }
    }
  }
  for (const sec of doc.sections) {
    if (sec.type === "hero" && !sec.image) missingImgs.push("대표이미지");
    if ((sec.type === "problem" || sec.type === "change" || sec.type === "howto") && !sec.image) {
      missingImgs.push((TEMPLATE_LABELS[sec.type] ?? sec.type) + " 이미지");
    }
    if (sec.type === "detail") {
      if (!sec.images[0]) missingImgs.push("DETAIL 1");
      if (!sec.images[1]) missingImgs.push("DETAIL 2");
    }
    if (sec.type === "evidence" && !sec.image) missingImgs.push("치수 도면(근거)");
  }

  const sectionLabel = (sec: Section) => (TEMPLATE_LABELS[sec.type] ?? sec.type) + "(" + sec.type + ")";

  return (
    <div>
      {offlineNotice && (
        <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs leading-relaxed text-amber-800">
          {offlineNotice} 입력 내용은 이 브라우저에 백업되고, 서버가 복구되면 자동 저장됩니다.
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-[460px_minmax(0,1fr)]">
      <div className="max-h-[calc(100vh-140px)] space-y-3 overflow-y-auto rounded-2xl border bg-card p-4">
        <div className="text-sm font-bold">상세페이지 빌더</div>
        <div className="text-xs leading-relaxed text-muted-foreground">
          값을 넣으면 오른쪽에 바로 만들어집니다. 이미지는 쿠팡에 먼저 올린 뒤 주소를 붙여넣는 게 가장 안전해요.
        </div>

        {field("1. 기본", (
          <>
            {label("브랜드명", 1)}
            {input(doc.brand, (v) => update((d) => { d.brand = v; return d; }), "쩡스하우스")}
            {label("상품명", 2)}
            {input(doc.name, (v) => update((d) => { d.name = v; return d; }), "접이식 원목 수납 선반 3단")}
            {label("한 줄 요약", 3)}
            {input(doc.tagline, (v) => update((d) => { d.tagline = v; return d; }), "좁은 원룸에 딱 맞는 폭 60cm 수납장")}
            {label("유형", 4)}
            <select
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              value={doc.kind}
              onChange={(e) => update((d) => { d.kind = e.target.value as Kind; return d; })}
            >
              <option value="living">living (가구·리빙)</option>
              <option value="fashion">fashion (의류)</option>
              <option value="food">food (식품)</option>
            </select>
          </>
        ), "f-basic")}
        {field("이미지 5자리 (주소 입력)", (
          <>
            {(() => {
              const hero = doc.sections.find((s) => s.type === "hero");
              const problem = doc.sections.find((s) => s.type === "problem");
              const detail = doc.sections.find((s) => s.type === "detail");
              const evidence = doc.sections.find((s) => s.type === "evidence");
              const slots = [
                { label: "대표이미지", get: () => hero && hero.type === "hero" ? hero.image : "", set: (v: string) => update((d) => { for (const s of d.sections) if (s.type === "hero") s.image = v; return d; }) },
                { label: "문제공감 이미지", get: () => problem && problem.type === "problem" ? problem.image : "", set: (v: string) => update((d) => { for (const s of d.sections) if (s.type === "problem") s.image = v; return d; }) },
                { label: "DETAIL 이미지 1", get: () => detail && detail.type === "detail" ? detail.images[0] : "", set: (v: string) => update((d) => { for (const s of d.sections) if (s.type === "detail") s.images = [v, s.images[1]]; return d; }) },
                { label: "DETAIL 이미지 2", get: () => detail && detail.type === "detail" ? detail.images[1] : "", set: (v: string) => update((d) => { for (const s of d.sections) if (s.type === "detail") s.images = [s.images[0], v]; return d; }) },
                { label: "치수 도면(근거)", get: () => evidence && evidence.type === "evidence" ? evidence.image : "", set: (v: string) => update((d) => { for (const s of d.sections) if (s.type === "evidence") s.image = v; return d; }) },
              ];
              return slots.map((slot, i) => (
                <div key={i}>
                  <label className="mb-1 block text-xs text-muted-foreground">{slot.label}</label>
                  {imageInput(slot.get(), slot.set, "http://image.coupangcdn.com/....jpg")}
                </div>
              ));
            })()}
            <div className="rounded-md border border-sky-300 bg-sky-50 p-2 text-xs leading-relaxed text-sky-800">
              이미지는 쿠팡 등록 후 CDN 주소를 입력하세요 (image.coupangcdn.com 형식). 권장: 폭 780px 이상
            </div>
          </>
        ), "f-images")}


        {doc.sections.map((sec, i) => {
          // [작업1] 필드(개별 텍스트 칸) 단위 글자 크기 조절기 — 각 입력칸 옆에 붙인다.
          const fsize = (fieldKey: string) => (
            <FieldSizeControl sec={sec} fieldKey={fieldKey} onSet={(px) => patchFieldSize(i, fieldKey, px)} />
          );
          // 입력칸 + 크기 조절기를 한 줄로 묶는다(입증칸은 남은 폭을 다 쓴다).
          const inputRow = (node: React.ReactNode, fieldKey: string) => (
            <div className="flex items-center gap-1">
              <div className="min-w-0 flex-1">{node}</div>
              {fsize(fieldKey)}
            </div>
          );
          // 여러 줄 텍스트칸(textarea)은 라벨 줄 오른쪽에 조절기를 붙인다.
          const areaRow = (labelText: string, fieldKey: string, node: React.ReactNode) => (
            <div className="mb-1">
              <div className="mb-1 flex items-center justify-between gap-2">
                <label className="block text-xs text-muted-foreground">{labelText}</label>
                {fsize(fieldKey)}
              </div>
              {node}
            </div>
          );
          return (
          <div key={i} className="rounded-xl border p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-bold text-muted-foreground">섹션 {i + 1} · {sectionLabel(sec)}</span>
              <div className="flex flex-wrap gap-1">
                <button className="rounded border px-2 py-0.5 text-xs" onClick={() => moveSection(i, -1)}>▲</button>
                <button className="rounded border px-2 py-0.5 text-xs" onClick={() => moveSection(i, 1)}>▼</button>
                <button className="rounded border px-2 py-0.5 text-xs" onClick={() => addSection(sec.type, sec)}>+ 같은 유형</button>
                <button className="rounded border px-2 py-0.5 text-xs" title="이 섹션만 PNG로 저장" onClick={() => onDownloadSectionPng(i)}>PNG</button>
                <button className="rounded border border-red-300 px-2 py-0.5 text-xs text-red-600" onClick={() => removeSection(i)}>✕</button>
              </div>
            </div>
            <div className="mb-2 flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground">배경색</span>
              <input
                type="color"
                className="h-6 w-8 cursor-pointer rounded border p-0"
                value={typeof sec.bg === "string" && /^#[0-9a-fA-F]{6}$/.test(sec.bg) ? sec.bg : "#ffffff"}
                onChange={(e) => patchSection(i, { bg: e.target.value } as Partial<Section>)}
              />
              <input
                type="text"
                className="h-6 w-28 rounded border px-2 text-xs"
                placeholder="#fff8e1, 없음=흰색"
                value={typeof sec.bg === "string" ? sec.bg : ""}
                onChange={(e) => patchSection(i, { bg: e.target.value } as Partial<Section>)}
              />
              <button
                className="rounded border px-2 py-0.5 text-[11px] text-muted-foreground"
                title="배경색 지우기"
                onClick={() => patchSection(i, { bg: undefined } as Partial<Section>)}
              >지우기</button>
              <span className="text-[11px] text-muted-foreground">출력물(HTML/PNG)에도 반영됩니다</span>
            </div>
            {sec.type === "hero" && (
              <>
                {label("대표 이미지 주소", i * 10 + 1)}
                {imageInput(sec.image, (v) => patchSection(i, { image: v } as Partial<Section>), "http://image.coupangcdn.com/....jpg")}
                {label("제목 (비우면 상품명 사용)", i * 10 + 2)}
                {inputRow(input(sec.title ?? "", (v) => patchSection(i, { title: v } as Partial<Section>)), "title")}
                {label("부제", i * 10 + 3)}
                {inputRow(input(sec.sub ?? "", (v) => patchSection(i, { sub: v } as Partial<Section>)), "sub")}
                {/* [작업2] 배지 3칸 분리 — "배지 1/2/3" 개별 라벨의 독립 입력칸.
                    화면 출력은 한 줄(· 구분) 그대로, 칸마다 글자 크기(badge0~2) 지정 가능. */}
                <div className="mt-1 mb-1 text-[11px] text-muted-foreground">배지 — 부제 아래 한 줄로 · 구분 출력</div>
                {(sec.badges ?? ["", "", ""]).map((b, k) => (
                  <div key={k} className="mb-1">
                    {label("배지 " + (k + 1), i * 10 + 40 + k)}
                    {inputRow(
                      input((sec.badges ?? ["", "", ""])[k] ?? "", (v) => {
                        const badges = [...(sec.badges ?? ["", "", ""])];
                        badges[k] = v;
                        patchSection(i, { badges } as Partial<Section>);
                      }, ["3PCS", "타원형/직사각형", "국내 유통"][k]),
                      "badge" + k
                    )}
                  </div>
                ))}
                {label("경고 문구 (반품 예방 — 예: 색상은 랜덤 발송됩니다)", i * 10 + 5)}
                {inputRow(input(sec.notice ?? "", (v) => patchSection(i, { notice: v } as Partial<Section>), "색상은 랜덤 발송됩니다"), "notice")}
                <FontSizeControl sec={sec} onSet={(n) => patchSection(i, { fontSize: n } as Partial<Section>)} />
              </>
            )}
            {(sec.type === "problem" || sec.type === "change" || sec.type === "howto") && (
              <>
                {label("제목", i * 10 + 1)}
                {inputRow(
                  input(sec.title, (v) => patchSection(i, { title: v } as Partial<Section>), sec.type === "problem" ? "이런 불편 있으셨죠" : sec.type === "change" ? "사용 후 달라진 생활" : "이렇게 사용하세요"),
                  "title"
                )}
                {areaRow("설명 (한 줄에 하나씩)", "body", area(sec.body, (v) => patchSection(i, { body: v } as Partial<Section>)))}
                {label("이미지 주소", i * 10 + 3)}
                {imageInput(sec.image, (v) => patchSection(i, { image: v } as Partial<Section>))}
                <FontSizeControl sec={sec} onSet={(n) => patchSection(i, { fontSize: n } as Partial<Section>)} />
              </>
            )}
            {sec.type === "usp" && (
              <>
                {label("제목 (비우면 CHECK POINT)", i * 10 + 0)}
                {inputRow(input(sec.title ?? "", (v) => patchSection(i, { title: v } as Partial<Section>), "CHECK POINT"), "title")}
                {sec.items.map((it, k) => (
                  <div key={k}>
                    {label("차별점 " + (k + 1) + " — 왜 사야 하는지(이득)를 쓰세요", i * 10 + 1 + k)}
                    {inputRow(
                      input(it ?? "", (v) => {
                        const items = [...sec.items];
                        items[k] = v;
                        patchSection(i, { items } as Partial<Section>);
                      }, CHECK_EXAMPLES[k] ?? CHECK_EXAMPLES[0]),
                      "item" + k
                    )}
                  </div>
                ))}
                <button className="mb-1 rounded border px-2 py-0.5 text-xs" onClick={() => patchSection(i, { items: [...sec.items, ""] } as Partial<Section>)}>+ 항목 추가</button>
                <FontSizeControl sec={sec} onSet={(n) => patchSection(i, { fontSize: n } as Partial<Section>)} />
              </>
            )}
            {sec.type === "review" && (
              <>
                {label("제목 (비우면 REVIEW)", i * 10 + 0)}
                {inputRow(input(sec.title ?? "", (v) => patchSection(i, { title: v } as Partial<Section>), "REVIEW"), "title")}
                {sec.items.map((it, k) => (
                  <div key={k}>
                    {label("후기 " + (k + 1), i * 10 + 1 + k)}
                    {inputRow(
                      input(it ?? "", (v) => {
                        const items = [...sec.items];
                        items[k] = v;
                        patchSection(i, { items } as Partial<Section>);
                      }, REVIEW_EXAMPLES[k] ?? REVIEW_EXAMPLES[0]),
                      "item" + k
                    )}
                  </div>
                ))}
                <button className="mb-1 rounded border px-2 py-0.5 text-xs" onClick={() => patchSection(i, { items: [...sec.items, ""] } as Partial<Section>)}>+ 항목 추가</button>
                <FontSizeControl sec={sec} onSet={(n) => patchSection(i, { fontSize: n } as Partial<Section>)} />
              </>
            )}
            {sec.type === "evidence" && (
              <>
                {(() => {
                  const labels = KIND_LABELS[doc.kind].size;
                  return (
                    <>
                      {label("제목 (비우면 SIZE & COLOR)", i * 10 + 0)}
                      {inputRow(input(sec.title ?? "", (v) => patchSection(i, { title: v } as Partial<Section>), "SIZE & COLOR"), "title")}
                      {label(labels[0], i * 10 + 1)}
                      {inputRow(input(sec.w ?? "", (v) => patchSection(i, { w: v } as Partial<Section>)), "w")}
                      {label(labels[1], i * 10 + 2)}
                      {inputRow(input(sec.d ?? "", (v) => patchSection(i, { d: v } as Partial<Section>)), "d")}
                      {label(labels[2], i * 10 + 3)}
                      {inputRow(input(sec.h ?? "", (v) => patchSection(i, { h: v } as Partial<Section>)), "h")}
                      {label(labels[3], i * 10 + 4)}
                      {inputRow(input(sec.weight ?? "", (v) => patchSection(i, { weight: v } as Partial<Section>)), "weight")}
                      {label("치수 단위", i * 10 + 5)}
                      <select
                        className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                        value={(sec.unit ?? "cm") || "cm"}
                        onChange={(e) => patchSection(i, { unit: e.target.value } as Partial<Section>)}
                      >
                        <option value="cm">cm</option>
                        <option value="mm">mm</option>
                        <option value="m">m</option>
                        <option value="inch">inch</option>
                      </select>
                      {label("색상", i * 10 + 6)}
                      {inputRow(input(sec.colors ?? "", (v) => patchSection(i, { colors: v } as Partial<Section>)), "colors")}
                      {label("소재", i * 10 + 7)}
                      {inputRow(input(sec.material ?? "", (v) => patchSection(i, { material: v } as Partial<Section>)), "material")}
                      {label("근거 이미지(치수 도면 등)", i * 10 + 8)}
                      {imageInput(sec.image ?? "", (v) => patchSection(i, { image: v } as Partial<Section>))}
                      <FontSizeControl sec={sec} onSet={(n) => patchSection(i, { fontSize: n } as Partial<Section>)} />
                    </>
                  );
                })()}
              </>
            )}
            {sec.type === "notice" && Array.isArray(sec.rows) && (
              <>
                {label("표 제목", i * 10 + 1)}
                {inputRow(input(sec.caption ?? "", (v) => patchSection(i, { caption: v } as Partial<Section>)), "caption")}
                <div className="mb-1 text-[11px] text-muted-foreground">값이 비었거나 '해당 없음'·'-'·'없음'인 행은 출력에서 자동으로 빠집니다.</div>
                {sec.rows.map((row, k) => (
                  <div key={k} className="mt-1 flex gap-2">
                    <div className="flex min-w-0 flex-1 items-center gap-1">
                      <div className="min-w-0 flex-1">
                        {input(row[0], (v) => {
                          const rows = sec.rows!.map((r, rk) => (rk === k ? [v, r[1]] : r));
                          patchSection(i, { rows } as Partial<Section>);
                        })}
                      </div>
                      {fsize("row" + k + "k")}
                    </div>
                    <div className="flex min-w-0 flex-1 items-center gap-1">
                      <div className="min-w-0 flex-1">
                        {input(row[1], (v) => {
                          const rows = sec.rows!.map((r, rk) => (rk === k ? [r[0], v] : r));
                          patchSection(i, { rows } as Partial<Section>);
                        })}
                      </div>
                      {fsize("row" + k + "v")}
                    </div>
                  </div>
                ))}
                <button className="mb-1 mt-1 rounded border px-2 py-0.5 text-xs" onClick={() => patchSection(i, { rows: [...sec.rows!, ["", ""]] } as Partial<Section>)}>+ 행 추가</button>
                <FontSizeControl sec={sec} onSet={(n) => patchSection(i, { fontSize: n } as Partial<Section>)} />
              </>
            )}
            {sec.type === "notice" && !Array.isArray(sec.rows) && (
              <>
                {label("제목", i * 10 + 1)}
                {inputRow(input(sec.title ?? "", (v) => patchSection(i, { title: v } as Partial<Section>)), "title")}
                {isShippingSection(sec.title ?? "") && (
                  <>
                    {label("배송비 (기본)", i * 10 + 2)}
                    {inputRow(input(sec.fee ?? "", (v) => patchSection(i, { fee: v } as Partial<Section>), "무료"), "fee")}
                    {label("도서산간 추가 배송비", i * 10 + 3)}
                    {inputRow(input(sec.island ?? "", (v) => patchSection(i, { island: v } as Partial<Section>), "3,000원 (제주·울릉 등)"), "island")}
                    {label("출고 기간", i * 10 + 4)}
                    {inputRow(input(sec.leadTime ?? "", (v) => patchSection(i, { leadTime: v } as Partial<Section>), "영업일 기준 2~3일"), "leadTime")}
                    <div className="mb-2 text-[11px] text-muted-foreground">세 칸 중 하나라도 채우면 아래 자유 문구 대신 이 세 줄로 출력됩니다.</div>
                  </>
                )}
                {isFreeServiceSection(sec.title ?? "") && (
                  <>
                    {label("무상 A/S 기간", i * 10 + 2)}
                    {inputRow(input(sec.asPeriod ?? "", (v) => patchSection(i, { asPeriod: v } as Partial<Section>), "구매 후 6개월"), "asPeriod")}
                    {label("무상 A/S 조건", i * 10 + 3)}
                    {inputRow(input(sec.asTerms ?? "", (v) => patchSection(i, { asTerms: v } as Partial<Section>), "제조 결함은 무상, 사용 중 파손은 유상"), "asTerms")}
                    <div className="mb-2 text-[11px] text-muted-foreground">두 칸 중 하나라도 채우면 아래 자유 문구 대신 기간/조건 두 줄로 출력됩니다.</div>
                  </>
                )}
                {areaRow("내용 (한 줄에 하나씩)", "lines", area((sec.lines ?? []).join("\n"), (v) => patchSection(i, { lines: v.split("\n") } as Partial<Section>), 4))}
                <FontSizeControl sec={sec} onSet={(n) => patchSection(i, { fontSize: n } as Partial<Section>)} />
              </>
            )}
            {sec.type === "detail" && (
              <>
                {label("DETAIL 이미지 1", i * 10 + 1)}
                {imageInput(sec.images[0] ?? "", (v) => patchSection(i, { images: [v, sec.images[1] ?? ""] } as Partial<Section>))}
                {label("캡션 1 (이미지 아래)", i * 10 + 2)}
                {inputRow(input((sec.captions ?? ["", ""])[0] ?? "", (v) => {
                  const captions = [v, (sec.captions ?? ["", ""])[1] ?? ""];
                  patchSection(i, { captions } as Partial<Section>);
                }), "caption0")}
                {label("DETAIL 이미지 2", i * 10 + 3)}
                {imageInput(sec.images[1] ?? "", (v) => patchSection(i, { images: [sec.images[0] ?? "", v] } as Partial<Section>))}
                {label("캡션 2 (이미지 아래)", i * 10 + 4)}
                {inputRow(input((sec.captions ?? ["", ""])[1] ?? "", (v) => {
                  const captions = [(sec.captions ?? ["", ""])[0] ?? "", v];
                  patchSection(i, { captions } as Partial<Section>);
                }), "caption1")}
                <FontSizeControl sec={sec} onSet={(n) => patchSection(i, { fontSize: n } as Partial<Section>)} />
              </>
            )}
          </div>
          );
        })}

        <div className="flex flex-wrap gap-2">
          {SECTION_TEMPLATES.map((t) => (
            <button key={t.type} title={t.hint} className="rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-accent" onClick={() => addSection(t.type)}>
              + {t.label}({t.type})
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2 border-t pt-3">
          <Button onClick={onCopy}>{copyLabel}</Button>
          <Button variant="outline" onClick={onDownloadHtml}>HTML 다운로드</Button>
          <Button variant="outline" onClick={onDownloadPng} disabled={pngState.status === "working"}>
            {pngState.status === "working" ? "PNG 생성 중..." : "PNG 다운로드"}
          </Button>
          <Button
            variant={showBoundary ? "default" : "outline"}
            title="미리보기에서 섹션 경계에 점선을 표시합니다(출력물에는 포함되지 않음)"
            onClick={() => setShowBoundary((v) => !v)}
          >
            {showBoundary ? "경계선 ON" : "경계선 OFF"}
          </Button>
          <Button variant="outline" onClick={onExportJson}>JSON 내보내기</Button>
          <Button variant="outline" onClick={() => fileRef.current?.click()}>JSON 불러오기</Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onImportJson(f); }}
          />
        </div>

        {serverError && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
            {serverError}
          </div>
        )}

        {copyIssues.length > 0 && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
            복사 검증 경고 — {copyIssues.join(" · ")}
          </div>
        )}
        {pngState.status === "error" && (
          <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-xs leading-relaxed text-red-700">
            {pngState.message}
          </div>
        )}
        {pngState.status === "done" && (
          <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-xs leading-relaxed text-emerald-800">
            {pngState.message}
          </div>
        )}
        {pngState.status === "working" && (
          <div className="rounded-lg border border-sky-300 bg-sky-50 p-3 text-xs leading-relaxed text-sky-800">
            {pngState.message}
          </div>
        )}

        {privateImgUrls.length > 0 && (
          <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-xs leading-relaxed text-red-700">
            ⚠ 내부 주소 이미지 {privateImgUrls.length}개 — 쿠팡에 올리면 구매자 화면에서 엑박이 됩니다: {privateImgUrls.join(", ")}
            <br />쿠팡 Wing 에디터에 이미지 파일을 직접 업로드하고 image.coupangcdn.com 주소로 바꿔 넣거나, 섹션별 PNG을 뽑아 에디터에 올려주세요.
          </div>
        )}

        {missingImgs.length > 0 && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
            이미지 주소가 비어 있음: {missingImgs.join(", ")}. 쿠팡에 업로드한 주소를 넣어야 실제 페이지에서 보입니다.
          </div>
        )}
      </div>

      <div className="max-h-[calc(100vh-140px)] overflow-y-auto rounded-2xl border bg-muted/40 p-6">
        <div
          id="builder-preview-sheet"
          className="mx-auto w-full max-w-[780px] bg-white p-0 shadow"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
      </div>
    </div>
  );
}

// localStorage 읽기 — 키를 초기화하거나 바꾸지 않고 읽기만 한다.
// 기존처럼 저장 전 원본을 .bak 키에 1회 복사해 둔다(이미 있으면 덮어쓰지 않는다).
// 유효한 데이터가 없으면 null을 반환한다.
function readLocalDoc(): Doc | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
      if (!localStorage.getItem(BACKUP_KEY)) localStorage.setItem(BACKUP_KEY, raw);
    } catch {}
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.sections)) return migrateDoc(parsed);
  } catch {}
  return null;
}

// 서버 문서 조회 — "비어 있음"과 "통신 불가"를 구분해야,
// 서버에 데이터가 있는데 GET이 일시 실패했을 때 마이그레이션 PUT으로 서버 데이터를
// 실수로 덮어쓰는 일이 없다.
async function fetchServerDoc(): Promise<
  { state: "ok"; doc: Doc } | { state: "empty" } | { state: "unreachable" }
> {
  try {
    const res = await fetch(DATA_API, { cache: "no-store" });
    if (!res.ok) return { state: "unreachable" };
    const data = await res.json();
    if (data && data.ok && data.doc && Array.isArray(data.doc.sections)) {
      return { state: "ok", doc: migrateDoc(data.doc) };
    }
    return { state: "empty" };
  } catch {
    return { state: "unreachable" };
  }
}

async function putServerDoc(doc: Doc, keepalive = false): Promise<boolean> {
  try {
    const res = await fetch(DATA_API, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ doc }),
      keepalive,
    });
    return res.ok;
  } catch {
    return false;
  }
}
