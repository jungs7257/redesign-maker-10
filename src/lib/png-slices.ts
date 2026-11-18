// PNG 내보내기 분할 유틸.
//
// html-to-image v1.11.13에는 clip 옵션이 없다(Options 타입에 clip 없음).
// 예전처럼 translateY로 한 노드를 밀어 자르면 클론된 transform/overflow 때문에
// 좌표가 어긋나 섹션이 겹치거나 뒤 섹션이 누락된다.
// 여기서는 (1) 캡처 DOM을 먼저 안정화하고, (2) 섹션 경계 기준으로 조각을 짜고,
// (3) 조각마다 새 host DOM을 만들어 해당 섹션 노드만 toPng 한다.
// 섹션 하나가 MAX 높이를 넘을 때만 PNG를 크롭해 픽셀 단위로 나눈다.

export const PNG_WIDTH = 780;
export const MAX_SLICE_HEIGHT = 3000;
export const PNG_PIXEL_RATIO = 2;

// CORS로 가져올 수 없는 원격 이미지 대신 쓰는 1×1 투명 PNG (기존과 동일)
export const PNG_PLACEHOLDER =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=";

type ToPngOptions = {
  width: number;
  height: number;
  pixelRatio: number;
  backgroundColor: string;
  skipFonts: boolean;
  imagePlaceholder?: string;
};

export type ToPng = (node: HTMLElement, options: ToPngOptions) => Promise<string>;

export type CaptureDeps = {
  toPng: ToPng;
  width?: number;
  maxSliceHeight?: number;
  pixelRatio?: number;
  imagePlaceholder?: string;
  onProgress?: (current: number, total: number) => void;
};

export type PngPlan = {
  /** 이 조각에 넣을 섹션 HTML (section wrapper 포함) */
  html: string;
  /** 원본 doc.sections 인덱스 */
  sections: number[];
  /** 전체 캡처 DOM에서의 시작 y (CSS px) */
  start: number;
  /** 조각 높이 (CSS px) */
  height: number;
  /** 섹션 하나가 너무 커서 픽셀 크롭이 필요한 경우 true */
  cropped: boolean;
  /** 크롭 원본 높이. cropped일 때만 의미 있음 */
  fullHeight: number;
  /** 크롭 원본에서의 시작 y (CSS px). cropped일 때만 의미 있음 */
  cropTop: number;
};

export type CapturedSlice = PngPlan & {
  dataUrl: string;
  pixelWidth: number;
  pixelHeight: number;
};

const raf = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("생성된 PNG 이미지를 읽을 수 없습니다."));
    img.src = src;
  });
}

async function decodeImage(img: HTMLImageElement): Promise<void> {
  try {
    await img.decode();
    return;
  } catch {
    // decode()가 지원되지 않거나 실패하면 load 이벤트로 폴백한다.
  }
  if (img.complete && img.naturalWidth > 0) return;
  await new Promise<void>((resolve) => {
    const done = () => resolve();
    img.addEventListener("load", done, { once: true });
    img.addEventListener("error", done, { once: true });
    window.setTimeout(done, 3000);
  });
}

