# 작업 완료 보고 — 필드 단위 글자 크기 + 배지 3칸 분리 (2026-11-17)

## 변경 요약

### 작업 1 — 글자 크기 조절을 개별 텍스트 칸 단위로 확장
- `Section`에 `fieldSizes?: Record<string, number>` 추가(마이그레이션 기본값 = 필드 없음).
- 렌더 수식: `SP pt = 기본pt × fontScale(섹션배율) × (필드px / 섹션실효px)`.
  값이 없으면 배율 1 → 기존 출력과 바이트 단위 동일.
- 필드 키: hero `title/sub/badge0~2/notice`, problem·change·howto `title/body`,
  usp·review `title/item0~`, evidence `title/w/d/h/weight/colors/material`,
  notice(표) `caption/row{n}k/row{n}v`, notice(문구) `title/fee/island/leadTime/asPeriod/asTerms/lines`,
  detail `caption0/caption1`.
- 배지/치수는 개별 크기 지정이 있을 때만 값마다 별도 span(없으면 기존 한 덩어리 span 그대로).
- `detail-builder.tsx`: `FieldSizeControl`(FontSizeControl의 필드 단위 일반화, ▼ 숫자입력 ▲ ↺,
  8~72px, 비우면 섹션 기본 상속)를 모든 텍스트 입력칸에 부착. textarea는 라벨 줄 오른쪽.

### 작업 2 — 히어로 배지 3칸 분리 + 마이그레이션
- 편집 폼: "배지 1/2/3" 개별 라벨 독립 칸 + 칸마다 크기 조절기.
- 출력: 한 줄 `·` 구분 유지(개별 크기 지정 시에도 같은 줄).
- `migrateSection`: badges가 문자열이면 `·` 기준 분리(trim, 3칸 미만이면 빈칸 padding,
  3칸 초과면 전부 유지). 배열이면 그대로.

## 마이그레이션 결과 (전/후 비교)
- 실서버 데이터(10섹션): 이미 정규화 상태 → 마이그레이션 후 필드 추가 0건,
  hero badges 전/후 동일(`["ㅓㅏㅓㅏㅇㅁㄹㅇㅁㅓㅏㅇㄹㅇㄹ","ㅇㄻㅇㄻㅇㄻ","ㅇㄹㅇㅇㄻ"]`),
  buildHtml 7,269B 동일. API PUT 라운드트립 후 파일 바이트 동일.
- 레거시 케이스(run-checks): `"A · B · C"→["A","B","C"]`, `"A·B·C"→["A","B","C"]`,
  `"A · B · C · D"→4칸 유지`, `"하나뿐인 배지"→["하나뿐인 배지","",""]`, `""→["","",""]`,
  배열 유지·멱등(2회 적용 동일). 마이그레이션 전후 렌더 바이트 동일.

## 검증 수치
- 바이트 동일성(변경 전 코드 스냅샷 대비): corpus 4문서+defaultDoc의
  html/wrapped/migrate/idempotent 전부 `=` (7,269B / 6,846B / 7,895B / 0B) — run-checks 29/29 PASS.
- 픽셀 실측(헤드리스 크롬 + Pillow, problem 본문 12px→20px):
  - A(12px→7pt≈9.33px): 잉크 bbox 126×8px, 잉크 386px, 첫 텍스트 밴드 높이 8px
  - B(20px→11.67pt≈15.56px): 잉크 bbox 211×13px, 잉크 933px, 밴드 높이 13px
  - 높이 비율 13/8 = **1.625** (이론치 20/12 = 1.667, 반올림/안티앨리어싱 오차), 폭 +85px, 이미지 diff 1,561px
- PNG 코드 경로(실제 크롬에서 planSlices/capturePngSlices, toPng 목업):
  plans 1 / slices 1 / totalHeight 1330 = heightSum / 섹션 [0,1,2,3] / dataUrl 정상 /
  필드 크기(18pt·11.67pt) 캡처 DOM 반영 — PASS.
- UI 라이브(CDP): 배지 1/2/3 라벨 ✓, 필드 크기 조절기 54개 ✓, 미리보기 `·` 배지 라인 ✓,
  서버 데이터 10섹션 로드 ✓.
- `npm run build` 성공. systemd `redesign-maker.service` 재시작(기존 실행 방식과 동일).
  `GET /redesign/15` 200, `GET /` 307(redirect), `GET /redesign/15/api/detail-data` 200.

## 회귀 여부
- 없음. API 라우트(src/app/api/**)·redesign-wizard.tsx·package.json 미변경,
  localStorage 정책(백업 전용) 미변경, png-slices.ts 미변경,
  fieldSizes 없는 문서 출력은 바이트 단위로 기존과 동일.

## 변경 파일
- `src/lib/detail-html.ts` — fieldSizes 타입·fieldSize/fieldScale·렌더 szf 적용·배지 마이그레이션
- `src/components/detail-builder.tsx` — FieldSizeControl·patchFieldSize·입력칸별 조절기·배지 3칸 폼
- `qa/fieldsize/` (신규 검증): make-baseline.mjs, corpus.json, baseline-detail-html.orig.ts(변경 전 스냅샷),
  baseline-output.json, run-checks.mjs(+result), pixel-gen.mjs, pixel-measure.py(+result, out/*.html/png),
  migrate-live-check.mjs(+result), ui-live-check.mjs, pngqa/(run.sh, capture-test.mjs, page.html, serve.mjs, result.json)
- `data/detail-builder.json` — 변경 없음(API PUT 라운드트입으로 바이트 동일 확인)

## 재실행 방법
```bash
node qa/fieldsize/run-checks.mjs          # 29/29 단위·바이트 검증
node qa/fieldsize/pixel-gen.mjs && google-chrome --headless=new --no-sandbox --disable-gpu \
  --hide-scrollbars --force-device-scale-factor=1 --window-size=780,500 \
  --screenshot=qa/fieldsize/out/body-12px.png "file://$PWD/qa/fieldsize/out/body-12px.html" && \
  google-chrome --headless=new --no-sandbox --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=1 --window-size=780,500 \
  --screenshot=qa/fieldsize/out/body-20px.png "file://$PWD/qa/fieldsize/out/body-20px.html" && \
  python3 qa/fieldsize/pixel-measure.py   # 픽셀 실측
bash qa/fieldsize/pngqa/run.sh            # PNG 조각 생성 회귀(실제 크롬)
node qa/fieldsize/migrate-live-check.mjs  # 실서버 데이터 마이그레이션
node qa/fieldsize/ui-live-check.mjs       # 실서빙 페이지 UI 확인(CDP)
```
