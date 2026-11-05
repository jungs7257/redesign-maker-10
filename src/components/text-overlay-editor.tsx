"use client";

/**
 * 문구 수정 편집기 (2026-11-05 정쓰님 요청)
 * AI가 만든 이미지 위에 텍스트 박스를 겹쳐 올리고, 브라우저에서 문구를 수정한 뒤
 * canvas로 합성 PNG를 내려받는다. AI 호출 없음 → 크레딧 0원.
 * 구워진(baked-in) 기존 글자는 각 박스의 "덮개" 배경으로 가리고 그 위에 새 글자를 얹는다.
 */

import React from "react";
import { X, Download, Plus, Trash2, Pipette } from "lucide-react";
type SectionCopy = {
  eyebrow: string;
  headline: string;
  subheadline: string;
  points: Array<{ label: string; desc: string }>;
  extras: string[];
};

type OverlayBox = {
  id: string;
  text: string;
  // 이미지 대비 비율(0~1). 이미지 크기가 달라도 위치 유지
  x: number;
  y: number;
  w: number;
  fontSize: number; // 이미지 세로 대비 비율 (예: 0.045)
  bold: boolean;
  color: string;
  align: "left" | "center";
  letterSpacing: number; // em 단위 (이미지 세로 폰트 크기 대비)
  lineHeight: number;    // 배수
  // 덮개: 기존 굽어진 글자를 가리는 배경 패치
  cover: boolean;
  coverColor: string;
  coverPad: number; // 글자 주변 덮개 여유 (이미지 세로 대비 비율)
};

type ImageOverlay = {
  id: string;
  src: string;
  x: number;
  y: number;
  w: number;
  h: number;
  opacity: number;
};

const DEFAULT_COLOR = "#333c44";
const LABEL_COLOR = "#78828c";

function boxesFromCopy(copy?: SectionCopy): OverlayBox[] {
  const boxes: OverlayBox[] = [];
  let y = 0.06;
  const push = (text: string, opts: Partial<OverlayBox>) => {
    if (!text) return;
    boxes.push({
      id: String(Math.random()).slice(2),
      text,
      x: 0.06,
      y,
      w: 0.88,
      fontSize: 0.045,
      bold: true,
      color: DEFAULT_COLOR,
      align: "left",
      letterSpacing: 0,
      lineHeight: 1.25,
      cover: false,
      coverColor: "#ffffff",
      coverPad: 0.012,
      ...opts
    });
    y += 0.075;
  };
  if (copy) {
    push(copy.eyebrow, { fontSize: 0.03, bold: false, color: LABEL_COLOR });
    if (copy.headline) {
      copy.headline.split("\n").forEach((line: string) => {
        push(line, { fontSize: 0.052 });
      });
    }
    push(copy.subheadline, { fontSize: 0.03, bold: false, color: LABEL_COLOR });
    copy.points.forEach((point: { label: string; desc: string }) => {
      push(point.label, { fontSize: 0.036 });
      push(point.desc, { fontSize: 0.028, bold: false, color: LABEL_COLOR });
    });
    copy.extras.forEach((extra: string) => push(extra, { fontSize: 0.026, bold: false, color: LABEL_COLOR }));
  } else {
    push("여기를 클릭해 문구를 입력하세요", { fontSize: 0.04 });
  }
  return boxes;
}

