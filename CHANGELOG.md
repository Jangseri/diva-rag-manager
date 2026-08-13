# RAG Manager 수정 내역

---

## 2026-08-13

### 1. DB 스키마와 git 저장 정보 불일치 해소

**문제:** 신규 서버 구축 시 git의 SQL로 DB를 만들면 코드와 스키마가 어긋남.
아래 두 변경이 `prisma/schema.prisma` 에만 반영되고 SQL 파일이 커밋되지
않아, git 기준 DB에는 `user_key` 컬럼과 VARCHAR(30) `event_id` 가 생성됨
(→ Prisma `P2022` / `P2000`). `DEPLOY.md` 의 DB 구축 절차도 최초 버전
스키마(`create_table.sql` + `alter_add_user_key.sql`)에 머물러 있어
`deletion_confirmations` 테이블과 URL 학습 컬럼이 누락됨.

**수정:**
- `prisma/init_schema.sql` 신설 — 운영 DB(223)의 실제 DDL을 그대로 옮긴
  전체 스키마. **신규 서버는 이 파일 하나만 실행**하면 됨
- `prisma/migrate_20260629_tenant_id.sql` 신설 — 누락돼 있던 마이그레이션
  (user_key → tenant_id, event_id 30 → 100)을 뒤늦게 기록
- `prisma/schema.prisma`: 누락된 인덱스 6개를 명시해 실제 DB와 완전 일치
  (`prisma db pull` 결과와 diff 0). `prisma db push` 로 만들어도 인덱스가
  빠지지 않음
- `DEPLOY.md`: DB 구축 절차 재작성 + 검증 쿼리, IP/계정 교체 대상 표,
  P2022 트러블슈팅 추가. `extract_document` DB를 docs-extract-system과
  공유한다는 사실 명시
- `docker-compose.yml`: 하드코딩된 `user: "1007:1012"` 와
  `NEXT_PUBLIC_APP_URL` 을 `.env` 로 주입 가능하도록 변경
  (기본값은 기존 값 유지 → 223 서버 영향 없음)
- `.env.production.example`, `.env.example`: 폐기된 `MILVUS_COLLECTION_NAME`
  제거, `APP_UID`/`APP_GID` 추가

---

### 2. 문서 전체 최신화

**문제:** `README.md` 가 create-next-app 기본 템플릿 상태였고,
`DEVELOPMENT.md`/`HANDOFF.md` 는 초기 구현 시점(uuid PK, user_key,
검색 stub, Redis 미연동)에 머물러 현재 코드와 크게 어긋남.

**수정:**
- `README.md`: 프로젝트 소개·빠른 시작·문서 인덱스·스키마 관리 규칙으로 재작성
- `DEVELOPMENT.md`: 아키텍처 다이어그램, 디렉토리 구조, 3개 테이블 스키마,
  상태 전이(INDEXED/INDEX_FAILED/DELETING/DELETE_PARTIAL_FAILURE 포함),
  삭제 수명주기, API 스펙, 검색 3종 점수 처리, 환경변수 표로 전면 갱신
- `HANDOFF.md`: 멀티테넌시 규약, `rag:index` 구독, 이벤트 페이로드 실제 형태,
  분산 삭제 프로토콜, milvus-broker v2 스펙(`tenant_id`/`errCode`),
  extract-unstructured URL API로 전면 갱신

---

## 2026-07-06

### 1. milvus-broker 검색 스펙 최신화 + BM25/Vector/Hybrid 비교 UI 복원

**문제:** broker 실검증(192.168.220.223:8009) 결과 요청 body 필드가
`dnis` → `tenant_id` 로 바뀌고 `index_info`/`ranker` 구조가 달라짐.
sparse(BM25) 전용 엔드포인트가 신설되어 hybrid 우회가 불필요해짐.

**수정:**
- `lib/services/milvus-broker.ts`: 요청 필드·엔드포인트 갱신,
  BM25 전용 sparse 엔드포인트 사용
- `app/search/page.tsx`: BM25 + Vector + Hybrid 3종 동시 호출 비교 UI로 복원

