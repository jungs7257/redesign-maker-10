#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""copy_lint 회귀 테스트.

    python qa/test_lint.py

두 가지를 검증한다.
  1) 실제 산출물(규조토 발매트)에서 알려진 결함 9종을 모두 잡아내는가
  2) 교정된 카피(clean_example.json)에서는 P0가 0으로 나오는가 (오탐 없음)
"""

import io
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from qa.copy_lint import lint  # noqa: E402

RULES = os.path.join(HERE, "rules.json")
SAMPLE = os.path.join(HERE, "sample")
ARTIFACT_DIR = os.path.join(os.path.dirname(HERE), "1. 규조토 발매트")

PASS = []
FAIL = []


def check(name, cond, detail=""):
    if cond:
        PASS.append(name)
        print("  PASS  %s" % name)
    else:
        FAIL.append(name)
        print("  FAIL  %s  %s" % (name, detail))


def rules_hit(report):
    return {i["rule"] for i in report["issues"]}


def main():
    print("[1] 실제 산출물 검수 (규조토 발매트)")
    rendered = os.path.join(SAMPLE, "rendered_regulatory_mat.json")
    r = lint(rendered, images_dir=ARTIFACT_DIR if os.path.isdir(ARTIFACT_DIR) else None, rules_path=RULES)
    hit = rules_hit(r)
    expected = {
        "L001": "기획 메모 노출 ('배치 연출', '제품명에 ... 표기')",
        "L003": "오타 (사워→샤워, 발으면→받으면, 안전적인→안전한)",
        "L004": "근거 없는 효과 주장 (순간 흡수, 먼지 최소화)",
        "L006": "소재 이중 주장 (100% + 규조토 + 패브릭)",
        "L007": "비교 대상 오류 ('일반 상세페이지')",
        "L008": "상품정보 고시 섹션 누락",
        "L012": "리뷰 0건인데 '후기' 라벨",
        "L014": "조건절로 끝나는 헤드라인",
        "L023": "섹션 제목 렌더 버그 ('근 규조토...')",
    }
    for rule, desc in expected.items():
        check("%s %s" % (rule, desc), rule in hit, "-> 잡지 못함")
    check("판정이 FAIL", r["verdict"] == "FAIL", r["verdict"])
    check("P0 10건 이상", r["counts"]["P0"] >= 10, str(r["counts"]))

    if os.path.isdir(ARTIFACT_DIR):
        check("이미지 총용량 초과 감지(L021)", "L021" in hit, "이미지 폴더를 못 읽음")

    print("\n[2] 교정 카피 검수 (오탐 확인)")
    clean = lint(os.path.join(SAMPLE, "clean_example.json"), images_dir=None, rules_path=RULES)
    print("      판정=%s counts=%s" % (clean["verdict"], clean["counts"]))
    for i in clean["issues"]:
        print("      - %s %s %s" % (i["rule"], i["section"], i["message"]))
    check("P0 0건", clean["counts"]["P0"] == 0, str(clean["counts"]))
    check("blocked=False", clean["blocked"] is False)

    print("\n[3] md 파서")
    md = os.path.join(ARTIFACT_DIR, "카피.md")
    if os.path.exists(md):
        m = lint(md, rules_path=RULES)
        check("카피.md 파싱 (섹션 8개)", m["sections"] == 8, str(m["sections"]))
        check("md에서도 기획 메모 감지(L001)", "L001" in rules_hit(m))
    else:
        print("  SKIP  카피.md 없음")

    print("\n" + "=" * 50)
    print(" 통과 %d / 실패 %d" % (len(PASS), len(FAIL)))
    print("=" * 50)
    if FAIL:
        print("실패 목록: %s" % ", ".join(FAIL))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
