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
    has_evidence = any(e.lower() in full_text.lower() for e in evidence)
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
    found = sorted({m for m in materials if m in full_text})
    if "100%" in full_text and len(found) >= 2:
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
            "message": "소재 언급이 %d종 — 독자가 혼동할 수 있음" % len(found),
            "fix": "대표 소재 1개 + 보조 소재 1개로 정리",
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
    if review_count and review_count > 0:
        return
    for sec in sections:
        t = section_text(sec) + " " + sec.get("name", "")
        for lab in rules.get("review_labels", []):
            if lab in t:
                issues.append({
                    "rule": "L012", "severity": "P0", "section": sec["id"], "quote": lab, "field": "label",
                    "message": "리뷰 0건인데 '%s' 라벨 사용 — 후기로 오인될 수 있음" % lab,
                    "fix": "라벨을 '사용 장면' 또는 '이렇게 씁니다'로 변경하세요",
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

def lint(copy_input, images_dir=None, rules_path=None, product_name=None, review_count=0):
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
    check_planning_notes(sections, rules, issues)
    check_typos(sections, rules, issues)
    check_claims(sections, rules, issues, full_text)
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
        "issues": issues,
    }


def print_report(report, show_all=True):
    print("=" * 68)
    print(" 상세페이지 카피 검수 결과")
    print("=" * 68)
    print(" 섹션 %d개 · 이미지 %d장 (%.2fMB)" % (report["sections"], report["images"], report["image_total_mb"]))
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
    ap.add_argument("--json-out", default=None)
    ap.add_argument("--strict", action="store_true", help="P0이면 exit 1")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args(argv)

    if not os.path.exists(args.copy):
        print("입력 파일을 찾을 수 없습니다: %s" % args.copy, file=sys.stderr)
        return 2
    report = lint(args.copy, args.images_dir, args.rules, args.product_name, args.review_count)
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
