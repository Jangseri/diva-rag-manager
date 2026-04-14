# RAG Manager 개발 내역

## 프로젝트 개요

RAG(Retrieval-Augmented Generation) 문서 관리 시스템.
파일 업로드/조회/다운로드/삭제 + RAG 검색(BM25, Vector, Hybrid) 기능을 제공하는 웹 애플리케이션.

---

## 기술 스택

| 구분 | 기술 |
|------|------|
| Framework | Next.js 16 (App Router) - 풀스택 단일 프로젝트 |
| UI | shadcn/ui + Tailwind CSS v4 + TanStack Table |
| ORM | Prisma 5 (MariaDB) |
| Validation | Zod |
| ID 생성 | TSID (time-sortable unique ID, 자체 구현) |
| Testing | Vitest + Testing Library + happy-dom |
| Deploy | Docker + docker-compose |

---

## 프로젝트 구조

```
diva-rag-manager/
├── app/
│   ├── layout.tsx                    # 루트 레이아웃 (사이드바, 헤더, 토스트)
│   ├── page.tsx                      # / → /documents 리다이렉트
│   ├── globals.css                   # Tailwind + shadcn/ui 테마
│   ├── documents/
│   │   ├── page.tsx                  # 문서 리스트 페이지
│   │   └── [id]/
│   │       └── page.tsx              # 문서 상세 페이지
│   ├── search/
│   │   └── page.tsx                  # RAG 검색 페이지
│   └── api/
│       ├── documents/
│       │   ├── route.ts              # GET(리스트), POST(업로드)
│       │   └── [id]/
│       │       ├── route.ts          # GET(상세), DELETE(소프트삭제)
│       │       └── download/
│       │           └── route.ts      # GET(파일 다운로드)
│       └── search/
│           └── route.ts              # POST(RAG 검색 - stub)
├── components/
│   ├── ui/                           # shadcn/ui 컴포넌트
│   ├── layout/
│   │   ├── sidebar.tsx               # 사이드바 네비게이션
│   │   └── header.tsx                # 상단 브레드크럼
│   ├── documents/
│   │   ├── document-table.tsx        # TanStack Table 래퍼
│   │   ├── document-columns.tsx      # 컬럼 정의
│   │   ├── document-toolbar.tsx      # 필터, 검색, 업로드 버튼
│   │   ├── document-pagination.tsx   # 페이지네이션
│   │   ├── document-upload-dialog.tsx# 업로드 다이얼로그
│   │   ├── document-delete-dialog.tsx# 삭제 확인 다이얼로그
│   │   ├── file-status-badge.tsx     # 상태 뱃지
│   │   └── file-format-icon.tsx      # 파일 형식 아이콘
│   └── search/                       # (검색 컴포넌트는 page에 포함)
├── lib/
│   ├── prisma.ts                     # Prisma 클라이언트 싱글턴
│   ├── tsid.ts                       # TSID 생성 유틸리티
│   ├── constants.ts                  # 허용 파일형식, MIME, 크기제한, 경로
│   ├── auth.ts                       # 현재 사용자 정보 (임시 기본값)
│   ├── format.ts                     # 파일크기/날짜 포매터
│   ├── utils.ts                      # cn() 헬퍼
│   ├── api-response.ts              # API 응답 유틸리티
│   ├── api-client.ts                # 프론트엔드 fetch 래퍼
│   ├── file-storage.ts              # 파일 저장/읽기/삭제
│   ├── validators/
│   │   └── document.ts              # Zod 스키마 (리스트, 업로드, 검색)
│   └── services/
│       └── document-service.ts      # 문서 CRUD 비즈니스 로직
├── types/
│   └── index.ts                      # TypeScript 타입 정의
├── hooks/                            # (추후 사용)
├── prisma/
│   ├── schema.prisma                 # DB 스키마
│   ├── create_table.sql              # 테이블 생성 SQL
│   └── alter_add_user_key.sql        # user_key 컬럼 추가 SQL
├── __tests__/
│   ├── setup.ts                      # 테스트 설정
│   ├── factories/
│   │   └── document.ts              # 테스트 데이터 팩토리
│   ├── mocks/
│   │   └── prisma.ts                # Prisma 모킹
│   ├── api/
│   │   └── documents.test.ts        # 문서 서비스 테스트 (12개)
│   ├── lib/
│   │   ├── tsid.test.ts             # TSID 테스트 (5개)
│   │   ├── validators.test.ts       # 유효성 검증 테스트 (31개)
│   │   └── file-storage.test.ts     # 파일 저장 테스트 (11개)
│   └── components/                   # (추후 컴포넌트 테스트)
├── docker/
│   └── Dockerfile                    # 멀티스테이지 빌드
├── docker-compose.yml
├── storage/                          # 로컬 개발용 파일 저장소
│   ├── origin/
│   └── extract/
├── vitest.config.ts
├── next.config.ts                    # standalone output 설정
├── .env.local                        # 로컬 환경변수
├── .env                              # Prisma CLI용 환경변수
└── .env.example                      # 환경변수 템플릿
```

---

## 데이터베이스

### document_files 테이블

