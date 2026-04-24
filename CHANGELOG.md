# RAG Manager 수정 내역

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