---

### 2. 검색 결과 카드에 스니펫·스코어 항상 표시

**수정:**
- `app/search/page.tsx`: compact 옵션 제거로 BM25/Vector 컬럼도 스니펫 노출,
  컬럼별 색상의 퍼센트 바로 점수 표시

---

### 3. Vector 점수는 절대 코사인 유사도로, 하이라이트는 BM25에만 적용

**문제:** BM25(IP)/Hybrid(weighted 융합) 점수는 배치 내 상대 정규화라
100%가 절대 신뢰도처럼 오해될 수 있음. 하이라이트도 의미 기반 매칭인
Vector/Hybrid에 적용되면 근거 없는 강조가 됨.

**수정:**
- `lib/services/milvus-broker.ts`: Vector(COSINE)는 정규화 없이 원본 유사도
  사용(0~1 clamp), BM25/Hybrid만 결과 내 max 기준 상대 정규화
- `app/search/page.tsx`: 검색어 하이라이트를 BM25 결과에만 적용

---

## 2026-06-29

### 1. milvus-broker 스펙 업데이트 + URL 문서 미리보기 허용

**수정:**
- `lib/services/milvus-broker.ts`: workcenter 경로 세그먼트 제거,
  metric_type `L2` → `COSINE`(KURE-v1 dense 인덱스 기준),
  응답 파싱 필드 snake_case → camelCase(`errCode`/`errMessage`),
  엔티티에 `url` 필드 추가
- `app/documents/[id]/page.tsx`: URL 문서도 미리보기 카드 표시

---

### 2. user_key → tenant_id 전체 교체

DB 컬럼명 변경에 맞춰 스키마·타입·서비스·API·UI·테스트를 일괄 교체.

> ⚠️ 이 시점에 마이그레이션 SQL이 커밋되지 않아 이후 신규 서버 구축 시
> 불일치의 원인이 되었습니다. 2026-08-13 자로
> `prisma/migrate_20260629_tenant_id.sql` 에 뒤늦게 기록했습니다.

---

### 3. clientServiceId·tenantId 기반 멀티테넌트 파일 관리 구현

**수정:**
- `lib/identity.ts` 신설 — 요청 body/FormData에서 identity 추출·검증
  (하드코딩된 `user01` 제거)
- 파일 경로: `{ORIGIN_PATH}/{tenant_id}/` →
  `{ORIGIN_PATH}/{clientServiceId}/{tenantId}/`
- Milvus 컬렉션을 `MILVUS_COLLECTION_NAME` 환경변수 대신 요청의
  `clientServiceId` 로 동적 지정, `document_files.collection_name` 에 저장
- 업로드 다이얼로그·검색 페이지에 서비스 ID / 테넌트 ID 입력 필드 추가

---

### 4. 삭제 타임아웃 P2025 무한반복 제거 + processed_events.event_id 확장

**문제:**
- `finalizeTimeout` 이 document 부재 시 트랜잭션 롤백 → confirmation이
  정리되지 않아 P2025가 무한 반복
- RAG 인덱서의 `event_id` 가 30자를 초과해 P2000 저장 실패

**수정:**
- `lib/services/deletion-gate.ts`: document가 없으면 confirmation의
  `finalized_at` 만 갱신 후 반환
- `ProcessedEvent.event_id`: VARCHAR(30) → VARCHAR(100)

> ⚠️ 이 컬럼 확장도 SQL이 커밋되지 않았습니다 (2026-08-13 자로 기록).

---

## 2026-04-29

### 1. 학습 자료 확장 (파일 형식·파일명 제한·URL 학습)

**수정:**
- `lib/constants.ts`: 허용 형식에 `md`, `json`, `hwpx` 추가
- `lib/validators/document.ts`: 파일명 100자 초과 시 거부
- **URL 학습 신규**: 다중 입력 batch 등록(최대 50건),
  `tenant_id` + `source_url` 중복 차단,
  `source_type=url` 일 때 extract-service HTTP API 직접 호출(스트림 미발행),
  목록·상세·삭제 흐름 분기