| 컬럼 | 타입 | 설명 |
|------|------|------|
| uuid | VARCHAR(30) PK | TSID 기반 고유 식별자 |
| file_name | VARCHAR(500) | 원본 파일명 |
| user_key | VARCHAR(100) | 업로드 사용자 식별 키 |
| file_format | VARCHAR(20) | 파일 확장자 (pdf, docx, txt, hwp, xlsx, pptx) |
| file_status | VARCHAR(20) | 파일 처리 상태 (UPLOADED/PROCESSING/EXTRACTED/FAILED) |
| file_size | BIGINT | 파일 크기 (bytes) |
| rgst_dt | DATETIME | 등록일시 |
| rgst_nm | VARCHAR(100) | 등록자명 |
| status | VARCHAR(10) | 문서 관리 상태 (ACTIVE/DELETED) |
| updt_dt | DATETIME | 수정일시 |
| updt_nm | VARCHAR(100) | 수정자명 |

### 상태 정의

**file_status (파일 처리 상태)**

| 상태 | 의미 | 발생 시점 |
|------|------|-----------|
| UPLOADED | 원문 파일 저장 완료 | 사용자 업로드 시 |
| PROCESSING | 텍스트 추출 중 | docs-extract-system 작업 시작 시 (외부) |
| EXTRACTED | 추출 완료, RAG 검색 가능 | extract_document 성공 시 (외부) |
| FAILED | 추출 실패 | extract_document 실패 시 (외부) |

**status (문서 관리 상태)**

| 상태 | 의미 |
|------|------|
| ACTIVE | 정상 문서 |
| DELETED | 소프트 삭제됨 (DB에는 존재, 기본 목록에서 제외) |

---

## API 엔드포인트

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | /api/documents | 문서 목록 (page, size, sort, order, search, format, status, file_status) |
| POST | /api/documents | 파일 업로드 (multipart: files[]) |
| GET | /api/documents/[id] | 문서 상세 조회 |
| DELETE | /api/documents/[id] | 소프트 삭제 |
| GET | /api/documents/[id]/download | 파일 다운로드 (스트림) |
| POST | /api/search | RAG 검색 (query, method: bm25/vector/hybrid, top_k) - 현재 stub |

---

## 화면 구성

### 1. 문서 관리 (/documents)
- 파일명 검색
- 형식 필터 (ALL/PDF/DOCX/TXT/HWP/XLSX/PPTX)
- 파일 상태 필터 (ALL/UPLOADED/PROCESSING/EXTRACTED/FAILED)
- 문서 상태 필터 (ACTIVE/DELETED)
- 파일 업로드 버튼 → 드래그앤드롭 다이얼로그
- 테이블: 파일명, 형식, 상태, 크기, 등록일, 등록자, 액션(...)
- 서버사이드 페이지네이션 (10/20/50건)
- DELETED 문서는 액션 메뉴에서 다운로드/삭제 비활성화

### 2. 문서 상세 (/documents/[id])
- 파일 아이콘 + 파일명 + 상태 뱃지
- 다운로드/삭제 버튼 (DELETED 시 비활성화)
- 메타데이터: 등록자, 파일형식, 파일크기, 등록일시, 수정일시

### 3. RAG 검색 (/search)
- 검색어 입력 (textarea)
- 검색 방법 탭: BM25 / Vector / Hybrid
- 결과 수 선택: 3, 5, 10, 20
- 결과 카드: 순위, 문서명, 관련도 점수 바, 스니펫, 메타데이터
- 현재 stub 응답 반환 (외부 API 연동 대기)

---

## 테스트 현황

총 **59개 테스트** 통과

| 파일 | 테스트 수 | 내용 |
|------|-----------|------|
| tsid.test.ts | 5 | TSID 생성, 유일성, 정렬 가능성 |
| validators.test.ts | 31 | Zod 스키마 검증 (리스트 쿼리, 업로드, 검색, 파일형식, 파일크기, file_status) |
| file-storage.test.ts | 11 | 파일 저장/읽기/존재확인/삭제 |
| documents.test.ts | 12 | 문서 서비스 (목록, 상세, 생성, 소프트삭제) |

---

## 인증 (임시)

`lib/auth.ts`의 `getCurrentUser()` 함수에서 임시 기본값 반환:
- user_key: `user01`
- name: `admin`

추후 로그인 구현 시 세션/토큰에서 실제 사용자 정보를 조회하도록 교체 예정.

---

## Docker 배포

```bash
# 빌드 및 실행
docker-compose up --build

# 환경변수 (docker-compose.yml에서 설정)
DATABASE_URL=mysql://root:aidb%21%4034@192.168.220.223:3306/extract_document
ORIGIN_PATH=/shared/document/origin
EXTRACT_PATH=/shared/document/extract
```

---

## 추후 작업

- [ ] 로그인/인증 구현 → `lib/auth.ts` 교체
- [ ] Redis Streams 연동 (docs-extract-system과 `rag:documents`, `rag:extract` 교환)
- [ ] RAG 검색 API 실제 연동 → milvus-broker 호출로 `/api/search` stub 교체
- [ ] 223 서버 Docker 배포
