#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""copy_lint 회귀 테스트 (v1.2).

    python qa/test_lint.py

검증 항목
  [1] 실제 산출물 v1(규조토 발매트 1차) - 결함 전부 감지
  [2] 교정 카피 - 오탐 없음(P0 0)
  [3] md 파서
  [4] v1.1 신규 - 렌더 텍스트 대조 / 오탐 완화 / 부정 비교 / 기획 메모 확장
  [5] 버전
  [6] v1.2 신규 - 고객 불편→해결→이득 / 섹션 계약(L028~L034)
"""

import io
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

from qa.copy_lint import lint  # noqa: E402

RULES = os.path.join(HERE, "rules.json")
SAMPLE = os.path.join(HERE, "sample")
ARTIFACT_DIR = os.path.join(ROOT, "1. 규조토 발매트")

PASS, FAIL = [], []


def check(name, cond, detail=""):
    if cond:
        PASS.append(name)
        print("  PASS  %s" % name)
    else:
        FAIL.append(name)
        print("  FAIL  %s  %s" % (name, detail))


def rules_of(report):
    return {i["rule"] for i in report["issues"]}


def sev(report, rule):
    return {i["severity"] for i in report["issues"] if i["rule"] == rule}


def main():
    print("[1] 실제 산출물 v1 검수 (규조토 발매트 1차)")
    r = lint(os.path.join(SAMPLE, "rendered_regulatory_mat.json"),
             images_dir=ARTIFACT_DIR if os.path.isdir(ARTIFACT_DIR) else None,
             rules_path=RULES)
    hit = rules_of(r)
    expected = {
        "L001": "기획 메모 노출",
        "L003": "오타 (사워/발으면/안전적인)",
        "L004": "근거 없는 효과 주장",
        "L006": "소재 이중 주장",
        "L007": "비교 대상 오류 ('일반 상세페이지')",
        "L008": "고시 섹션 누락",
        "L014": "조건절로 끝나는 헤드라인",
        "L023": "섹션 제목 렌더 버그",
    }
    for rule, desc in expected.items():
        check("%s %s" % (rule, desc), rule in hit, "-> 잡지 못함")
    check("판정이 FAIL", r["verdict"] == "FAIL", r["verdict"])
    check("P0 10건 이상", r["counts"]["P0"] >= 10, str(r["counts"]))
    if os.path.isdir(ARTIFACT_DIR):
        check("이미지 총용량 초과 감지(L021)", "L021" in hit)
    check("L006은 P0 유지 (분리 서술 없음)", sev(r, "L006") == {"P0"}, str(sev(r, "L006")))

    print("\n[2] 교정 카피 검수 (오탐 확인)")
    clean = lint(os.path.join(SAMPLE, "clean_example.json"), rules_path=RULES)
    for i in clean["issues"]:
        print("      - %s %s %s" % (i["rule"], i["section"], i["message"]))
    check("P0 0건", clean["counts"]["P0"] == 0, str(clean["counts"]))
    check("blocked=False", clean["blocked"] is False)

    print("\n[3] md 파서")
    md = os.path.join(ARTIFACT_DIR, "카피.md")
    if os.path.exists(md):
        m = lint(md, rules_path=RULES)
        check("카피.md 파싱 (섹션 8개)", m["sections"] == 8, str(m["sections"]))
        check("md에서도 기획 메모 감지(L001)", "L001" in rules_of(m))
    else:
        print("  SKIP  카피.md 없음")

    print("\n[4] v1.1 신규 기능")
    v2 = os.path.join(SAMPLE, "copy_regulatory_v2.md")
    rt = os.path.join(SAMPLE, "rendered_text_v2.txt")
    a = lint(v2, rules_path=RULES)
    rt_text = io.open(rt, encoding="utf-8").read()
    b = lint(v2, rules_path=RULES, rendered_text=rt_text)
    hb = rules_of(b)

    check("카피.md 단독으로는 '사워' 오타 미검출", "L003" not in rules_of(a), str(rules_of(a)))
    check("렌더 텍스트 대조 시 L003 검출", "L003" in hb)
    check("L026 렌더 문장 변형 검출", "L026" in hb)
    check("렌더 커버리지 리포트 존재",
          bool(b.get("rendered")) and b["rendered"]["source_sentences"] > 0, str(b.get("rendered")))
    check("L006이 P1로 강등 (구성 분리 서술)", sev(a, "L006") == {"P1"}, str(sev(a, "L006")))
    check("L012가 P2로 강등 (섹션명만)", sev(a, "L012") == {"P2"}, str(sev(a, "L012")))
    check("L025 부정 비교('석고 0%') 검출", "L025" in rules_of(a))
    check("L001 '원본에 ... 표기' 검출", "L001" in rules_of(a))
    check("L008 고시 누락 P0 유지", sev(a, "L008") == {"P0"}, str(sev(a, "L008")))

    space_evidence = lint({
        "product_name": "테스트",
        "review_count": 0,
        "sections": [{
            "id": "S1", "name": "히어로", "label": "",
            "headline": ["KC 인증을 확인했습니다"],
            "description": "인증 번호는 본문에 표기", "points": [], "tiles": [],
        }],
    }, rules_path=RULES)
    check("L004 'KC 인증' 띄어쓰기 근거 인정", "L004" not in rules_of(space_evidence), str(rules_of(space_evidence)))

    print("\n[5] 버전")
    check("rules 버전 1.2.0", a.get("version") == "1.2.0", str(a.get("version")))

    print("\n[6] v1.2 섹션 계약 / 고객 불편→해결→이득")

    def contract_section(sid, name, focus, proof_type, answer, new_info, proof_ref,
                         headline, description):
        return {
            "id": sid,
            "name": name,
            "label": "",
            "headline": [headline],
            "description": description,
            "points": [],
            "tiles": [],
            "customer": {
                "pain": "%s에서 겪는 불편" % sid,
                "solution": "%s에서 확인된 해결" % sid,
                "gain": "%s에서 얻는 이득" % sid,
            },
            "contract": {
                "buyer_question": "%s가 답하는 질문" % sid,
                "focus": focus,
                "one_sentence_answer": answer,
                "proof_type": proof_type,
                "proof_ref": proof_ref,
                "new_information": new_info,
                "forbidden": [],
            },
        }

    core = {
        "who": "겨울밤 발이 찬 30대 직장인",
        "pain": "양말 밴드가 조여서 자국과 저림이 생긴다",
        "solution": "넓은 파일 밴드가 압력을 여러 줄로 나눠 받는다",
        "gain": "아침까지 발목이 편안하고 숙면을 방해하지 않는다",
        "objection": "가격과 세탁 편의성",
    }
    good_sections = [
        contract_section("S1", "히어로", "identity", "identity",
                         "나에게 맞는 무압박 수면양말", "타겟 선언", "원본 S1",
                         "겨울밤 발목을 조이지 않는 양말", "무압박 밴드로 편안하게 신는 수면양말 5,170원"),
        contract_section("S2", "문제 공감", "pain", "pain_scene",
                         "밤마다 양말 자국과 저림이 남는다", "밴드가 조이는 불편 장면", "원본 S2",
                         "양말 자국이 남는 밤", "밴드가 조여서 자국과 저림이 생기는 상황"),
        contract_section("S3", "생활 변화", "gain", "life_outcome",
                         "아침까지 발목이 편안하다", "아침까지 편안한 생활 변화", "원본 S3",
                         "아침까지 발목이 편안", "밤새 압박이 적어 숙면을 돕는 생활 변화"),
        contract_section("S4", "해결 방식", "solution", "mechanism",
                         "넓은 파일 밴드가 압력을 나눠 받는다", "구조 설명", "원본 S4",
                         "넓은 파일 밴드의 힘", "압력을 여러 줄로 나눠 받는 편직 구조"),
        contract_section("S5", "근거/신뢰", "proof", "objective_evidence",
                         "라벨과 봉제선에서 소재를 확인했다", "근거", "원본 S5",
                         "봉제와 소재를 확인", "제품 라벨과 봉제선에서 확인되는 사실만 적습니다"),
        contract_section("S6", "사용법", "ease", "usage_step",
                         "찬물에 단독 세탁하고 그늘에서 말린다", "사용법", "원본 S6",
                         "찬물에 단독 세탁", "30도 이하 중성세제로 세탁하고 그늘에서 건조"),
        contract_section("S7", "사용 장면", "trust", "human_experience",
                         "써보니 발목이 편했다는 장면", "사용감", "원본 S7",
                         "써본 사람의 한마디", "사용 장면에서 확인된 편안함에 대한 문장"),
        contract_section("S8", "배송·교환·반품", "risk", "policy",
                         "배송비와 반품비를 미리 확인한다", "배송 조건", "원본 S8",
                         "배송비와 반품비 안내", "배송비 3,000원 / 반품비 3,000원 / 교환비 6,000원 / 7일 이내"),
        contract_section("S9", "상품정보 고시", "legal", "legal",
                         "품명과 재질을 표로 표시한다", "고시", "원본 S9",
                         "구매 전 확인하는 고시", "품명 수면양말 / 재질 폴리에스터 / 크기 39cm / 제조국 중국 / 제조자 펀타스틱 / 품질보증 7일 / A/S 070-0000-0000 / 취급 찬물 세탁"),
    ]

    base_payload = {
        "_contract_required": True,
        "customer_core": core,
        "product_name": "수면양말",
        "review_count": 0,
        "sections": good_sections,
    }
    good = lint(base_payload, rules_path=RULES)
    check("계약 샘플 P0 0건", good["counts"]["P0"] == 0, str(good["counts"]))
    for rule in ("L028", "L029", "L030", "L031", "L032", "L033", "L034"):
        check("%s 계약 샘플 오탐 없음" % rule, rule not in rules_of(good), str(rules_of(good)))

    missing_contract = [dict(section) for section in good_sections]
    missing_contract[1] = {**missing_contract[1], "contract": {}, "customer": {}}
    r = lint({**base_payload, "sections": missing_contract}, rules_path=RULES)
    check("L028 계약 누락 검출", "L028" in rules_of(r), str(rules_of(r)))
    check("L033 고객 메모 누락 검출", "L033" in rules_of(r), str(rules_of(r)))

    missing_section = [dict(section) for section in good_sections if section["id"] != "S9"]
    r = lint({**base_payload, "sections": missing_section}, rules_path=RULES)
    check("L028 누락 섹션 검출", "L028" in rules_of(r), str(rules_of(r)))

    duplicate_answer = [dict(section) for section in good_sections]
    duplicate_answer[2] = {
        **duplicate_answer[2],
        "contract": {
            **duplicate_answer[2]["contract"],
            "one_sentence_answer": duplicate_answer[1]["contract"]["one_sentence_answer"],
        },
    }
    r = lint({**base_payload, "sections": duplicate_answer}, rules_path=RULES)
    check("L029 한 문장 답 반복 검출", "L029" in rules_of(r), str(rules_of(r)))

    low_diversity = [dict(section) for section in good_sections]
    for index in range(1, len(low_diversity)):
        low_diversity[index] = {
            **low_diversity[index],
            "contract": {**low_diversity[index]["contract"], "proof_type": "pain_scene"},
        }
    r = lint({**base_payload, "sections": low_diversity}, rules_path=RULES)
    check("L030 증거 유형 다양성 부족 검출", "L030" in rules_of(r), str(rules_of(r)))

    reused_ref = [dict(section) for section in good_sections]
    reused_ref[2] = {
        **reused_ref[2],
        "contract": {**reused_ref[2]["contract"], "proof_ref": reused_ref[1]["contract"]["proof_ref"]},
    }
    r = lint({**base_payload, "sections": reused_ref}, rules_path=RULES)
    check("L031 같은 근거 재사용 검출", "L031" in rules_of(r), str(rules_of(r)))

    r = lint({k: v for k, v in base_payload.items() if k != "customer_core"}, rules_path=RULES)
    check("L032 고객 코어 누락 검출", "L032" in rules_of(r), str(rules_of(r)))

    empty_info = [dict(section) for section in good_sections]
    empty_info[1] = {
        **empty_info[1],
        "contract": {**empty_info[1]["contract"], "new_information": ""},
    }
    r = lint({**base_payload, "sections": empty_info}, rules_path=RULES)
    check("L034 새 정보 빈 값 검출", "L034" in rules_of(r), str(rules_of(r)))

    duplicate_info = [dict(section) for section in good_sections]
    duplicate_info[2] = {
        **duplicate_info[2],
        "contract": {**duplicate_info[2]["contract"], "new_information": duplicate_info[1]["contract"]["new_information"]},
    }
    r = lint({**base_payload, "sections": duplicate_info}, rules_path=RULES)
    check("L034b 새 정보 반복 검출", "L034b" in rules_of(r), str(rules_of(r)))

    print("\n" + "=" * 52)
    print(" 통과 %d / 실패 %d" % (len(PASS), len(FAIL)))
    print("=" * 52)
    if FAIL:
        print("실패 목록: %s" % ", ".join(FAIL))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