- `prisma/migrate_20260429_url_source.sql`: `source_type`/`source_url` 컬럼 추가,
  `file_format` NULL 허용
- 환경변수 `EXTRACT_SERVICE_URL` 추가

---

### 2. document_files.status 컬럼 폭 확장 (10 → 30)

**문제:** VARCHAR(10)은 `DELETE_PARTIAL_FAILURE`(22자)를 저장할 수 없어
timeout-job의 status 갱신이 실패 → 해당 file_id가 영구히 `DELETING` 으로 잔류

**수정:**
- `prisma/migrate_20260429_status_width.sql` + `schema.prisma`

---

### 3. standalone 빌드 누락 모듈 수정 (split2, date-fns)

**문제:** 운영 환경에서 pino-roll worker가
`Cannot find module 'split2'` 로 죽어 파일 로깅이 동작하지 않음.
`pino-abstract-transport` 가 런타임에 `split2` 를,
pino-roll `dateFormat` 옵션이 `date-fns` 를 require하는데
`outputFileTracingIncludes` 에 빠져 있었음.

**수정:**
- `next.config.ts`: `split2`, `date-fns` 를 standalone 번들에 포함

---

### 4. 학습 자료 등록 UI 통합 + 긴 파일명/URL 처리

**수정:**
- 업로드 다이얼로그: 파일/URL 동시 등록(단일 '등록' 버튼이 순차 처리),
  URL 입력을 칩(chip) 방식으로 변경(Enter/쉼표/공백/Tab/paste 추가,
  Backspace로 마지막 칩 제거), 진행률 바를 Tabs 밖으로 이동, 폭 고정
- 긴 파일명/URL truncate 전반 수정: 목록 컬럼 명시적 width,
  상세 헤더 `shrink-0`/`min-w-0 flex-1`, URL `<a>` 에 `block` 추가,
  검색 결과 Link 레이아웃, 삭제 다이얼로그의 파일명 별도 박스 분리

---

## 2026-04-24

### 1. 프로덕션 환경 파일 로깅 복원

**문제:** 프로덕션은 stdout 전용으로 로깅하고 있어 서버에 로그 파일이
쌓이지 않음. `docker logs`로만 확인 가능해 운영 중 로그 추적이 불편함.

**수정:**
- `lib/logger.ts`: 프로덕션 분기에 `pino-roll` transport 2개 추가
  (`logs/app.log` info 이상 / `logs/error.log` error 전용, daily 로테이션,
  파일당 10MB). stdout JSON 출력은 유지하여 `docker logs` 호환성 보존.
- `docker-compose.yml`의 `./logs:/app/logs` 볼륨 마운트와 연동되어
  호스트 `./logs/`에 `app.YYYY-MM-DD.N.log` 형태로 적재됨.

---

## 2026-04-23

### 1. 대용량 파일 업로드 실패 수정

**문제:** 10MB를 초과하는 파일 업로드 시 `Failed to parse body as FormData:
expected boundary after body` 에러로 실패. Next.js 16에서 `proxy.ts`가
존재할 경우 request body가 기본 10MB에서 잘려나가 multipart 파싱 실패.

**수정:**
- `next.config.ts`: `experimental.proxyClientMaxBodySize: "1gb"` 추가
  (서버 `route.ts:60`의 `contentLength > MAX_FILE_SIZE_BYTES * 10` 상한과 일치)

---

### 2. 업로드 다이얼로그에 용량 한도 표시

**문제:** 파일당 100MB / 합계 1GB 제한이 있으나 사용자가 인지할 방법 없음

**수정:**
- `components/documents/document-upload-dialog.tsx`:
  - Description 문구 변경: "파일당 최대 100MB, 한 번에 여러 파일 업로드 시
    합계 최대 1GB까지 가능합니다."
  - 파일 목록 하단에 `합계 X MB / 1.0 GB` 실시간 표시
  - 합계 한도 초과 시 붉은색 경고 문구 노출 + 업로드 버튼 비활성화