/** 캡처 DOM의 이미지를 안정화한다: 프록시 → data URL → decode → 크기 고정. */
export async function prepareCaptureImages(
  root: HTMLElement,
  proxyUrl: (raw: string) => string
): Promise<void> {
  const imgs = Array.from(root.querySelectorAll("img"));

  // 1) 외부 출처 이미지는 같은 출처 프록시로 바꾼다 (canvas tainted 방지).
  for (const im of imgs) {
    const raw = (im.getAttribute("src") || "").trim();
    if (!raw || raw.startsWith("data:")) continue;
    let origin = "";
    try {
      origin = new URL(raw, window.location.href).origin;
    } catch {
      continue;
    }
    if (origin !== window.location.origin) im.setAttribute("src", proxyUrl(raw));
  }

  // 2) 교체된 src의 로드 완료를 기다린다 (기존 15초 상한 유지).
  await Promise.race([
    Promise.all(
      imgs.map(
        (im) =>
          new Promise<void>((resolve) => {
            if (im.complete) return resolve();
            im.addEventListener("load", () => resolve(), { once: true });
            im.addEventListener("error", () => resolve(), { once: true });
          })
      )
    ),
    new Promise<void>((resolve) => window.setTimeout(resolve, 15000)),
  ]);

  // 3) 렌더된 이미지를 fetch → blob → data URL로 바꿔 외부 픽셀이 섞이지 않게 한다.
  await Promise.all(
    imgs.map(async (im) => {
      const src = (im.currentSrc || im.getAttribute("src") || "").trim();
      if (!src || src.startsWith("data:")) return;
      try {
        const res = await fetch(src);
        if (!res.ok) return;
        const blob = await res.blob();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(String(fr.result || ""));
          fr.onerror = () => reject(fr.error ?? new Error("FileReader 실패"));
          fr.readAsDataURL(blob);
        });
        if (!dataUrl.startsWith("data:")) return;
        im.setAttribute("src", dataUrl);
        await decodeImage(im);
      } catch {
        // 개별 실패는 기존 imagePlaceholder 폴백에 맡긴다.
      }
    })
  );

  // 4) 늦은 렌더로 높이가 작아지는 사고를 막기 위해 모든 img를 decode하고
  //    naturalWidth 기준으로 width/height/aspect-ratio를 명시 고정한다.
  await Promise.all(
    imgs.map(async (im) => {
      const nw = im.naturalWidth;
      const nh = im.naturalHeight;
      if (nw <= 0 || nh <= 0) return;
      await decodeImage(im);
      const cssW = PNG_WIDTH;
      const cssH = Math.max(1, Math.round((cssW * nh) / nw));
      im.style.width = cssW + "px";
      im.style.height = cssH + "px";
      im.style.aspectRatio = nw + " / " + nh;
      im.style.maxWidth = "none";
      im.style.display = "block";
    })
  );
}

/** rAF 2회 + 높이 2회 연속 측정이 일치할 때까지 기다린 뒤 안정된 높이를 반환. */
export async function waitForStableHeight(root: HTMLElement): Promise<number> {
  await raf();
  await raf();
  let previous = -1;
  for (let i = 0; i < 8; i++) {
    const before = root.getBoundingClientRect().height;
    await raf();
    const after = root.getBoundingClientRect().height;
    if (Math.abs(after - before) < 0.5 && Math.abs(after - previous) < 0.5) return after;
    previous = after;
  }
  return Math.max(0, previous, root.getBoundingClientRect().height);
}

/** 섹션 wrapper 경계를 우선으로 조각 계획을 세운다. 높이 합은 항상 전체 높이와 같다. */
export function planSlices(root: HTMLElement, maxHeight: number): { plans: PngPlan[]; totalHeight: number } {
  const wrappers = Array.from(root.children).filter(
    (el): el is HTMLElement => el instanceof HTMLElement && el.hasAttribute("data-png-section")
  );
  // 각 섹션의 border-box 높이를 정수로 올려 측정한다. Tailwind preflight로
  // p/div margin이 0이라 섹션 높이는 더해도 전체 높이와 같다.
  const heights = wrappers.map((el) => Math.max(1, Math.ceil(el.getBoundingClientRect().height)));
  const totalHeight = heights.reduce((a, b) => a + b, 0);

  const plans: PngPlan[] = [];
  let groupHtml: string[] = [];
  let groupSections: number[] = [];
  let groupStart = 0;
  let groupHeight = 0;
  let cursor = 0;

  const flush = () => {
    if (groupHtml.length === 0) return;
    plans.push({
      html: groupHtml.join(""),
      sections: groupSections.slice(),
      start: groupStart,
      height: groupHeight,
      cropped: false,
      fullHeight: groupHeight,
      cropTop: 0,
    });
    groupHtml = [];
    groupSections = [];
    groupHeight = 0;
  };

  wrappers.forEach((el, idx) => {
    const h = heights[idx];
    const sec = Number(el.getAttribute("data-png-section"));

    if (h > maxHeight) {
      flush();
      const pieces = Math.ceil(h / maxHeight);
      for (let p = 0; p < pieces; p++) {
        const pieceHeight = Math.min(maxHeight, h - p * maxHeight);
        plans.push({
          html: el.outerHTML,
          sections: [sec],
          start: cursor + p * maxHeight,
          height: pieceHeight,
          cropped: true,
          fullHeight: h,
          cropTop: p * maxHeight,
        });
      }
      cursor += h;
      return;
    }

    if (groupHtml.length > 0 && groupHeight + h > maxHeight) {
      flush();
      groupStart = cursor;
    }
    if (groupHtml.length === 0) groupStart = cursor;
    groupHtml.push(el.outerHTML);
    groupSections.push(sec);
    groupHeight += h;
    cursor += h;
  });
  flush();

  return { plans, totalHeight };
}

