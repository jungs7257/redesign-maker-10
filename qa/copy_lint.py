#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""상세페이지 카피/산출물 사전 검수기 (render-blocking lint).

렌더 단계 앞에서 돌려서, 고객에게 나가면 안 되는 문장과 산출물을 잡아낸다.
표준 라이브러리만 사용한다(설치 필요 없음).

사용 예:
    python qa/copy_lint.py --copy "카피.md" --images-dir "./output"
    python qa/copy_lint.py --copy copy.json --images-dir ./output --strict
    python qa/copy_lint.py --copy copy.json --json-out report.json

종료 코드:
    0  P0 없음 (렌더 진행 가능)
    1  P0 발견 (렌더 중단 권장)
    2  입력 오류

파이프라인 연동:
    from qa.copy_lint import lint, RenderBlocked
    report = lint(copy_dict, images_dir=out_dir, rules_path="qa/rules.json")
    if report["blocked"]:
        raise RenderBlocked(report)
"""

import argparse
import glob
import hashlib
import json
import os
import re
import struct
import sys

try:  # 콘솔에서 한글이 깨지지 않도록
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

SEVERITY_ORDER = {"P0": 0, "P1": 1, "P2": 2}
DEFAULT_RULES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rules.json")


class RenderBlocked(Exception):
    """P0 이슈가 있을 때 파이프라인에서 던지는 예외."""

    def __init__(self, report):
        self.report = report
        super().__init__("copy lint blocked: %d P0 issues" % report.get("counts", {}).get("P0", 0))


# --------------------------------------------------------------------------
# 입력 파싱
# --------------------------------------------------------------------------

def parse_copy_md(text):
    """카피.md 형식 파서.

    ## 1. S1 히어로
    **라벨:** ...
    **대제목:** 줄1 / 줄2 / 줄3
    **설명:** ...
    **핵심 포인트:** - **키워드** 설명
    **아이콘 타일:** a · b · c
    """
    sections = []
    blocks = re.split(r"^##\s+", text, flags=re.M)
    for block in blocks[1:]:
        lines = block.splitlines()
        if not lines:
            continue
        head = lines[0].strip()
        m = re.match(r"(\d+)\.\s*(S\d+)?\s*(.*)", head)
        num = m.group(1) if m else ""
        sid = (m.group(2) or "S%s" % num).strip() if m else ""
        name = (m.group(3) or head).strip() if m else head

        sec = {
            "id": sid,
            "name": name,
            "label": "",
            "headline": [],
            "description": "",
            "points": [],
            "tiles": [],
            # md에는 고객 인사이트/계약 블록이 없다. JSON 입력과 같은 키를 유지해 하위 검사가 KeyError를 내지 않게 한다.
            "customer": {},
            "contract": {},
            "raw": block,
        }
        mode = None
        for line in lines[1:]:
            s = line.strip()
            if s.startswith("**라벨:**"):
                sec["label"] = s.split("**라벨:**", 1)[1].strip()
                mode = None
            elif s.startswith("**대제목:**"):
                sec["headline"].append(s.split("**대제목:**", 1)[1].strip())
                mode = "headline"
            elif s.startswith("**설명:**"):
                sec["description"] = s.split("**설명:**", 1)[1].strip()
                mode = None
            elif s.startswith("**핵심 포인트:**"):
                mode = "points"
            elif s.startswith("**아이콘 타일:**"):
                raw = s.split("**아이콘 타일:**", 1)[1]
                sec["tiles"] = [t.strip() for t in re.split(r"[·・|]", raw) if t.strip()]
                mode = None
            elif mode == "headline" and s:
                sec["headline"].append(s)
            elif mode == "points" and s.startswith("-"):
                item = s.lstrip("- ").strip()
                pm = re.match(r"\*\*(.+?)\*\*\s*(.*)", item)
                if pm:
                    sec["points"].append({"key": pm.group(1).strip(), "text": pm.group(2).strip()})
                else:
                    sec["points"].append({"key": "", "text": item})
        sections.append(sec)
    return sections


def parse_copy_json(data):
    """JSON 입력. {"sections":[...]} 또는 섹션 리스트 그대로."""
    if isinstance(data, dict):
        raw_sections = data.get("sections") or data.get("cards") or []
        meta = data
    else:
        raw_sections = data
        meta = {}
    sections = []
    for i, s in enumerate(raw_sections):
        headline = s.get("headline") or s.get("title") or []
        if isinstance(headline, str):
            headline = [headline]
        points = s.get("points") or []
        norm_points = []
        for p in points:
            if isinstance(p, dict):
                norm_points.append({"key": str(p.get("key") or p.get("title") or ""),
                                    "text": str(p.get("text") or p.get("desc") or p.get("body") or "")})
            else:
                norm_points.append({"key": "", "text": str(p)})
        sections.append({
            "id": s.get("id") or "S%d" % (i + 1),
            "name": s.get("name") or s.get("section") or "",
            "label": s.get("label") or "",
            "headline": [str(h) for h in headline],
            "description": str(s.get("description") or s.get("desc") or ""),
            "points": norm_points,
            "tiles": [str(t) for t in (s.get("tiles") or s.get("icon_tiles") or [])],
            "customer": s.get("customer") if isinstance(s.get("customer"), dict) else {},
            "contract": s.get("contract") if isinstance(s.get("contract"), dict) else {},
        })
    return sections, meta


def load_copy(path):
    with open(path, "r", encoding="utf-8") as f:
        raw = f.read()
    if path.lower().endswith(".json"):
        sections, meta = parse_copy_json(json.loads(raw))
    else:
        sections = parse_copy_md(raw)
        meta = {}
    return sections, meta, raw


# --------------------------------------------------------------------------
# 유틸
# --------------------------------------------------------------------------

def norm(s):
    return re.sub(r"\s+", " ", str(s or "")).strip()


def section_text(sec):
    parts = [sec.get("label", ""), " ".join(sec.get("headline", [])), sec.get("description", "")]
    for p in sec.get("points", []):
        parts.append(p.get("key", ""))
        parts.append(p.get("text", ""))
    parts.extend(sec.get("tiles", []))
    return norm(" ".join(x for x in parts if x))


def bigrams(s):
    s = re.sub(r"[^가-힣a-zA-Z0-9]", "", s)
    return {s[i:i + 2] for i in range(len(s) - 1)}


def jaccard(a, b):
    if not a or not b:
        return 0.0
    return len(a & b) / float(len(a | b))


def image_size(path):
    """PNG/JPEG/WebP/GIF 헤더에서 (w, h)를 읽는다."""
    try:
        with open(path, "rb") as f:
            head = f.read(32)
            if head[:8] == b"\x89PNG\r\n\x1a\n":
                w, h = struct.unpack(">II", head[16:24])
                return int(w), int(h)
            if head[:2] == b"\xff\xd8":
                f.seek(2)
                while True:
                    b = f.read(1)
                    if not b:
                        return None
                    if b != b"\xff":
                        continue
                    marker = f.read(1)
                    while marker == b"\xff":
                        marker = f.read(1)
                    if marker in (b"\xc0", b"\xc1", b"\xc2", b"\xc3"):
                        f.read(3)
                        h, w = struct.unpack(">HH", f.read(4))
                        return int(w), int(h)
                    seg = f.read(2)
                    if len(seg) < 2:
                        return None
                    f.seek(struct.unpack(">H", seg)[0] - 2, 1)
            if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
                if head[12:16] == b"VP8X":
                    w = int.from_bytes(head[24:27], "little") + 1
                    h = int.from_bytes(head[27:30], "little") + 1
                    return w, h
                return None
            if head[:6] in (b"GIF87a", b"GIF89a"):
                w, h = struct.unpack("<HH", head[6:10])
                return int(w), int(h)
    except Exception:
        return None
    return None


# --------------------------------------------------------------------------
# 검사 규칙
# --------------------------------------------------------------------------

def check_planning_notes(sections, rules, issues):
    phrases = rules.get("planning_phrases", [])
    endings = rules.get("planning_word_endings", [])
    for sec in sections:
        targets = [("headline", " ".join(sec["headline"])), ("description", sec["description"])]
        for p in sec["points"]:
            targets.append(("point:%s" % (p.get("key") or "-"), p.get("text", "")))
        for field, text in targets:
            t = norm(text)
            if not t:
                continue
            hit = next((ph for ph in phrases if ph in t), None)
            if hit:
                issues.append({
                    "rule": "L001", "severity": "P0", "section": sec["id"],
                    "quote": t, "field": field,
                    "message": "기획/제작 메모가 고객 카피로 노출됨 ('%s')" % hit,
                    "fix": "고객이 얻는 결과로 다시 쓰세요. 예: '배치 연출' -> '문 앞에 두면 첫 발이 바로 닿습니다'",
                })
                continue
            last = re.sub(r"[.!?。？！]+$", "", t).split()[-1] if t.split() else ""
            if last and any(last.endswith(e) and last != e for e in endings) and len(t) < 40:
                issues.append({
                    "rule": "L002", "severity": "P1", "section": sec["id"],
                    "quote": t, "field": field,
                    "message": "문장이 제작 용어로 끝나 서술어가 없음 ('%s')" % last,
                    "fix": "고객 효익 동사로 끝내세요: ~줄입니다 / ~편합니다 / ~막습니다",
                })


def check_typos(sections, rules, issues):
    typos = rules.get("typos", {})
    for sec in sections:
        for field, text in [("headline", " ".join(sec["headline"])),
                            ("description", sec["description"])] + \
                           [("point:%s" % (p.get("key") or "-"), p.get("text", "")) for p in sec["points"]]:
            t = norm(text)
            for wrong, right in typos.items():
                if wrong in t:
                    issues.append({
                        "rule": "L003", "severity": "P0", "section": sec["id"],
                        "quote": t, "field": field,
                        "message": "오타: '%s' -> '%s'" % (wrong, right),
                        "fix": "'%s'로 교체" % right,
                    })


def check_claims(sections, rules, issues, full_text):
    claims = rules.get("claims", [])
    evidence = rules.get("evidence_markers", [])
    absolutes = rules.get("absolutes", [])
    # 'KC 인증'과 'KC인증'처럼 띄어쓰기만 다른 표기를 같은 근거로 본다.
    evidence_text = re.sub(r"\s+", "", full_text).lower()
    has_evidence = any(re.sub(r"\s+", "", e).lower() in evidence_text for e in evidence)
    for sec in sections:
        targets = [("headline", " ".join(sec["headline"])), ("description", sec["description"])]
        for pt in sec["points"]:
            targets.append(("point:%s" % (pt.get("key") or "-"), pt.get("text", "")))
        for field, text in targets:
            t = norm(text)
            if not t:
                continue
            hits = [c for c in claims if c in t]
            if hits and not has_evidence:
                issues.append({
                    "rule": "L004", "severity": "P0", "section": sec["id"],
                    "quote": t, "field": field,
                    "message": "근거 없는 효과 주장 %d건 (%s) - 문서 내 시험/인증 근거 없음" % (len(hits), ", ".join(hits)),
                    "fix": "성적서·측정 근거를 넣거나 '~편입니다' 서술형으로 완화하세요",
                })
            abs_hits = [a for a in absolutes if a in t]
            if abs_hits:
                issues.append({
                    "rule": "L005", "severity": "P1", "section": sec["id"],
                    "quote": t, "field": field,
                    "message": "절대 표현 (%s) - 근거 없이 쓰면 표시광고 리스크" % ", ".join(abs_hits),
                    "fix": "수치 근거를 명시하거나 '~에 가깝습니다' 수준으로 낮추세요",
                })


def check_material(sections, rules, issues, full_text):
    materials = rules.get("materials", [])
    markers = rules.get("composition_markers", [])
    found = sorted({m for m in materials if m in full_text})
    split = sorted({k for k in markers if k in full_text})
    if "100%" in full_text and len(found) >= 2:
        if split:
            issues.append({
                "rule": "L006", "severity": "P1", "section": "-",
                "quote": "%s + '100%%' (구성 분리 서술: %s)" % (" / ".join(found), ", ".join(split)),
                "field": "document",
                "message": "복수 소재 언급이 있으나 구성별로 나뉘어 있음 - 각 주장이 어느 구성요소인지 명시되어야 함",
                "fix": "예: '속매트는 규조토 100%, 겉커버는 패브릭'처럼 소재를 구성요소에 붙여 쓰세요",
            })
        else:
            issues.append({
                "rule": "L006", "severity": "P0", "section": "-",
                "quote": "%s + '100%%' 동시 사용" % " / ".join(found),
                "field": "document",
                "message": "소재 이중 주장: 100%% 단정과 복수 소재(%s)가 함께 쓰임" % ", ".join(found),
                "fix": "실물 구조를 확인해 하나로 정리하세요. 예: '규조토 성분을 담은 패브릭'",
            })
    if len(found) >= 3:
        issues.append({
            "rule": "L006b", "severity": "P2", "section": "-",
            "quote": " / ".join(found), "field": "document",
            "message": "소재 언급이 %d종 - 독자가 혼동할 수 있음" % len(found),
            "fix": "대표 소재 1개 + 보조 소재 1개로 정리",
        })


def check_negative_comparatives(sections, rules, issues, full_text):
    """L025 - 경쟁 제품 소재/성분을 깎는 비교 주장. 근거 없으면 차단."""
    words = rules.get("negative_comparatives", [])
    evidence = rules.get("evidence_markers", [])
    evidence_text = re.sub(r"\s+", "", full_text).lower()
    has_evidence = any(re.sub(r"\s+", "", e).lower() in evidence_text for e in evidence)
    for sec in sections:
        for field, text in [("headline", " ".join(sec["headline"])), ("description", sec["description"])] + \
                           [("point:%s" % (p.get("key") or "-"), p.get("text", "")) for p in sec["points"]]:
            t = norm(text)
            hits = [w for w in words if w in t]
            if hits and not has_evidence:
                issues.append({
                    "rule": "L025", "severity": "P0", "section": sec["id"],
                    "quote": t, "field": field,
                    "message": "경쟁 제품 소재를 깎는 비교 주장 (%s) - 비교 근거 필요" % ", ".join(hits),
                    "fix": "내 제품 사실만 쓰거나, 비교표/성적서로 근거를 제시하세요. 예: '석고 0%' -> '규조토 성분으로만 만든 속매트'",
                })


def check_comparison(sections, rules, issues):
    bad_targets = rules.get("invalid_comparison_targets", [])
    for sec in sections:
        t = section_text(sec)
        for b in bad_targets:
            if b in t:
                issues.append({
                    "rule": "L007", "severity": "P0", "section": sec["id"],
                    "quote": b, "field": "comparison",
                    "message": "비교 대상이 제품이 아님 ('%s') — 비교광고 요건 불충족" % b,
                    "fix": "비교 대상은 '일반 규조토 매트' 같은 실제 제품 카테고리로 바꾸고, 비교 축을 1개로 고정하세요",
                })


def check_notice(sections, rules, issues, full_text):
    if not any("고시" in section_text(s) or "고시" in s.get("name", "") for s in sections):
        issues.append({
            "rule": "L008", "severity": "P0", "section": "-", "quote": "-", "field": "notice",
            "message": "상품정보 제공고시 섹션이 없음",
            "fix": "재질/크기/제조국/제조자/품질보증/A/S/취급 주의를 담은 표를 추가하세요",
        })
        return
    for f in rules.get("notice_required", []):
        if f not in full_text:
            issues.append({
                "rule": "L008b", "severity": "P1", "section": "notice", "quote": f, "field": "notice",
                "message": "고시 필수 항목 누락: %s" % f, "fix": "고시 표에 '%s' 항목을 추가" % f,
            })
    for bad in rules.get("notice_forbidden", []):
        if bad in full_text:
            issues.append({
                "rule": "L009", "severity": "P0", "section": "notice", "quote": bad, "field": "notice",
                "message": "고시에 '%s'로 비워둔 항목이 있음" % bad,
                "fix": "실제 값으로 채우고, 모르면 '미확인(검수 필요)'로 표기하세요",
            })


def check_shipping(sections, rules, issues, full_text):
    required = rules.get("shipping_required", [])
    has_all = all(r in full_text for r in required)
    if not has_all:
        issues.append({
            "rule": "L010", "severity": "P1", "section": "shipping", "quote": "-", "field": "shipping",
            "message": "배송/교환/반품 실값 누락 (%s)" % ", ".join([r for r in required if r not in full_text]),
            "fix": "배송비·반품비·교환비·신청 기간을 숫자로 적으세요",
        })
    for e in rules.get("shipping_evasion", []):
        if e in full_text:
            issues.append({
                "rule": "L011", "severity": "P1", "section": "shipping", "quote": e, "field": "shipping",
                "message": "조건을 회피하는 문구 ('%s')" % e,
                "fix": "구매 결정을 미루지 말고 실제 조건을 숫자로 제시하세요",
            })


def check_review_label(sections, rules, issues, review_count):
    """L012 - 리뷰 0건에서 후기 표현 사용. 화면에 보이는 문구만 P0, 파일/섹션명만이면 P2."""
    if review_count and review_count > 0:
        return
    labels = rules.get("review_labels", [])
    for sec in sections:
        visible_parts = [sec.get("label", ""), " ".join(sec.get("headline", [])), sec.get("description", "")]
        for p in sec.get("points", []):
            visible_parts.append(p.get("text", ""))
        visible_parts.extend(sec.get("tiles", []))
        visible = norm(" ".join(x for x in visible_parts if x))
        hit_visible = [lab for lab in labels if lab in visible]
        if hit_visible:
            issues.append({
                "rule": "L012", "severity": "P0", "section": sec["id"],
                "quote": ", ".join(hit_visible), "field": "label",
                "message": "리뷰 0건인데 고객에게 '%s' 노출 - 후기로 오인될 수 있음" % ", ".join(hit_visible),
                "fix": "화면 라벨을 '사용 장면' 또는 '이렇게 씁니다'로 변경하세요",
            })
        elif any(lab in (sec.get("name") or "") for lab in labels):
            issues.append({
                "rule": "L012", "severity": "P2", "section": sec["id"],
                "quote": sec.get("name", ""), "field": "section_name",
                "message": "섹션/파일명에만 후기 표현이 있음 (화면 노출 아님, 참고)",
                "fix": "파일명도 '09_사용장면'처럼 맞춰두면 나중에 헷갈리지 않습니다",
            })


def check_headline_shape(sections, rules, issues):
    endings = rules.get("dangling_endings", [])
    max_lines = rules.get("limits", {}).get("max_headline_lines", 4)
    for sec in sections:
        hl = sec["headline"]
        if not hl:
            issues.append({
                "rule": "L013", "severity": "P2", "section": sec["id"], "quote": "-", "field": "headline",
                "message": "헤드라인 없음", "fix": "3줄 이내 헤드라인을 넣으세요",
            })
            continue
        if len(hl) > max_lines:
            issues.append({
                "rule": "L013b", "severity": "P2", "section": sec["id"], "quote": " / ".join(hl),
                "field": "headline", "message": "헤드라인 %d줄 — 모바일에서 잘림" % len(hl),
                "fix": "3줄 이내로 줄이세요",
            })
        last = re.sub(r"[.!?。？！]+$", "", hl[-1].strip())
        if any(last.endswith(e) for e in endings) and len(hl) >= 2:
            issues.append({
                "rule": "L014", "severity": "P1", "section": sec["id"], "quote": " / ".join(hl),
                "field": "headline",
                "message": "헤드라인이 조건절('%s')로 끝나 결론이 없음" % last[-3:],
                "fix": "3번째 줄을 결과 문장으로 닫으세요. 예: '...걱정된다면' -> '...매트 하나로 끝납니다'",
            })


def check_duplicates(sections, rules, issues):
    thr = rules.get("limits", {}).get("duplicate_similarity", 0.62)
    vecs = [(s["id"], bigrams(section_text(s))) for s in sections]
    for i in range(len(vecs)):
        for j in range(i + 1, len(vecs)):
            sim = jaccard(vecs[i][1], vecs[j][1])
            if sim >= thr:
                issues.append({
                    "rule": "L015", "severity": "P1", "section": "%s/%s" % (vecs[i][0], vecs[j][0]),
                    "quote": "유사도 %.2f" % sim, "field": "section",
                    "message": "두 섹션 내용이 %.0f%% 겹침 — 같은 말을 반복하고 있음" % (sim * 100),
                    "fix": "한쪽을 삭제하거나 서로 다른 구매 이유(원단/세탁/사이즈/선물)로 바꾸세요",
                })


def check_tiles(sections, rules, issues):
    thr = rules.get("limits", {}).get("tile_repeat_threshold", 3)
    counter = {}
    for sec in sections:
        sig = tuple(sec["tiles"])
        if sig:
            counter.setdefault(sig, []).append(sec["id"])
    for sig, ids in counter.items():
        if len(ids) >= thr:
            issues.append({
                "rule": "L016", "severity": "P2", "section": ",".join(ids),
                "quote": " · ".join(sig), "field": "tiles",
                "message": "동일한 아이콘 타일 세트가 %d개 섹션에 반복" % len(ids),
                "fix": "섹션마다 다른 정보(소재/세탁/사이즈/사용법)를 배치하세요",
            })


def check_name_repeat(sections, rules, issues, product_name):
    if not product_name:
        return
    tokens = [t for t in re.split(r"\s+", product_name.strip()) if len(t) >= 2]
    dup = {t for t in tokens if tokens.count(t) >= 2}
    if dup:
        issues.append({
            "rule": "L017", "severity": "P1", "section": "product", "quote": product_name,
            "field": "name", "message": "상품명에 같은 단어 반복 (%s)" % ", ".join(sorted(dup)),
            "fix": "중복 단어를 제거하고 핵심 키워드 1개만 남기세요",
        })


def check_price(sections, rules, issues, full_text):
    if "원" not in full_text:
        issues.append({
            "rule": "L018", "severity": "P1", "section": "-", "quote": "-", "field": "price",
            "message": "가격 정보가 없음 — 구매 결정 요소 부재",
            "fix": "판매가와 단가(예: 1개당 7,970원)를 히어로에 넣으세요",
        })


def check_images(images_dir, rules, issues):
    if not images_dir or not os.path.isdir(images_dir):
        return []
    limits = rules.get("limits", {})
    files = sorted([p for p in glob.glob(os.path.join(images_dir, "*"))
                    if os.path.splitext(p)[1].lower() in (".png", ".jpg", ".jpeg", ".webp", ".gif")])
    if not files:
        return []
    total = 0
    hashes = {}
    sizes = []
    for p in files:
        size = os.path.getsize(p)
        total += size
        with open(p, "rb") as f:
            h = hashlib.md5(f.read()).hexdigest()
        dims = image_size(p)
        sizes.append((os.path.basename(p), size, dims))
        if h in hashes:
            issues.append({
                "rule": "L020", "severity": "P2", "section": "-", "quote": os.path.basename(p),
                "field": "image", "message": "동일 이미지 중복 (%s 와 같음)" % hashes[h],
                "fix": "중복 컷을 제거하거나 다른 각도로 교체",
            })
        else:
            hashes[h] = os.path.basename(p)

        mb = size / 1024.0 / 1024.0
        if mb > limits.get("max_image_mb", 1.0):
            issues.append({
                "rule": "L019", "severity": "P1", "section": "-", "quote": os.path.basename(p),
                "field": "image", "message": "이미지 1장 %.2fMB — 상한 %.1fMB 초과" % (mb, limits.get("max_image_mb", 1.0)),
                "fix": "WebP q82로 변환하세요 (보통 1/4 크기)",
            })

    total_mb = total / 1024.0 / 1024.0
    if total_mb > limits.get("max_total_image_mb", 3.0):
        issues.append({
            "rule": "L021", "severity": "P1", "section": "-", "quote": "%d장 %.2fMB" % (len(files), total_mb),
            "field": "image", "message": "산출물 총 용량 %.2fMB — 상한 %.1fMB 초과" % (total_mb, limits.get("max_total_image_mb", 3.0)),
            "fix": "WebP 변환 + 섹션 분할 유지, 3MB 이하로",
        })

    ars = {round(d[0] / float(d[1]), 2) for _, _, d in sizes if d and d[1]}
    if len(ars) > 2:
        issues.append({
            "rule": "L022", "severity": "P2", "section": "-", "quote": ",".join(str(a) for a in sorted(ars)),
            "field": "image", "message": "섹션 이미지 종횡비가 %d가지로 제각각" % len(ars),
            "fix": "한 가지 비율(예: 9:16)로 통일하세요",
        })
    return sizes


def check_render_bug(sec_name, rules, issues, sid):
    for item in rules.get("render_bug_patterns", []):
        try:
            if re.search(item["pattern"], sec_name):
                issues.append({
                    "rule": "L023", "severity": "P0", "section": sid, "quote": sec_name,
                    "field": "section_name", "message": "렌더 버그 의심: %s" % item.get("hint", ""),
                    "fix": "제목 조립부(라벨 + 제목)에서 앞 글자가 붙는지 확인하세요",
                })
        except re.error:
            continue


def check_rendered_text(sections, rules, issues, rendered_text, report_meta):
    """L026 - 렌더된 텍스트와 카피 소스 문장을 대조한다.

    렌더 텍스트에 오타/효과 주장이 새로 생기는 경우가 있으므로,
    렌더 문장 자체에도 L001/L003/L004 규칙을 적용한다.
    """
    if not rendered_text:
        return
    import difflib

    lines = [norm(x) for x in rendered_text.splitlines()
             if norm(x) and not x.strip().startswith("#")]
    # 줄 단위로 검사해야 지적 문장이 그대로 인용된다
    pseudo = [{"id": "RENDER", "name": "렌더 결과", "label": "", "headline": [],
               "description": ln, "points": [], "tiles": []} for ln in lines]
    before = len(issues)
    check_typos(pseudo, rules, issues)
    check_planning_notes(pseudo, rules, issues)
    check_claims(pseudo, rules, issues, norm(rendered_text))
    check_negative_comparatives(pseudo, rules, issues, norm(rendered_text))
    for i in issues[before:]:
        i["field"] = "rendered_text"
        i["message"] = "[렌더 결과] " + i["message"]

    near = rules.get("limits", {}).get("near_miss_ratio", 0.8)
    warn_cov = rules.get("limits", {}).get("render_coverage_warn", 0.6)
    src = []
    for sec in sections:
        src.extend(sec.get("headline", []))
        if sec.get("description"):
            src.append(sec["description"])
        for p in sec.get("points", []):
            if p.get("text"):
                src.append(p["text"])
    src = [norm(x) for x in src if x and len(norm(x)) >= 6]

    matched = 0
    for sentence in src:
        best_ratio, best_line = 0.0, ""
        for ln in lines:
            ratio = difflib.SequenceMatcher(None, sentence, ln).ratio()
            if ratio > best_ratio:
                best_ratio, best_line = ratio, ln
        if best_ratio >= 0.995:
            matched += 1
        elif best_ratio >= near:
            issues.append({
                "rule": "L026", "severity": "P1", "section": "-",
                "quote": "%s  ->  %s" % (sentence, best_line), "field": "rendered_text",
                "message": "렌더에서 문장이 변형됨 (유사도 %.2f) - 카피 원본과 다름" % best_ratio,
                "fix": "렌더 입력이 카피 소스를 그대로 쓰는지 확인하세요 (오타가 렌더 단계에서 생기는 경우가 있음)",
            })
    coverage = (matched / float(len(src))) if src else 0.0
    report_meta["rendered"] = {
        "lines": len(lines), "source_sentences": len(src),
        "matched": matched, "coverage": round(coverage, 3),
    }
    if src and coverage < warn_cov:
        # 부분 덤프일 때는 대조 결과를 신뢰할 수 없으므로 변형 주장을 참고 등급으로 낮춘다
        for i in issues:
            if i["rule"] == "L026":
                i["severity"] = "P2"
                i["message"] = "(부분 덤프) " + i["message"].replace("렌더에서 문장이 변형됨", "문장 대조 불확실")
        issues.append({
            "rule": "L027", "severity": "P2", "section": "-",
            "quote": "커버리지 %.0f%%" % (coverage * 100), "field": "rendered_text",
            "message": "렌더 텍스트에서 원본 문장 %d/%d만 확인됨 - 추출이 일부만 된 상태" % (matched, len(src)),
            "fix": "OCR/텍스트 추출 범위를 넓히거나, 추출본을 전부 넣고 다시 검수하세요",
        })


def check_section_contracts(sections, rules, issues, customer_core, contract_required=False):
    """L028~L034 - 섹션 계약(고객 질문/답/증거/새 정보) 검사.

    말투가 아니라 구조를 본다. 각 섹션이 서로 다른 구매 질문 하나를 맡고,
    같은 답/근거를 반복하지 않는지 확인한다. 계약 필드가 아예 없는 예전 입력은
    contract_required 플래그가 있을 때만 검사해 기존 픽스처를 깨지 않는다.
    """
    cfg = rules.get("contract") or {}
    if not cfg:
        return

    has_contract = any(
        isinstance(s.get("contract"), dict) and bool(s.get("contract")) for s in sections
    )
    if not contract_required and not has_contract and not isinstance(customer_core, dict):
        return

    required_sections = set(cfg.get("required_for_sections") or [])
    required_fields = cfg.get("required_fields") or []
    required_customer_fields = cfg.get("required_customer_fields") or ["pain", "solution", "gain"]
    allowed_focus = set(cfg.get("allowed_focus") or [])
    allowed_proof = set(cfg.get("allowed_proof_types") or [])
    min_diversity = int(cfg.get("min_proof_type_diversity") or 0)
    answer_thr = float(cfg.get("answer_similarity_threshold") or 0.72)
    new_info_thr = float(cfg.get("new_info_similarity_threshold") or 0.8)

    # L032 - 페이지 전체 고객 코어
    if cfg.get("require_customer_core"):
        core = customer_core if isinstance(customer_core, dict) else {}
        missing_core = [
            f for f in (cfg.get("required_customer_core_fields") or [])
            if not norm(core.get(f))
        ]
        if missing_core:
            issues.append({
                "rule": "L032", "severity": "P1", "section": "customer_core",
                "quote": ", ".join(missing_core), "field": "customer_core",
                "message": "페이지 전체 고객 인사이트 누락: %s" % ", ".join(missing_core),
                "fix": "customer_core에 who/pain/solution/gain/objection을 채우세요",
            })

    # L028 - 계약 대상 섹션 자체가 빠졌는지
    present_ids = {sec.get("id") for sec in sections}
    for sid in sorted(required_sections - present_ids):
        issues.append({
            "rule": "L028", "severity": "P1", "section": sid,
            "quote": "섹션 없음", "field": "structure",
            "message": "계약 대상 섹션 누락: %s" % sid,
            "fix": "S1~S9 9개 섹션을 모두 만드세요",
        })

    contracts = []
    for sec in sections:
        sid = sec.get("id") or ""
        if required_sections and sid not in required_sections:
            continue
        contract = sec.get("contract") if isinstance(sec.get("contract"), dict) else {}
        customer = sec.get("customer") if isinstance(sec.get("customer"), dict) else {}
        contracts.append((sid, contract))

        missing = [f for f in required_fields if not norm(contract.get(f))]
        focus = norm(contract.get("focus"))
        proof_type = norm(contract.get("proof_type"))
        if focus and allowed_focus and focus not in allowed_focus:
            missing.append("focus(%s)" % focus)
        if proof_type and allowed_proof and proof_type not in allowed_proof:
            missing.append("proof_type(%s)" % proof_type)
        if missing:
            issues.append({
                "rule": "L028", "severity": "P1", "section": sid,
                "quote": ", ".join(missing), "field": "contract",
                "message": "섹션 계약 누락/잘못된 값: %s" % ", ".join(missing),
                "fix": "buyer_question/focus/one_sentence_answer/proof_type을 섹션 계약 표에 맞게 채우세요",
            })

        missing_customer = [f for f in required_customer_fields if not norm(customer.get(f))]
        if missing_customer:
            issues.append({
                "rule": "L033", "severity": "P1", "section": sid,
                "quote": ", ".join(missing_customer), "field": "customer",
                "message": "이 섹션의 고객 불편/해결/이득 메모 누락: %s" % ", ".join(missing_customer),
                "fix": "customer.pain/solution/gain을 채우세요. 카피에는 focus에 해당하는 것만 드러냅니다",
            })

        if not norm(contract.get("new_information")):
            issues.append({
                "rule": "L034", "severity": "P2", "section": sid,
                "quote": "-", "field": "contract.new_information",
                "message": "이 섹션에서 새로 말하는 정보가 비어 있음",
                "fix": "앞 섹션에 없던 사실/장면/근거 하나를 적으세요",
            })

    # L029 - 한 문장 답이 여러 섹션에서 반복
    answers = [(sid, norm(c.get("one_sentence_answer"))) for sid, c in contracts]
    answers = [(sid, answer) for sid, answer in answers if len(answer) >= 6]
    for i in range(len(answers)):
        for j in range(i + 1, len(answers)):
            sim = jaccard(bigrams(answers[i][1]), bigrams(answers[j][1]))
            if sim >= answer_thr:
                issues.append({
                    "rule": "L029", "severity": "P1",
                    "section": "%s/%s" % (answers[i][0], answers[j][0]),
                    "quote": "유사도 %.2f" % sim, "field": "contract.one_sentence_answer",
                    "message": "두 섹션의 한 문장 답이 %.0f%% 겹침 — 같은 주장을 반복" % (sim * 100),
                    "fix": "한쪽을 그 섹션만의 답으로 바꾸세요",
                })

    # L030 - 증거 유형 다양성
    proof_types = {norm(c.get("proof_type")) for _, c in contracts if norm(c.get("proof_type"))}
    if min_diversity and len(proof_types) < min_diversity:
        issues.append({
            "rule": "L030", "severity": "P1", "section": "-",
            "quote": ", ".join(sorted(proof_types)), "field": "contract.proof_type",
            "message": "증거 유형이 %d종뿐 — 섹션 역할이 겹침 (최소 %d종)" % (len(proof_types), min_diversity),
            "fix": "섹션마다 다른 proof_type을 쓰세요. 예: pain_scene/mechanism/objective_evidence/usage_step/human_experience/policy",
        })

    # L031 - 같은 proof_ref 재사용
    refs = {}
    for sid, contract in contracts:
        ref = norm(contract.get("proof_ref"))
        if ref:
            refs.setdefault(ref, []).append(sid)
    for ref, ids in refs.items():
        if len(ids) >= 2:
            issues.append({
                "rule": "L031", "severity": "P1", "section": ",".join(ids),
                "quote": ref, "field": "contract.proof_ref",
                "message": "같은 근거를 여러 섹션에서 재사용 (%s)" % ", ".join(ids),
                "fix": "섹션마다 다른 근거를 쓰거나, 같은 근거는 한 번만 쓰세요",
            })

    # L034b - 새 정보가 다른 섹션과 유사
    infos = [(sid, norm(c.get("new_information"))) for sid, c in contracts]
    infos = [(sid, info) for sid, info in infos if len(info) >= 6]
    for i in range(len(infos)):
        for j in range(i + 1, len(infos)):
            sim = jaccard(bigrams(infos[i][1]), bigrams(infos[j][1]))
            if sim >= new_info_thr:
                issues.append({
                    "rule": "L034b", "severity": "P2",
                    "section": "%s/%s" % (infos[i][0], infos[j][0]),
                    "quote": "유사도 %.2f" % sim, "field": "contract.new_information",
                    "message": "두 섹션의 새 정보가 %.0f%% 겹침 — 같은 내용을 반복" % (sim * 100),
                    "fix": "한쪽은 다른 사실/장면/근거로 바꾸세요",
                })


def check_required_sections(sections, rules, issues):
    names = " ".join(s.get("name", "") + " " + section_text(s) for s in sections)
    for key, label in rules.get("required_sections", {}).items():
        if label.split("/")[0] not in names:
            issues.append({
                "rule": "L024", "severity": "P0" if key in ("notice",) else "P1", "section": key,
                "quote": label, "field": "structure",
                "message": "필수 섹션 누락: %s" % label,
                "fix": "'%s' 섹션을 추가하세요" % label,
            })


# --------------------------------------------------------------------------
# 메인
# --------------------------------------------------------------------------

def lint(copy_input, images_dir=None, rules_path=None, product_name=None, review_count=0, rendered_text=None):
    """copy_input: 섹션 리스트 또는 {"sections":[...]} 또는 파일 경로."""
    rules = json.load(open(rules_path or DEFAULT_RULES, "r", encoding="utf-8"))

    if isinstance(copy_input, str):
        sections, meta, raw = load_copy(copy_input)
    elif isinstance(copy_input, list):
        sections, meta = parse_copy_json(copy_input)
        raw = json.dumps(copy_input, ensure_ascii=False)
    else:
        sections, meta = parse_copy_json(copy_input)
        raw = json.dumps(copy_input, ensure_ascii=False)

    product_name = product_name or meta.get("product_name") or ""
    review_count = review_count or meta.get("review_count") or 0

    full_text = norm(" ".join(section_text(s) for s in sections) + " " + " ".join(s.get("name", "") for s in sections))
    issues = []

    check_required_sections(sections, rules, issues)
    check_section_contracts(
        sections, rules, issues,
        meta.get("customer_core"),
        bool(meta.get("_contract_required")),
    )
    check_planning_notes(sections, rules, issues)
    check_typos(sections, rules, issues)
    check_claims(sections, rules, issues, full_text)
    check_negative_comparatives(sections, rules, issues, full_text)
    check_material(sections, rules, issues, full_text)
    check_comparison(sections, rules, issues)
    check_notice(sections, rules, issues, full_text)
    check_shipping(sections, rules, issues, full_text)
    check_review_label(sections, rules, issues, review_count)
    check_headline_shape(sections, rules, issues)
    check_duplicates(sections, rules, issues)
    check_tiles(sections, rules, issues)
    check_name_repeat(sections, rules, issues, product_name)
    check_price(sections, rules, issues, full_text)
    images = check_images(images_dir, rules, issues)
    for sec in sections:
        check_render_bug(sec.get("name", ""), rules, issues, sec["id"])

    meta_out = {}
    check_rendered_text(sections, rules, issues, rendered_text, meta_out)

    # 같은 문장이 카피 원본과 렌더 결과에서 모두 잡히면 원본 쪽만 남긴다(수정 대상이 원본이므로)
    src_keys = {(i["rule"], i["quote"]) for i in issues if i["section"] != "RENDER"}
    issues = [i for i in issues
              if not (i["section"] == "RENDER" and (i["rule"], i["quote"]) in src_keys)]

    issues.sort(key=lambda i: (SEVERITY_ORDER.get(i["severity"], 9), i["rule"], str(i["section"])))

    counts = {"P0": 0, "P1": 0, "P2": 0}
    for i in issues:
        counts[i["severity"]] = counts.get(i["severity"], 0) + 1

    return {
        "version": rules.get("version"),
        "sections": len(sections),
        "images": len(images),
        "image_total_mb": round(sum(s[1] for s in images) / 1024.0 / 1024.0, 2) if images else 0,
        "counts": counts,
        "blocked": counts.get("P0", 0) > 0,
        "verdict": "FAIL" if counts.get("P0", 0) > 0 else ("WARN" if counts.get("P1", 0) > 0 else "PASS"),
        "rendered": meta_out.get("rendered"),
        "issues": issues,
    }


def print_report(report, show_all=True):
    print("=" * 68)
    print(" 상세페이지 카피 검수 결과")
    print("=" * 68)
    print(" 섹션 %d개 · 이미지 %d장 (%.2fMB)" % (report["sections"], report["images"], report["image_total_mb"]))
    if report.get("rendered"):
        rd = report["rendered"]
        print(" 렌더 텍스트 대조: 문장 %d/%d 일치 (커버리지 %.0f%%)" % (rd["matched"], rd["source_sentences"], rd["coverage"] * 100))
    c = report["counts"]
    print(" P0 %d건 · P1 %d건 · P2 %d건" % (c.get("P0", 0), c.get("P1", 0), c.get("P2", 0)))
    print("-" * 68)
    cur = None
    for i in report["issues"]:
        if i["severity"] != cur:
            cur = i["severity"]
            print("\n[%s]" % cur)
        print(" - %s %-10s %s" % (i["rule"], i["section"], i["message"]))
        q = i.get("quote") or ""
        if q and q != "-":
            print("     문장: %s" % (q if len(q) <= 70 else q[:70] + "..."))
        if i.get("fix"):
            print("     수정: %s" % i["fix"])
    if not report["issues"]:
        print(" 지적 사항 없음")
    print("-" * 68)
    print(" 판정: %s%s" % (report["verdict"],
                          "  (P0 %d건 — 렌더 중단 권장)" % c["P0"] if report["blocked"] else ""))
    print("=" * 68)


def main(argv=None):
    ap = argparse.ArgumentParser(description="상세페이지 카피/산출물 사전 검수기")
    ap.add_argument("--copy", required=True, help="카피.md 또는 copy.json")
    ap.add_argument("--images-dir", default=None, help="렌더된 섹션 이미지 폴더")
    ap.add_argument("--rules", default=None, help="rules.json 경로")
    ap.add_argument("--product-name", default=None)
    ap.add_argument("--review-count", type=int, default=0)
    ap.add_argument("--rendered-text", default=None, help="렌더된 텍스트 덤프(줄바꿈 구분) - 있으면 렌더 검수까지 수행")
    ap.add_argument("--json-out", default=None)
    ap.add_argument("--strict", action="store_true", help="P0이면 exit 1")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args(argv)

    if not os.path.exists(args.copy):
        print("입력 파일을 찾을 수 없습니다: %s" % args.copy, file=sys.stderr)
        return 2
    rendered = None
    if args.rendered_text:
        if not os.path.exists(args.rendered_text):
            print("렌더 텍스트 파일을 찾을 수 없습니다: %s" % args.rendered_text, file=sys.stderr)
            return 2
        with open(args.rendered_text, "r", encoding="utf-8") as f:
            rendered = f.read()
    report = lint(args.copy, args.images_dir, args.rules, args.product_name, args.review_count, rendered)
    if not args.quiet:
        print_report(report)
    if args.json_out:
        with open(args.json_out, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        print("리포트 저장: %s" % args.json_out)
    if args.strict and report["blocked"]:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