---

## 2026-04-16

### 1. 삭제 수명주기(DELETE lifecycle) 병렬 처리 + INDEX confirmation

**요청:** 삭제 요청 시 extract/index 양측 confirmation을 병렬로 처리하고,
확인 지연을 감지할 수 있는 타임아웃 메커니즘 필요

**수정:**
- `prisma/schema.prisma`: `deletion_confirmations` 테이블 신설
- `prisma/migrate_20260416_deletion_confirmations.sql`: 마이그레이션 스크립트
- `lib/services/deletion-gate.ts`: 삭제 confirmation 게이트 서비스 신설
- `lib/services/timeout-job.ts`: 지연된 confirmation을 스캔하는 주기 잡 신설
  (`instrumentation.ts`에서 부팅 시 기동)
- `lib/services/event-consumer.ts`: extract/index 이벤트 소비 로직 확장
- `app/api/documents/[id]/route.ts`, `bulk-delete/route.ts`: 삭제 흐름 개편
- `components/documents/file-status-badge.tsx`, `types/index.ts`: 삭제
  관련 상태 추가
- `PROPOSAL_DELETE_LIFECYCLE_PARALLEL.md`: 설계 제안서 추가

---

### 2. 미리보기 탭 개편 + collection 기본값 변경

**수정:**
- `app/api/documents/[id]/preview/route.ts`: 미리보기 API 구조 개편
  (원본/추출 섹션 분리)
- `app/documents/[id]/page.tsx`: 미리보기 탭 UI 개편, collection 기본값 변경

---

### 3. RAG 검색 결과에서 Hybrid 단독 표시

**요청:** 검색 결과 화면에서 Vector/BM25 분리 표시 대신 Hybrid 결과만
단독으로 보여주기

**수정:**
- `app/search/page.tsx`: 다중 메서드 탭 구조 제거, Hybrid 결과만 표시

---

### 4. 검색 결과 유사도 퍼센트 표시 제거

**수정:**
- `app/search/page.tsx`: 각 결과 항목의 유사도 퍼센트 뱃지 제거

---

### 5. 업로드 허용 확장자 확대 (JPG/JPEG/PNG)

**수정:**
- `lib/constants.ts`: `ALLOWED_FILE_FORMATS`, `ALLOWED_MIME_TYPES`에
  jpg/jpeg/png 추가
- `components/documents/document-upload-dialog.tsx`: accept 속성 및
  안내 문구 업데이트
- `components/documents/file-format-icon.tsx`: 이미지 포맷 아이콘 매핑 추가
- `__tests__/lib/validators.test.ts`, `DEVELOPMENT.md` 동기화

---

### 6. 문서 데이터 reset SQL 추가

**수정:**
- `prisma/reset_documents_20260416.sql`: 문서 데이터 초기화용 SQL 추가

---

## 2026-04-15

### 1. docs-extract-system 연동 스펙 v1 적용

**요청:** 외부 문서 추출 시스템(docs-extract-system)과의 연동 스펙 v1을
반영하여 이벤트 페이로드/ID 체계/에러 코드 체계 정리

**수정:**
- `prisma/schema.prisma` + `prisma/migrate_20260415_spec_v1.sql`: 스펙 v1
  기준 스키마 갱신
- `lib/id.ts` 신설 (기존 `lib/tsid.ts` 대체), `lib/error-codes.ts` 신설
- `lib/services/event-publisher.ts`, `event-consumer.ts`: 이벤트
  페이로드/토픽 개편
- `lib/services/document-service.ts`, `lib/file-storage.ts`: 서비스 계층
  스펙 v1 정렬
- `app/api/documents/*`: 라우트 응답/에러 포맷 정리
- 테스트/팩토리 전반 동기화

---

### 2. Hybrid Search API 스펙 v2 적용

**수정:**
- `lib/services/milvus-broker.ts`: Hybrid Search 요청/응답 스펙 v2 반영
- `.env.example`, `.env.production.example`: 관련 환경변수 갱신

