#!/usr/bin/env python3
"""[작업1] 픽셀 실측 — 본문 12px/20px 두 스크린샷의 실제 글자 픽셀 차이 측정(PIL).

사용: python3 qa/fieldsize/measure.py pixel-12.png pixel-20.png
출력: JSON (표준 출력)

측정 방법:
  1. 두 이미지의 차분(diff) bbox — 픽셀이 달라진 영역
  2. 첫 잉크 밴드 = 제목(두 문서에서 동일해야 함)을 찾는다
  3. 제목 아래 영역에서 잉크(배경 흰색이 아닌 픽셀)의 세로 범위 = 본문 글자 실측 높이
     — 작은 글자는 안티앨리어싱으로 회색 농도가 옅어지므로 임계값은 250(≈비흰색)으로
       넉넉히 잡는다.
"""
import json
import sys

from PIL import Image, ImageChops

INK_THRESHOLD = 250  # 배경이 순백(255)이므로 이보다 어두우면 잉크로 본다


def row_ink_counts(img, threshold=INK_THRESHOLD):
    gray = img.convert("L")
    px = gray.load()
    w, h = gray.size
    counts = []
    for y in range(h):
        dark = 0
        for x in range(w):
            if px[x, y] < threshold:
                dark += 1
        counts.append(dark)
    return counts


def first_band(counts, min_row_ink=2):
    """첫 잉크 밴드 (시작행, 끝행) — 최소 min_row_ink 픽셀 이상인 연속 구간."""
    start = None
    for y, c in enumerate(counts):
        if c >= min_row_ink:
            start = y
            break
    if start is None:
        return None
    end = start
    gap = 0
    for y in range(start + 1, len(counts)):
        if counts[y] >= min_row_ink:
            end = y
            gap = 0
        else:
            gap += 1
            if gap > 3:  # 3행 이상 비면 밴드 끝
                break
    return (start, end)


def ink_extent_below(counts, below_y, min_row_ink=2):
    """below_y 아래에서 잉크가 있는 행 범위 (시작, 끝)와 총 잉크 픽셀 수."""
    ys = [y for y in range(below_y, len(counts)) if counts[y] >= min_row_ink]
    if not ys:
        return None, 0
    total = sum(counts[y] for y in range(below_y, len(counts)))
    return (min(ys), max(ys)), total


def main():
    a_path, b_path = sys.argv[1], sys.argv[2]
    a = Image.open(a_path).convert("RGB")
    b = Image.open(b_path).convert("RGB")
    if a.size != b.size:
        print(json.dumps({"error": f"크기 불일치: {a.size} vs {b.size}"}, ensure_ascii=False))
        return

    diff = ImageChops.difference(a, b)
    bbox = diff.getbbox()  # None이면 완전 동일

    ca = row_ink_counts(a)
    cb = row_ink_counts(b)

    title_a = first_band(ca)
    title_b = first_band(cb)

    body_a, ink_a = ink_extent_below(ca, (title_a[1] + 4) if title_a else 0)
    body_b, ink_b = ink_extent_below(cb, (title_b[1] + 4) if title_b else 0)

    def h(band):
        return (band[1] - band[0] + 1) if band else None

    result = {
        "image_size": list(a.size),
        "ink_threshold": INK_THRESHOLD,
        "title_band": {"a": title_a, "b": title_b, "identical": title_a == title_b},
        "body_ink_extent": {"a": body_a, "b": body_b},
        "body_glyph_height_px": {"a": h(body_a), "b": h(body_b)},
        "body_ink_pixels": {"a": ink_a, "b": ink_b},
        "body_start_shift_px": (body_b[0] - body_a[0]) if (body_a and body_b) else None,
        "diff_bbox": list(bbox) if bbox else None,
    }
    ha, hb = result["body_glyph_height_px"]["a"], result["body_glyph_height_px"]["b"]
    if ha and hb:
        result["height_diff_px"] = hb - ha
        result["height_ratio"] = round(hb / ha, 3)
    ia, ib = ink_a, ink_b
    if ia and ib:
        result["ink_ratio"] = round(ib / ia, 3)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
