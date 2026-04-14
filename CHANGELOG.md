# RAG Manager 수정 내역

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