---

### 3. Spec v1 초기화용 reset SQL 추가

**수정:**
- `prisma/reset_20260415_spec_v1.sql`: 스펙 v1 마이그레이션 시점 초기화 SQL

---

### 4. 인프라/배포 안정화

**문제:** Docker 환경에서 Next.js standalone 빌드 시 pino transport 누락,
Alpine에서 Prisma OpenSSL 3.x 미지원, 로그 파일 권한 문제 등 다수 이슈

**수정:**
- `next.config.ts`: `outputFileTracingIncludes`로 pino transport 및
  Prisma 관련 모듈을 standalone 번들에 명시적으로 포함
- `docker/Dockerfile`, `prisma/schema.prisma`: Prisma OpenSSL 3.x 지원
- `lib/logger.ts` + `docker-compose.yml`: 프로덕션은 stdout 전용 로깅으로
  전환, Docker json-file 드라이버 로그 로테이션 설정
- `docker-compose.yml`: static subnet(`172.24.17.0/24`) 지정, 공유
  스토리지 쓰기를 위한 UID/GID(`1007:1012`) 설정

---

## 2026-04-10

### 1. DB 연결 오류 수정

**문제:** 로컬에서 `npm run dev` 실행 시 API 호출 에러 발생
- `fetchApi`에서 `NEXT_PUBLIC_APP_URL`을 절대 URL 프리픽스로 사용하여 문제 발생
- `.env.local`의 DB 접속 정보가 플레이스홀더 상태

**수정:**
- `lib/api-client.ts`: `BASE_URL` 프리픽스 제거, 상대 경로만 사용
- `.env.local`: DB 접속 정보 실제 값으로 변경 (root/aidb!@34)
- `.env`: Prisma CLI용 환경변수 파일 생성
- `prisma/create_table.sql`: 기존 테이블 삭제 방지를 위해 SQL로 직접 테이블 생성

---

### 2. user_key 컬럼 추가

**요청:** 업로드한 사용자를 식별할 수 있는 user_key 필요

**수정:**
- DB: `ALTER TABLE`로 `user_key VARCHAR(100)` 컬럼 + 인덱스 추가
- `prisma/schema.prisma`: user_key 필드 추가
- `types/index.ts`: DocumentRecord, DocumentResponse에 user_key 추가
- `lib/services/document-service.ts`: createDocument input에 user_key 포함
- `app/api/documents/route.ts`: 업로드 시 user_key 저장
- `lib/api-response.ts`: 응답 변환에 user_key 포함
- `components/documents/document-columns.tsx`: 테이블에 user_key 컬럼 추가
- `app/documents/[id]/page.tsx`: 상세 페이지에 user_key 표시
- `__tests__/factories/document.ts`: 테스트 팩토리에 user_key 추가

---

### 3. 업로드 다이얼로그에서 수동 입력 필드 제거

**문제:** 업로드 시 user_key와 rgst_nm을 사용자가 직접 입력하는 구조 → 로그인 사용자 정보에서 자동으로 가져와야 함

**수정:**
- `components/documents/document-upload-dialog.tsx`: user_key, rgst_nm 입력 필드 제거. 파일 선택만 가능
- `lib/auth.ts` 생성: `getCurrentUser()` 함수 (임시 기본값: user_key=user01, name=admin)
- `app/api/documents/route.ts`: formData에서 사용자 정보 파싱 → `getCurrentUser()`로 서버에서 자동 주입
- `app/api/documents/[id]/route.ts`: DELETE 시 updt_nm도 `getCurrentUser()`에서 자동 주입
- `lib/api-client.ts`: `uploadDocuments(files)`, `deleteDocument(id)` — 사용자 정보 파라미터 제거

---

### 4. 임시 사용자 기본값 설정

**요청:** rgst_nm, updt_nm은 "admin", user_key는 "user01"로 설정

**수정:**
- `lib/auth.ts`: getCurrentUser() 반환값 변경
  - user_key: `"user01"`
  - name: `"admin"`

---

### 5. 드롭다운 대소문자 통일