function toPngOptions(deps: CaptureDeps, height: number): ToPngOptions {
  return {
    width: deps.width ?? PNG_WIDTH,
    height,
    pixelRatio: deps.pixelRatio ?? PNG_PIXEL_RATIO,
    backgroundColor: "#ffffff",
    skipFonts: true,
    imagePlaceholder: deps.imagePlaceholder ?? PNG_PLACEHOLDER,
  };
}

/** 조각 HTML만 담은 새 host DOM을 만들어 toPng 한다. translate/transform은 쓰지 않는다. */
async function renderNode(deps: CaptureDeps, html: string, height: number): Promise<string> {
  const width = deps.width ?? PNG_WIDTH;
  const host = document.createElement("div");
  host.style.cssText = `position:absolute;left:-99999px;top:0;width:${width}px;`;
  const root = document.createElement("div");
  root.style.cssText = `width:${width}px;background:#ffffff;overflow:hidden;`;
  root.innerHTML = html;
  host.appendChild(root);
  document.body.appendChild(host);
  try {
    // src는 이미 data URL이고 크기는 인라인으로 고정돼 있다. 여기선 decode만 확인한다.
    await Promise.all(
      Array.from(root.querySelectorAll("img")).map(async (im) => {
        if (im.naturalWidth > 0) await decodeImage(im);
      })
    );
    await waitForStableHeight(root);
    return await deps.toPng(root, toPngOptions(deps, height));
  } finally {
    if (host.parentNode) host.parentNode.removeChild(host);
  }
}

/** 큰 섹션을 여러 PNG로 자를 때 원본 PNG의 한 띄만 canvas로 잘라낸다. */
async function cropPngBand(
  fullDataUrl: string,
  plan: PngPlan,
  deps: CaptureDeps
): Promise<string> {
  const width = deps.width ?? PNG_WIDTH;
  const pixelRatio = deps.pixelRatio ?? PNG_PIXEL_RATIO;
  const img = await loadImage(fullDataUrl);
  const outW = Math.max(1, Math.round(width * pixelRatio));
  const outH = Math.max(1, Math.round(plan.height * pixelRatio));
  // html-to-image가 캔버스 한계(16384px)를 넘으면 자동 축소하므로 비율을 보정한다.
  const scale = img.naturalWidth > 0 ? img.naturalWidth / outW : 1;
  const srcW = Math.max(1, Math.min(img.naturalWidth, Math.round(outW * scale)));
  const srcH = Math.max(1, Math.min(img.naturalHeight, Math.round(plan.height * pixelRatio * scale)));
  const srcY = Math.max(0, Math.min(img.naturalHeight - srcH, Math.round(plan.cropTop * pixelRatio * scale)));

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("이미지 크롭용 캔버스를 만들 수 없습니다.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, outW, outH);
  ctx.drawImage(img, 0, srcY, srcW, srcH, 0, 0, outW, outH);
  return canvas.toDataURL("image/png");
}

/** 계획된 모든 조각을 캡처한다. 큰 섹션의 원본 PNG는 섹션당 한 번만 렌더한다. */
export async function capturePngSlices(plans: PngPlan[], deps: CaptureDeps): Promise<CapturedSlice[]> {
  const width = deps.width ?? PNG_WIDTH;
  const pixelRatio = deps.pixelRatio ?? PNG_PIXEL_RATIO;
  const fullCache = new Map<string, string>();
  const results: CapturedSlice[] = [];

  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i];
    deps.onProgress?.(i + 1, plans.length);
    let dataUrl: string;
    if (plan.cropped) {
      const key = plan.sections.join(",") + "@" + plan.fullHeight;
      let full = fullCache.get(key);
      if (!full) {
        full = await renderNode(deps, plan.html, plan.fullHeight);
        fullCache.set(key, full);
      }
      dataUrl = await cropPngBand(full, plan, deps);
    } else {
      dataUrl = await renderNode(deps, plan.html, plan.height);
    }
    results.push({
      ...plan,
      dataUrl,
      pixelWidth: Math.round(width * pixelRatio),
      pixelHeight: Math.round(plan.height * pixelRatio),
    });
  }
  return results;
}
