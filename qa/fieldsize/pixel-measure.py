#!/usr/bin/env python3
"""[검증 2-2] 픽셀 실측 — 헤드리스 크롬으로 렌더한 두 PNG(body 12px vs 20px)에서
실제 잉크(글자) 픽셀을 측정해 크기 차이를 수치로 확인한다. Pillow 사용(설치 없음).

실행: python3 qa/fieldsize/pixel-measure.py
입력: qa/fieldsize/out/body-12px.png, body-20px.png
출력: stdout 요약 + qa/fieldsize/pixel-measure-result.json
"""
import json
from pathlib import Path

from PIL import Image, ImageChops

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
# 안티앨리어싱된 가는 획까지 잉크로 본다(255=흰색). 128로 두면 작은 글자의
# 회색 픽셀이 통째로 사라져 비율이 왜곡된다.
THRESHOLD = 220


def analyze(png_path: Path) -> dict:
    im = Image.open(png_path).convert("L")
    w, h = im.size
    px = im.load()
    rows_with_ink = []
    ink_count = 0
    min_x, max_x, min_y, max_y = w, -1, h, -1
    for y in range(h):
        row_ink = 0
        for x in range(w):
            if px[x, y] < THRESHOLD:
                row_ink += 1
                ink_count += 1
                if x < min_x:
                    min_x = x
                if x > max_x:
                    max_x = x
                if y < min_y:
                    min_y = y
                if y > max_y:
                    max_y = y
        rows_with_ink.append(row_ink > 0)

    # 연속된 잉크 행 = 텍스트 밴드(줄) → 각 줄의 실측 높이
    bands = []
    y = 0
    while y < h:
        if rows_with_ink[y]:
            start = y
            while y < h and rows_with_ink[y]:
                y += 1
            bands.append({"top": start, "bottom": y - 1, "height": y - start})
        else:
            y += 1

    return {
        "file": png_path.name,
        "image": f"{w}x{h}",
        "ink_pixels": ink_count,
        "ink_bbox": None if max_y < 0 else [min_x, min_y, max_x, max_y],
        "ink_bbox_width": None if max_y < 0 else max_x - min_x + 1,
        "ink_bbox_height": None if max_y < 0 else max_y - min_y + 1,
        "text_bands": bands,
    }


def main() -> int:
    a_path = OUT / "body-12px.png"
    b_path = OUT / "body-20px.png"
    A, B = analyze(a_path), analyze(b_path)

    im_a = Image.open(a_path).convert("RGB")
    im_b = Image.open(b_path).convert("RGB")
    if im_a.size != im_b.size:
        # 크기가 다르면 공통 영역만 비교
        w = min(im_a.size[0], im_b.size[0])
        h = min(im_a.size[1], im_b.size[1])
        im_a = im_a.crop((0, 0, w, h))
        im_b = im_b.crop((0, 0, w, h))
    diff = ImageChops.difference(im_a, im_b)
    diff_px = sum(1 for p in diff.getdata() if p != (0, 0, 0))

    ha = A["text_bands"][0]["height"] if A["text_bands"] else 0
    hb = B["text_bands"][0]["height"] if B["text_bands"] else 0
    ratio = round(hb / ha, 3) if ha else None
    width_growth = None
    if A["ink_bbox_width"] and B["ink_bbox_width"]:
        width_growth = B["ink_bbox_width"] - A["ink_bbox_width"]

    result = {
        "A_body_12px": A,
        "B_body_20px": B,
        "diff_pixels_between_images": diff_px,
        "first_band_height_A_px": ha,
        "first_band_height_B_px": hb,
        "height_ratio_B_over_A": ratio,
        "expected_ratio": 20 / 12,
        "ink_bbox_width_growth_px": width_growth,
        "pass": bool(
            A["ink_pixels"] > 0
            and B["ink_pixels"] > 0
            and diff_px > 0
            and ha
            and hb
            and ratio is not None
            and 1.4 <= ratio <= 2.0
        ),
    }

    print(json.dumps(result, indent=1, ensure_ascii=False))
    (HERE / "pixel-measure-result.json").write_text(
        json.dumps(result, indent=1, ensure_ascii=False), encoding="utf-8"
    )
    print("\nPASS" if result["pass"] else "\nFAIL")
    return 0 if result["pass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