**문제:** 드롭다운 선택 시 표시되는 값과 목록 내 항목의 대소문자가 불일치 (all vs ALL)

**수정:**
- `components/documents/document-toolbar.tsx`: 형식 필터 "전체 형식" → `ALL`, 상태 뱃지 한글 → 영문 대문자 통일
- `components/documents/file-status-badge.tsx`: 뱃지 텍스트 한글 → 영문 대문자 (업로드됨→UPLOADED, 처리중→PROCESSING, 추출완료→EXTRACTED, 실패→FAILED)

---

### 6. 상태 드롭다운 분리 (파일 상태 / 문서 상태)

**문제:** ACTIVE/DELETED(문서 관리 상태)와 UPLOADED/PROCESSING/EXTRACTED/FAILED(파일 처리 상태)가 하나의 드롭다운에 혼합되어 있음

**수정:**
- `components/documents/document-toolbar.tsx`: 드롭다운 2개로 분리
  - 파일 상태: ALL / UPLOADED / PROCESSING / EXTRACTED / FAILED
  - 문서 상태: ACTIVE / DELETED
- `app/documents/page.tsx`: `fileStatus`, `docStatus` 상태값 분리, API 호출 시 `status`와 `file_status` 파라미터 분기
- `lib/validators/document.ts`: `file_status` 파라미터 추가
- `lib/services/document-service.ts`: `file_status` 필터 처리 추가
- `lib/api-client.ts`: `fetchDocuments`에 `file_status` 파라미터 추가
- `__tests__/lib/validators.test.ts`: file_status 유효성 테스트 2개 추가

---

### 7. 테이블 헤더 중앙 정렬

**요청:** 문서 관리 테이블의 헤더(파일명, 형식, 상태 등)를 중앙 정렬

**수정:**
- `components/documents/document-columns.tsx`: 모든 헤더에 `<div className="text-center">` 적용
- 셀도 중앙 정렬 (`text-center`)
- 단, 파일명 셀은 좌측 정렬 유지 (아이콘 + 텍스트 구조상 좌측이 자연스러움)

---

### 8. "사용자 키" 명칭 변경 및 컬럼 정리

**문제:** "사용자 키"라는 명칭이 어색하고, rgst_nm과 user_key가 모두 표시되어 중복

**수정:**
- 테이블: "사용자 키" 컬럼 → **"등록자"**로 변경 (user_key 값 표시), 기존 rgst_nm "등록자" 컬럼 제거
- 컬럼 순서 변경: 파일명 → 형식 → 상태 → 크기 → 등록일 → **등록자** → 액션
- 상세 페이지: 중복 "등록자" 제거 (user_key 하나만 "등록자"로 표시)

---

### 9. 상세 페이지 레이아웃 정리

**요청:** 상세 페이지 간격이 안 맞고, 수정자 제거, 등록일시/수정일시 같은 행 배치, 뱃지 파일명 옆으로

**수정:**
- `app/documents/[id]/page.tsx` 전면 재구성:
  - 카드 최대 너비 `max-w-3xl`로 제한
  - 헤더: 파일 아이콘 + 파일명 + 상태 뱃지가 한 줄에 나란히 배치
  - 수정자(updt_nm) 항목 제거
  - 메타데이터 3열 그리드 (`grid-cols-3`, `gap-x-8 gap-y-5`):
    - 1행: 등록자 | 파일형식 | 파일크기
    - 2행: 등록일시 | 수정일시
  - 헤더/메타데이터 영역 패딩 통일 (`px-6 py-5`)
  - 스켈레톤 로딩도 동일 레이아웃에 맞춤

---

### 10. DELETED 문서 액션 메뉴 비활성화

**문제:** DELETED 필터로 조회된 문서에서도 `...` 메뉴의 다운로드/삭제가 활성화

**수정:**
- `components/documents/document-columns.tsx`: `doc.status === "DELETED"` 일 때 드롭다운 메뉴에서 다운로드/삭제 항목 숨김. 상세 보기만 표시