export function TextOverlayEditor(props: {
  sectionName: string;
  imageUrl: string;
  copy?: SectionCopy;
  onClose: () => void;
}) {
  const { sectionName, imageUrl, copy, onClose } = props;
  // 구워진(baked-in) 이미지는 카피 자동 배치가 실제 글자 위치와 어긋나므로
  // 저장된 편집 초안이 없으면 빈 상태로 시작하고, 사용자가 원하는 위치에 박스를 얹는다.
  const draftKey = `overlay-draft:${sectionName}`;
  const [boxes, setBoxes] = React.useState<OverlayBox[]>(() => {
    try {
      const saved = localStorage.getItem(draftKey);
      if (saved) return JSON.parse(saved) as OverlayBox[];
    } catch {}
    return [];
  });
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [imgSize, setImgSize] = React.useState<{ w: number; h: number } | null>(null);
  const stageRef = React.useRef<HTMLDivElement | null>(null);
  const dragRef = React.useRef<{ id: string; mode: "move" | "resize"; dx: number; dy: number } | null>(null);
  const [images, setImages] = React.useState<ImageOverlay[]>(() => {
    try {
      const saved = localStorage.getItem(draftKey + ":images");
      if (saved) return JSON.parse(saved) as ImageOverlay[];
    } catch {}
    return [];
  });
  const [selectedImageId, setSelectedImageId] = React.useState<string | null>(null);
  const imageInputRef = React.useRef<HTMLInputElement | null>(null);

  const selected = boxes.find((box) => box.id === selectedId) || null;
  const selectedImage = images.find((img) => img.id === selectedImageId) || null;

  React.useEffect(() => {
    const image = new Image();
    image.onload = () => setImgSize({ w: image.naturalWidth, h: image.naturalHeight });
    image.src = imageUrl;
  }, [imageUrl]);

  // 편집 초안 자동 저장 (중간 저장): 브라우저 로컬에 보관 후 다시 열면 복원
  React.useEffect(() => {
    try {
      localStorage.setItem(draftKey, JSON.stringify(boxes));
      localStorage.setItem(draftKey + ":images", JSON.stringify(images));
    } catch {}
  }, [boxes, images, draftKey]);

  const updateBox = (id: string, patch: Partial<OverlayBox>) => {
    setBoxes((current) => current.map((box) => (box.id === id ? { ...box, ...patch } : box)));
  };

  const beginDrag = (event: React.PointerEvent, id: string, mode: "move" | "resize", ox: number, oy: number) => {
    event.stopPropagation();
    setSelectedId(id);
    setSelectedImageId(null);
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    dragRef.current = {
      id,
      mode,
      dx: (event.clientX - rect.left) / rect.width - ox,
      dy: (event.clientY - rect.top) / rect.height - oy
    };
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
  };

  const onPointerDown = (event: React.PointerEvent, box: OverlayBox) => {
    beginDrag(event, box.id, "move", box.x, box.y);
  };

  const onResizeDown = (event: React.PointerEvent, box: OverlayBox) => {
    beginDrag(event, box.id, "resize", box.x, box.y);
  };

  const beginImageDrag = (event: React.PointerEvent, img: ImageOverlay, mode: "move" | "resize") => {
    event.stopPropagation();
    setSelectedImageId(img.id);
    setSelectedId(null);
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    dragRef.current = {
      id: img.id,
      mode,
      dx: (event.clientX - rect.left) / rect.width - img.x,
      dy: (event.clientY - rect.top) / rect.height - img.y
    };
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    const stage = stageRef.current;
    if (!drag || !stage) return;
    const rect = stage.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width;
    const py = (event.clientY - rect.top) / rect.height;
    if (drag.mode === "move") {
      const x = Math.min(0.98, Math.max(-0.2, px - drag.dx));
      const y = Math.min(1.2, Math.max(-0.2, py - drag.dy));
      if (images.some((img) => img.id === drag.id)) {
        setImages((current) => current.map((img) => (img.id === drag.id ? { ...img, x, y } : img)));
      } else {
        updateBox(drag.id, { x, y });
      }
    } else {
      const w = Math.min(1.2, Math.max(0.03, px - drag.dx));
      const h = Math.min(1.5, Math.max(0.02, py - drag.dy));
      if (images.some((img) => img.id === drag.id)) {
        setImages((current) => current.map((img) => (img.id === drag.id ? { ...img, w, h } : img)));
      } else {
        updateBox(drag.id, { w });
      }
    }
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  const addImage = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img: ImageOverlay = {
        id: String(Math.random()).slice(2),
        src: String(reader.result),
        x: 0.25,
        y: 0.35,
        w: 0.5,
        h: 0.3,
        opacity: 1
      };
      setImages((current) => [...current, img]);
      setSelectedImageId(img.id);
    };
    reader.readAsDataURL(file);
  };

  const removeImage = (id: string) => {
    setImages((current) => current.filter((img) => img.id !== id));
    setSelectedImageId(null);
  };

  const addBox = () => {
    const box: OverlayBox = {
      id: String(Math.random()).slice(2),
      text: "새 문구",
      x: 0.1,
      y: 0.5,
      w: 0.8,
      fontSize: 0.04,
      bold: true,
      color: DEFAULT_COLOR,
      align: "left",
      letterSpacing: 0,
      lineHeight: 1.25,
      cover: false,
      coverColor: "#ffffff",
      coverPad: 0.012
    };
    setBoxes((current) => [...current, box]);
    setSelectedId(box.id);
  };

  const removeBox = (id: string) => {
    setBoxes((current) => current.filter((box) => box.id !== id));
    setSelectedId(null);
  };

  const sampleCoverColor = () => {
    // 이미지에서 클릭한 지점의 색을 선택된 박스의 덮개색으로 사용
    if (!selected || !imgSize) return;
    const canvas = document.createElement("canvas");
    canvas.width = imgSize.w;
    canvas.height = imgSize.h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const image = new Image();
    image.onload = () => {
      ctx.drawImage(image, 0, 0);
      const onPick = (event: MouseEvent) => {
        const rect = canvas.getBoundingClientRect();
        const px = Math.floor(((event.clientX - rect.left) / rect.width) * imgSize.w);
        const py = Math.floor(((event.clientY - rect.top) / rect.height) * imgSize.h);
        const data = ctx.getImageData(px, py, 1, 1).data;
        const hex = "#" + [data[0], data[1], data[2]].map((v) => v.toString(16).padStart(2, "0")).join("");
        updateBox(selected.id, { coverColor: hex });
        window.removeEventListener("click", onPick, true);
        document.body.style.cursor = "";
      };
      window.addEventListener("click", onPick, true);
      document.body.style.cursor = "crosshair";
    };
    image.src = imageUrl;
  };

  const exportPng = async () => {
    if (!imgSize) return;
    const canvas = document.createElement("canvas");
    canvas.width = imgSize.w;
    canvas.height = imgSize.h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const image = new Image();
    await new Promise<void>((resolve) => {
      image.onload = () => resolve();
      image.src = imageUrl;
    });
    ctx.drawImage(image, 0, 0);
    for (const overlay of images) {
      const imgEl = new Image();
      await new Promise<void>((resolve) => {
        imgEl.onload = () => resolve();
        imgEl.src = overlay.src;
      });
      ctx.globalAlpha = overlay.opacity;
      ctx.drawImage(imgEl, overlay.x * imgSize.w, overlay.y * imgSize.h, overlay.w * imgSize.w, overlay.h * imgSize.h);
      ctx.globalAlpha = 1;
    }
    const scale = imgSize.h;
    if (document.fonts && document.fonts.load) {
      const probe = Math.round(scale * 0.05);
      await Promise.all([
        document.fonts.load(`700 ${probe}px "Noto Sans KR"`),
        document.fonts.load(`400 ${probe}px "Noto Sans KR"`),
        document.fonts.ready
      ]).catch(() => undefined);
    }
    for (const box of boxes) {
      const fontSize = Math.round(scale * box.fontSize);
      const x = box.x * imgSize.w;
      const baseY = box.y * imgSize.h;
      ctx.font = `${box.bold ? "700" : "400"} ${fontSize}px "Noto Sans KR", "Noto Sans CJK KR", sans-serif`;
      ctx.fillStyle = box.color;
      ctx.textBaseline = "top";
      const emPx = fontSize * box.letterSpacing;
      const stepY = fontSize * box.lineHeight;
      const lines = box.text.split("\n");
      const maxWidth = box.w * imgSize.w;
      // 덮개: 실제 렌더될 글자 실측 폭에 맞춰 타이트하게 채운다 (빈 여백 없음)
      if (box.cover) {
        const pad = scale * box.coverPad;
        ctx.fillStyle = box.coverColor;
        // 덮개는 박스 폭 전체를 덮는다 — 파란 핸들로 조절한 크기만큼 정확히 가려짐
        ctx.fillRect(x - pad, baseY - pad, maxWidth + pad * 2, stepY * lines.length + pad * 2);
        ctx.fillStyle = box.color;
      }
      let y = baseY;
      for (const line of lines) {
        ctx.textAlign = box.align === "center" ? "center" : "left";
        const drawX = box.align === "center" ? x + maxWidth / 2 : x;
        if (Math.abs(emPx) > 0.001) {
          // 자간 수동 렌더: 글자별로 그리기
          let cursor = drawX;
          if (box.align === "center") {
            const total = Array.from(line).reduce((acc, ch) => acc + ctx.measureText(ch).width + emPx, 0) - emPx;
            cursor = drawX - total / 2;
          }
          for (const ch of Array.from(line)) {
            ctx.fillText(ch, cursor, y);
            cursor += ctx.measureText(ch).width + emPx;
          }
          y += 0; // 줄바꿈은 아래 공통 처리에서
          continue;
        }
        // 간단한 자동 줄바꿈
        const chars = Array.from(line);
        let current = "";
        for (const char of chars) {
          if (ctx.measureText(current + char).width + emPx > maxWidth && current) {
            ctx.fillText(current, drawX, y);
            y += stepY;
            current = char;
          } else {
            current += char;
          }
        }
        ctx.fillText(current, drawX, y);
        y += stepY;
      }
    }
    const link = document.createElement("a");
    link.download = `${sectionName.replace(/[^\w가-힣-]+/g, "_")}_edited.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-foreground/90 backdrop-blur-sm" onClick={onClose}>
      <div className="flex shrink-0 items-center justify-between gap-3 px-5 py-3 text-background" onClick={(event) => event.stopPropagation()}>
        <strong className="truncate text-sm">문구 수정 · {sectionName}</strong>
        <div className="flex items-center gap-1">
          <button type="button" className="rounded-full px-3 py-1.5 text-xs font-bold transition hover:bg-white/15" onClick={() => imageInputRef.current?.click()}>
            <Plus className="mr-1 inline size-4" />이미지 붙이기
          </button>
          <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => { const f = event.target.files?.[0]; if (f) addImage(f); event.target.value = ""; }} />
          <button type="button" className="rounded-full px-3 py-1.5 text-xs font-bold transition hover:bg-white/15" onClick={addBox}>
            <Plus className="mr-1 inline size-4" />박스 추가
          </button>
          <button type="button" className="rounded-full px-3 py-1.5 text-xs font-bold transition hover:bg-white/15" onClick={exportPng} disabled={!imgSize}>
            <Download className="mr-1 inline size-4" />PNG 저장
          </button>
          <button type="button" className="grid size-9 place-items-center rounded-full transition hover:bg-white/15" onClick={onClose} aria-label="닫기">
            <X className="size-5" />
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-4 px-5 pb-5" onClick={(event) => event.stopPropagation()}>
        {/* 이미지 + 오버레이 */}
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-2xl bg-black/20">
          <div
            ref={stageRef}
            className="relative select-none"
            style={{ height: "calc(100vh - 11rem)", maxWidth: "100%", containerType: "size", aspectRatio: imgSize ? `${imgSize.w} / ${imgSize.h}` : "9 / 16" }}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl} alt={sectionName} className="pointer-events-none block h-full w-full object-contain rounded-xl" draggable={false} />
            {images.map((overlay) => (
              <div
                key={overlay.id}
                className="absolute"
                style={{
                  left: `${overlay.x * 100}%`,
                  top: `${overlay.y * 100}%`,
                  width: `${overlay.w * 100}%`,
                  height: `${overlay.h * 100}%`,
                  opacity: overlay.opacity,
                  outline: selectedImageId === overlay.id ? "2px dashed #22c55e" : "none"
                }}
                onPointerDown={(event) => beginImageDrag(event, overlay, "move")}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={overlay.src} alt="붙인 이미지" className="pointer-events-none h-full w-full" draggable={false} />
                {selectedImageId === overlay.id ? (
                  <span
                    className="absolute -bottom-2 -right-2 size-4 cursor-se-resize rounded-full border-2 border-white bg-emerald-500"
                    onPointerDown={(event) => beginImageDrag(event, overlay, "resize")}
                  />
                ) : null}
              </div>
            ))}
            {boxes.map((box) => (
              <div
                key={box.id}
                className="absolute cursor-move whitespace-pre-wrap break-keep"
                style={{
                  left: `${box.x * 100}%`,
                  top: `${box.y * 100}%`,
                  width: `${box.w * 100}%`,
                  fontSize: `${box.fontSize * 100}cqh`,
                  fontWeight: box.bold ? 700 : 400,
                  color: box.color,
                  textAlign: box.align,
                  background: box.cover ? box.coverColor : "transparent",
                  padding: box.cover ? `${box.coverPad * 100}cqh` : 0,
                  outline: selectedId === box.id ? "2px dashed #4f8cff" : "none",
                  lineHeight: box.lineHeight,
                  letterSpacing: `${box.letterSpacing}em`
                }}
                onPointerDown={(event) => onPointerDown(event, box)}
              >
                {box.text}
                {selectedId === box.id ? (
                  <span
                    className="absolute -bottom-2 -right-2 size-4 cursor-se-resize rounded-full border-2 border-white bg-blue-500"
                    onPointerDown={(event) => onResizeDown(event, box)}
                  />
                ) : null}
              </div>
            ))}
          </div>
        </div>

        {/* 속성 패널 */}
        <div className="w-64 shrink-0 space-y-3 overflow-y-auto rounded-2xl bg-background p-4 text-foreground">
          {selectedImage ? (
            <>
              <label className="block text-xs font-bold">너비 {Math.round(selectedImage.w * 100)}%</label>
              <input type="range" min={0.05} max={1.2} step={0.01} value={selectedImage.w} onChange={(event) => setImages((current) => current.map((img) => (img.id === selectedImage.id ? { ...img, w: Number(event.target.value) } : img)))} className="w-full" />
              <label className="block text-xs font-bold">높이 {Math.round(selectedImage.h * 100)}%</label>
              <input type="range" min={0.02} max={1.5} step={0.01} value={selectedImage.h} onChange={(event) => setImages((current) => current.map((img) => (img.id === selectedImage.id ? { ...img, h: Number(event.target.value) } : img)))} className="w-full" />
              <label className="block text-xs font-bold">투명도 {Math.round(selectedImage.opacity * 100)}%</label>
              <input type="range" min={0.1} max={1} step={0.05} value={selectedImage.opacity} onChange={(event) => setImages((current) => current.map((img) => (img.id === selectedImage.id ? { ...img, opacity: Number(event.target.value) } : img)))} className="w-full" />
              <button type="button" className="flex w-full items-center justify-center gap-1 rounded-lg border border-destructive/40 px-2 py-1.5 text-xs font-bold text-destructive hover:bg-destructive/10" onClick={() => removeImage(selectedImage.id)}>
                <Trash2 className="size-3.5" />이미지 삭제
              </button>
            </>
          ) : selected ? (
            <>
              <label className="block text-xs font-bold">문구</label>
              <textarea
                className="h-28 w-full rounded-lg border p-2 text-sm"
                value={selected.text}
                onChange={(event) => updateBox(selected.id, { text: event.target.value })}
              />
              <label className="block text-xs font-bold">글자 크기 {Math.round(selected.fontSize * 1000) / 10}%</label>
              <input type="range" min={0.015} max={0.09} step={0.001} value={selected.fontSize} onChange={(event) => updateBox(selected.id, { fontSize: Number(event.target.value) })} className="w-full" />
              <label className="block text-xs font-bold">자간 {selected.letterSpacing.toFixed(2)}em</label>
              <input type="range" min={-0.1} max={0.5} step={0.01} value={selected.letterSpacing} onChange={(event) => updateBox(selected.id, { letterSpacing: Number(event.target.value) })} className="w-full" />
              <label className="block text-xs font-bold">줄간격 {selected.lineHeight.toFixed(2)}배</label>
              <input type="range" min={0.9} max={2.2} step={0.05} value={selected.lineHeight} onChange={(event) => updateBox(selected.id, { lineHeight: Number(event.target.value) })} className="w-full" />
              <div className="flex gap-3 text-xs">
                <label className="flex items-center gap-1">
                  <input type="checkbox" checked={selected.bold} onChange={(event) => updateBox(selected.id, { bold: event.target.checked })} />굵게
                </label>
                <label className="flex items-center gap-1">
                  <input type="checkbox" checked={selected.align === "center"} onChange={(event) => updateBox(selected.id, { align: event.target.checked ? "center" : "left" })} />가운데
                </label>
              </div>
              <label className="block text-xs font-bold">글자색</label>
              <input type="color" value={selected.color} onChange={(event) => updateBox(selected.id, { color: event.target.value })} className="h-8 w-full" />
              <div className="rounded-lg border p-2">
                <label className="flex items-center gap-2 text-xs font-bold">
                  <input type="checkbox" checked={selected.cover} onChange={(event) => updateBox(selected.id, { cover: event.target.checked })} />
                  덮개(기존 글자 가리기)
                </label>
                {selected.cover ? (
                  <div className="mt-2 space-y-2">
                    <input type="color" value={selected.coverColor} onChange={(event) => updateBox(selected.id, { coverColor: event.target.value })} className="h-8 w-full" />
                    <button type="button" className="w-full rounded-lg border px-2 py-1 text-xs font-bold hover:bg-muted" onClick={sampleCoverColor}>
                      <Pipette className="mr-1 inline size-3.5" />이미지에서 색 추출
                    </button>
                  </div>
                ) : null}
              </div>
              <button type="button" className="flex w-full items-center justify-center gap-1 rounded-lg border border-destructive/40 px-2 py-1.5 text-xs font-bold text-destructive hover:bg-destructive/10" onClick={() => removeBox(selected.id)}>
                <Trash2 className="size-3.5" />박스 삭제
              </button>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">문구 박스나 붙인 이미지를 클릭하면 수정할 수 있어요. 드래그로 이동, 파란/초록 원 핸들로 크기 조절, 덮개는 글자에 딱 맞게 붙습니다, 덮개 기능으로 기존 글자를 가릴 수 있습니다.</p>
          )}
        </div>
      </div>
    </div>
  );
}
