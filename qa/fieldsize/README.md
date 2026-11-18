# 필드 단위 글자 크기 + 배지 3칸 분리 검증 (qa/fieldsize)

작업1(개별 텍스트 칸 단위 글자 크기 — `Section.fieldSizes`)과 작업2(히어로 배지
3칸 분리 + 문자열 배지 마이그레이션)의 검증 스크립트 모음.

기준선: `baseline-detail-html.orig.ts` — 변경 전 `src/lib/detail-html.ts` 스냅샷.
바이트 동일성 검사는 이 기준선과 현행 구현의 `buildHtml` 출력을 직접 비교한다.

## 스크립트

| 스크립트 | 검증 내용 | 실행 |
|---|---|---|
| `verify.mjs` | 단위검증 67건 — 바이트 동일성(fieldSizes 없는 문서), 배지 문자열→3칸 분리 마이그레이션, fieldSizes 정규화, 필드 크기 수학(배율 공식), 빈 칸 인덱스 회귀, PNG 래퍼 구조 | `node qa/fieldsize/verify.mjs` |
| `pixel-test.mjs` + `measure.py` | 픽셀 실측 — problem 본문 12px vs 20px 두 buildHtml 파일을 헤드리스 크로뮴 렌더 후 PIL로 글리프 높이 측정 | `node qa/fieldsize/pixel-test.mjs` |
| `png-codepath.mjs` | PNG 내보내기 코드경로 회귀 — 실제 브라우저 DOM에서 `buildHtml(wrapSections=true)` → `prepareCaptureImages` → `waitForStableHeight` → `planSlices` → `capturePngSlices` 실행(toPng만 가짜 대체) | `node qa/fieldsize/png-codepath.mjs` |
| `api-migration-check.mjs` | 서버(/api/detail-data) 데이터의 migrateDoc 전/후 비교. 차이 있을 때만 PUT으로 반영 | `node qa/fieldsize/api-migration-check.mjs` |

의존성: node 24(내장 TS 타입 스트리핑), python3 + Pillow, 헤드리스 크로뮴/크롬,
typescript(devDep, `png-codepath.mjs`의 tsc 컴파일만). 프로젝트 의존성 추가 없음.

## 결과 요약 (2026-11-17)

1. **단위검증 67/67 통과**
   - 바이트 동일성: 실제 저장 데이터(fieldSizes 제거 사본)·합성 문서(8종
     템플릿+레거시 5종) 모두 기본 호출/PNG 래퍼 호출에서 변경 전과 바이트 동일.
   - 배지 마이그레이션: `"A · B · C"` → `["A","B","C"]`, 값 1개 → 빈칸 패딩,
     3칸 초과 보존, 기존 배열 무변경, 문자열 배지 렌더 == 배열 배지 렌더.
   - 필드 크기 수학: `(섹션배율) × (필드px/섹션실효px)` — 예) problem body
     20px → 11.67pt, 섹션 fontSize와 상쇄 확인, 8~72 클램프.
2. **픽셀 실측**: 본문 글리프 높이 12px 문서 **9px** / 20px 문서 **16px**
   (차 +7px, 비율 1.78). 제목 밴드는 두 문서에서 동일(26–56행) — 본문 칸만 변함.
   차분 bbox (288,123)–(493,139)로 본문 영역에 국한.
3. **PNG 코드경로**: 6섹션 → 래퍼 6개 → planSumEqualsTotal=true, 조각 생성
   에러 0건, 필드 크기(11.67pt/18pt) 캡처 HTML 반영, validateHtml 경고 0건.
4. **API 마이그레이션**: 실서버 데이터는 이미 마이그레이션된 형태 — 전/후
   JSON 동일, PUT 없이 종료(서버 데이터 미변경).
5. **빌드/서버**: `npm run build` 성공, systemd 유저 서비스
   `redesign-maker.service`(기존 실행 방식, `systemctl --user restart`)로 재시작 후
   `GET /redesign/15` → 200. (병렬 작업 세션이 만든 `qa/fieldsize/run-checks.mjs`
   등 자체 검증 스크립트도 최종 소스에서 29/29 통과 — 교차 확인)

## 산출물 (out/)

- `verify-report.json`, `png-codepath-report.json`, `pixel-measure.json` — 측정 리포트
- `data-snapshot.json` — 검사 시점의 서버 저장 데이터 스냅샷
- `pixel-12.html` / `pixel-20.html` / `pixel-12.png` / `pixel-20.png` — 실측 표본

## 주의

- `verify.mjs`는 살아있는 `data/detail-builder.json`을 읽는 시점에 fieldSizes가
  들어 있을 수 있어, 바이트 동일성 검사 대상 사본에서는 fieldSizes만 떼고 검사한다.
- `png-codepath.mjs`는 `--virtual-time-budget` 환경에서 rAF가 2프레임만 발생하는
  헤드리스 제약 때문에 **테스트 페이지에서만** rAF를 타이머로 교체한다
  (프로덕션 `png-slices.ts`는 무변경). 또한 앱 환경과 동일한 `p { margin: 0 }`
  프리플라이트를 맞춰 섹션 높이 합 = 전체 높이가 성립하게 한다.
