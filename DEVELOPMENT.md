# RAG Manager 개발 문서

## 프로젝트 개요

RAG(Retrieval-Augmented Generation) 학습 자료 관리 시스템.

- **학습 자료 등록**: 파일 업로드 + 웹 URL 크롤링 등록
- **처리 상태 추적**: 외부 추출/인덱싱 서비스의 진행 상황을 Redis Streams로 수신해 반영
- **분산 삭제**: 추출·인덱스 양측 삭제 confirmation을 병렬로 대기하는 게이트 방식
- **RAG 검색**: BM25 / Vector / Hybrid 3종을 milvus-broker 경유로 호출

**멀티테넌트**: 모든 등록·검색 요청은 `clientServiceId`(서비스 단위) + `tenantId`(테넌트 단위)로
격리됩니다. `clientServiceId`는 Milvus 컬렉션명으로, `tenantId`는 파티션 키로 쓰입니다.

---

## 기술 스택

| 구분 | 기술 |
|------|------|
| Framework | Next.js 16.2 (App Router) — 풀스택 단일 프로젝트 |
| React | React 19.2 |
| UI | shadcn/ui + Base UI + Tailwind CSS v4 + TanStack Table |
| ORM | Prisma 5 (MariaDB 10.11) |
| Validation | Zod 4 (`zod/v4`) |
| ID 생성 | ULID (26자, `lib/id.ts`) |
| 이벤트 | Redis Streams (ioredis) |
| 로깅 | Pino + pino-roll (일별 파일 로테이션) |
| Testing | Vitest + Testing Library + happy-dom + MSW |
| Deploy | Docker + docker-compose (standalone 빌드) |

---

## 시스템 구성

```
                    ┌──────────────────────────────┐
   브라우저 ───────▶│         rag-manager          │
                    │  (Next.js App Router, :3000) │
                    └───┬────────┬────────┬────────┘
                        │        │        │
        ┌───────────────┘        │        └────────────────┐
        │ Redis Streams          │ HTTP                    │ HTTP
        ▼                        ▼                         ▼
 ┌──────────────┐    ┌──────────────────────┐   ┌────────────────────┐
 │ rag:documents│    │ extract-unstructured │   │   milvus-broker    │
 │ rag:extract  │    │  (URL 학습 등록)     │   │   (RAG 검색)       │
 │ rag:index    │    └──────────────────────┘   └─────────┬──────────┘
 └──┬────────▲──┘                                         │
    │        │                                            ▼
    ▼        │                                      ┌──────────┐
┌───────────────────┐   ┌───────────────┐           │  Milvus  │
│docs-extract-system│──▶│ milvus-indexer│──────────▶└──────────┘
└─────────┬─────────┘   └───────────────┘
          │ 추출 JSON 저장
          ▼
   /data/diva/extract
```

- 파일 업로드는 **Redis Streams**로 비동기 처리 (`rag:documents` 발행 → `rag:extract`/`rag:index` 수신)
- URL 등록은 **HTTP 동기 호출** (extract-unstructured `/v1/extract/tasks/url`)
  → 이후 상태 변화는 동일하게 Redis Streams로 수신
- 검색은 milvus-broker HTTP 호출 (Milvus 직접 접근 없음)

---

## 디렉토리 구조

```
diva-rag-manager/
├── app/
│   ├── layout.tsx                      # 루트 레이아웃 (사이드바, 헤더, 토스트)
│   ├── page.tsx                        # / → /documents 리다이렉트
│   ├── documents/
│   │   ├── page.tsx                    # 학습 자료 목록
│   │   └── [id]/page.tsx               # 상세 (미리보기 탭 포함)
│   ├── search/page.tsx                 # RAG 검색 (BM25/Vector/Hybrid 비교)
│   └── api/
│       ├── documents/
│       │   ├── route.ts                # GET 목록 / POST 파일 업로드
│       │   ├── url/route.ts            # POST URL 등록
│       │   ├── bulk-delete/route.ts    # POST 일괄 삭제
│       │   └── [id]/
│       │       ├── route.ts            # GET 상세 / DELETE 삭제
│       │       ├── download/route.ts   # GET 스트리밍 다운로드
│       │       └── preview/route.ts    # GET 원본/추출 미리보기
│       ├── search/route.ts             # POST RAG 검색
│       └── health/route.ts             # GET 헬스체크
├── components/
│   ├── ui/                             # shadcn/ui 컴포넌트
│   ├── layout/                         # sidebar, header
│   └── documents/
│       ├── document-table.tsx          # TanStack Table 래퍼
│       ├── document-columns.tsx        # 컬럼 정의
│       ├── document-toolbar.tsx        # 검색·필터·등록 버튼
│       ├── document-pagination.tsx
│       ├── document-upload-dialog.tsx  # 파일/URL 탭 통합 등록 다이얼로그
│       ├── document-delete-dialog.tsx
│       ├── file-status-badge.tsx
│       └── file-format-icon.tsx
├── lib/
│   ├── prisma.ts                       # Prisma 싱글턴
│   ├── redis.ts                        # ioredis publisher/subscriber
│   ├── logger.ts                       # Pino (prod: stdout + 파일 로테이션)
│   ├── id.ts                           # ULID 생성
│   ├── identity.ts                     # clientServiceId/tenantId 추출·검증
│   ├── auth.ts                         # 현재 사용자 (임시 하드코딩)
│   ├── constants.ts                    # 허용 형식·크기 제한·경로
│   ├── error-codes.ts                  # 외부 error_code → 한글 메시지
│   ├── file-storage.ts                 # 경로 sanitize + 파일 I/O
│   ├── api-response.ts / api-client.ts
│   ├── format.ts / utils.ts
│   ├── validators/
│   │   ├── document.ts                 # 목록 쿼리·검색·파일명/크기 검증
│   │   └── url.ts                      # URL 등록 검증
│   └── services/
│       ├── document-service.ts         # 문서 CRUD 비즈니스 로직
│       ├── event-publisher.ts          # rag:documents 발행
│       ├── event-consumer.ts           # rag:extract / rag:index 구독
│       ├── deletion-gate.ts            # 분산 삭제 confirmation 게이트
│       ├── timeout-job.ts              # 삭제 타임아웃 스캔 (1분 주기)
│       ├── extract-client.ts           # extract-unstructured HTTP 클라이언트
│       └── milvus-broker.ts            # 검색 API 클라이언트
├── prisma/
│   ├── schema.prisma                   # Prisma 스키마 (운영 DB와 1:1)
│   ├── init_schema.sql                 # ★ 신규 구축용 전체 스키마
│   ├── migrate_*.sql                   # 날짜별 마이그레이션 (이력)
│   └── reset_*.sql                     # 데이터 초기화용
├── __tests__/                          # Vitest
├── docker/Dockerfile                   # 멀티스테이지 빌드
├── docker-compose.yml
├── instrumentation.ts                  # 부팅 시 consumer + timeout job 기동
├── next.config.ts                      # standalone, 보안 헤더, body 크기
└── proxy.ts                            # Rate limiting 등 미들웨어
```

---

## 데이터베이스

**DB:** MariaDB `extract_document` — docs-extract-system과 **공유**합니다.
(`extraction_task`, `alembic_version` 테이블은 그쪽 소유)

### document_files — 학습 자료 마스터

| 컬럼 | 타입 | 설명 |
|------|------|------|
| file_id | VARCHAR(26) PK | ULID |
| source_type | VARCHAR(10) | `file` / `url` |
| source_url | VARCHAR(2048) NULL | URL 등록 시에만 사용 |
| file_name | VARCHAR(500) | 원본 파일명 (URL은 표시용 이름) |
| tenant_id | VARCHAR(100) | 테넌트 식별자 (= Milvus partition) |
| file_format | VARCHAR(20) NULL | 확장자. URL 케이스는 NULL |
| file_size | BIGINT | 바이트 |
| file_status | VARCHAR(20) | 처리 상태 (아래 참조) |
| collection_name | VARCHAR(200) NULL | `clientServiceId` (= Milvus 컬렉션명) |
| origin_path | VARCHAR(1000) NULL | 저장된 원본 절대 경로 |
| retry_count | INT | 추출/인덱싱 재시도 횟수 (최대 3) |
| last_error_code | VARCHAR(50) NULL | 마지막 실패 코드 |
| rgst_dt / rgst_nm | DATETIME / VARCHAR(100) | 등록일시 / 등록자 |
| status | VARCHAR(30) | 문서 관리 상태 (아래 참조) |
| updt_dt / updt_nm | DATETIME / VARCHAR(100) | 수정일시 / 수정 주체 |

### processed_events — 이벤트 멱등성

| 컬럼 | 타입 | 설명 |
|------|------|------|
| event_id | VARCHAR(100) PK | 수신 이벤트 ID (중복 수신 차단) |
| event_type | VARCHAR(50) | 이벤트 종류 |
| file_id | VARCHAR(26) NULL | 대상 문서 |
| processed_at | DATETIME | 처리 시각 |

### deletion_confirmations — 분산 삭제 게이트

| 컬럼 | 타입 | 설명 |
|------|------|------|
| file_id | VARCHAR(26) PK | 대상 문서 |
| extract_confirmed / _error_code / _at | TINYINT / VARCHAR(50) / DATETIME | 추출 측 삭제 확인 |
| index_confirmed / _error_code / _at | TINYINT / VARCHAR(50) / DATETIME | 인덱스 측 삭제 확인 |
| deletion_due_at | DATETIME | 확인 마감 시각 (요청 + 5분) |
| finalized_at | DATETIME NULL | 확정 완료 시각 |
| created_at / updated_at | DATETIME | |

> 스키마 변경 시 **`schema.prisma` 와 `init_schema.sql`(+ `migrate_*.sql`)을 같은 커밋에** 반영해야
> 합니다. 실제 DB와의 일치 여부는 `npx prisma db pull --print` 결과와 비교해 확인할 수 있습니다.

---

## 상태 정의

### file_status (처리 상태)

| 상태 | 의미 | 변경 주체 |
|------|------|-----------|
| UPLOADED | 원본 저장 완료 | rag-manager (등록 시) |
| PROCESSING | 텍스트 추출 중 | `EXTRACT_STARTED` 수신 |
| EXTRACTED | 추출 완료 | `EXTRACT_COMPLETED` 수신 |
| INDEXED | 인덱싱 완료 (검색 가능) | `INDEX_COMPLETED` 수신 |
| FAILED | 추출 실패 (재시도 소진) | `EXTRACT_FAILED` 수신 |
| INDEX_FAILED | 인덱싱 실패 (재시도 소진) | `INDEX_FAILED` 수신 |

```
UPLOADED ─▶ PROCESSING ─▶ EXTRACTED ─▶ INDEXED
                │                          │
                ├─▶ FAILED                 └─▶ INDEX_FAILED
```

`retryable: true` 이고 `retry_count < 3` 이면 `DOCUMENT_UPLOADED` 를 재발행해 추출부터 재시도합니다.
단, **URL 케이스(`source_type = 'url'`)는 스트림 재발행이 불가능**하므로 즉시 실패로 확정됩니다.

### status (문서 관리 상태)

| 상태 | 의미 |
|------|------|
| ACTIVE | 정상 |
| DELETING | 삭제 요청됨, 양측 confirmation 대기 중 |
| DELETED | 삭제 확정 (원본 파일 unlink 완료) |
| DELETE_PARTIAL_FAILURE | 일부 실패 또는 5분 내 미확인 (수동 확인 필요) |

### 삭제 수명주기

```
DELETE 요청
  └─▶ status = DELETING
      deletion_confirmations 생성 (due_at = now + 5분)
      DOCUMENT_DELETED 발행
          │
          ├── EXTRACT_DELETED 수신 ──▶ extract_confirmed = 1 ─┐
          │                                                   ├─▶ 둘 다 확인
          └── INDEX_DELETED   수신 ──▶ index_confirmed   = 1 ─┘   → 원본 unlink
                                                                   → status = DELETED
  ── 5분 경과 & 미확인 ─▶ timeout-job(1분 주기) ─▶ DELETE_PARTIAL_FAILURE
  ── *_DELETE_FAILED 수신 ─────────────────────▶ DELETE_PARTIAL_FAILURE
```

---

## 파일 저장 구조

```
{ORIGIN_PATH}/{clientServiceId}/{tenantId}/{file_id}.{ext}   ← rag-manager가 저장
{EXTRACT_PATH}/...                                            ← docs-extract-system이 저장 (읽기 전용)
```

경로 세그먼트는 `lib/file-storage.ts` 의 `sanitize()`로 path traversal을 차단합니다
(`..`, 널바이트, `<>:"|?*\/` 금지 + resolve 후 base 경로 이탈 검사).

---

## API 엔드포인트

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/documents` | 목록. `page, size(10/20/50), sort, order, search, format, status, file_status, clientServiceId, tenantId` |
| POST | `/api/documents` | 파일 업로드 (multipart: `files[]` + `clientServiceId`, `tenantId`) |
| POST | `/api/documents/url` | URL 등록 (JSON: `urls[]`, `crawler_options`, identity) — 최대 50건 |
| GET | `/api/documents/{file_id}` | 상세 |
| DELETE | `/api/documents/{file_id}` | 삭제 요청 (게이트 개시) |
| POST | `/api/documents/bulk-delete` | 일괄 삭제 (`{ids: string[]}`, 최대 100건) |
| GET | `/api/documents/{file_id}/download` | 스트리밍 다운로드 |
| GET | `/api/documents/{file_id}/preview` | 원본/추출 결과 미리보기 |
| POST | `/api/search` | RAG 검색 (`query`, `method: bm25\|vector\|hybrid`, `top_k(1~20)`, identity) |
| GET | `/api/health` | 헬스체크 |

**identity는 모든 등록/검색 요청에 필수**입니다 (`clientServiceId`, `tenantId`).
누락 시 400을 반환합니다 — `lib/identity.ts` 참조.

### 업로드 제약

| 항목 | 값 |
|------|-----|
| 허용 형식 | pdf, docx, pptx, xlsx, hwp, hwpx, txt, md, json, jpg, jpeg, png |
| 파일명 | 100자 이하, 특수문자·널바이트 금지, `.` 시작 금지 |
| 파일당 크기 | 100MB (`MAX_FILE_SIZE_MB`) |
| 요청 합계 | 1GB (`next.config.ts` `proxyClientMaxBodySize`) |
| URL 등록 | 요청당 최대 50건 |

### 헬스체크

`GET /api/health` 는 5개 항목을 병렬 점검합니다.

| 항목 | 필수 여부 |
|------|-----------|
| database | ✅ critical |
| origin_storage | ✅ critical |
| extract_storage | 선택 |
| redis | 선택 (`REDIS_URL` 미설정 시 `skipped`) |
| milvus_broker | 선택 (`MILVUS_BROKER_URL` 미설정 시 `skipped`) |

critical 항목이 하나라도 실패하면 HTTP 503, 전부 정상이면 200 + `status: ok`
(선택 항목만 실패하면 `degraded`).

---

## 검색

`/search` 화면은 한 번의 검색으로 **BM25 / Vector / Hybrid 3종을 동시에 호출**해
나란히 비교합니다 (`Promise.all`).

| 방식 | milvus-broker 엔드포인트 | 점수 처리 |
|------|--------------------------|-----------|
| BM25 | `/v2/collections/sparse/workcenter/{clientServiceId}/partitions/search` | 결과 내 max 기준 **상대 정규화** |
| Vector | `/v2/collections/workcenter/{clientServiceId}/partitions/search` | COSINE 유사도 **절대값** (0~1 clamp) |
| Hybrid | `/v2/collections/hybrid/{clientServiceId}/partitions/search` | 결과 내 max 기준 **상대 정규화** |

- Hybrid ranker: `weighted`, `dense 0.3 / sparse 0.7`
- 인덱스: dense `HNSW/COSINE`, sparse `HNSW/IP`
- 검색어 하이라이트는 **BM25 결과에만** 적용 (어휘 매칭 방식이라 근거가 명확하기 때문)
- HTTP 200이어도 응답 `code != 2000` 이면 실패로 처리

---

## 인증 (미구현)

`lib/auth.ts` 의 `getCurrentUser()` 가 임시 하드코딩 값(`tenant_id: "user01"`, `name: "admin"`)을
반환합니다. **등록자명(`rgst_nm`) 용도로만** 쓰이며, 실제 데이터 격리는
요청의 `clientServiceId`/`tenantId` 로 이뤄집니다.

로그인 도입 시 `lib/auth.ts` 만 세션 조회로 교체하면 됩니다.

---

## 보안

| 항목 | 상태 |
|------|------|
| 인증 | ❌ 미구현 (`lib/auth.ts` 하드코딩) |
| 경로 조작 | 차단 (세그먼트 sanitize + resolve 검증) |
| 파일명 검증 | 100자 제한, 특수문자/널바이트 차단 |
| 파일 크기 | 서버사이드 이중 검증 (Content-Length + 실제 크기) |
| 보안 헤더 | `proxy.ts` — X-Frame-Options: DENY, nosniff, HSTS, Referrer-Policy |
| Rate Limiting | `proxy.ts` — IP 기반, **프로덕션만**. `/api/documents` 20회/분, `/api/search` 60회/분 (인메모리) |
| 업로드 롤백 | DB 저장 실패 시 기록된 파일 자동 삭제 |

---

## 테스트

총 **73개** (`npm run test:run`)

| 파일 | 개수 | 내용 |
|------|------|------|
| `lib/id.test.ts` | 5 | ULID 생성·유일성·정렬 가능성 |
| `lib/validators.test.ts` | 38 | 목록 쿼리, 검색, 파일명/형식/크기 검증 |
| `lib/file-storage.test.ts` | 17 | 경로 sanitize, 저장/읽기/삭제 |
| `api/documents.test.ts` | 13 | 문서 서비스 (목록·상세·생성·삭제) |

> ⚠️ 현재 `api/documents.test.ts` 의 "should create document record with required fields" 1건이
> 실패 상태입니다. 멀티테넌트 도입(`51e5565`)으로 저장 경로가
> `origin/{clientServiceId}/{tenantId}/` 로 바뀐 것을 기대값이 따라가지 못한 것으로,
> 기능 결함이 아니라 **테스트 미갱신**입니다.

---

## 환경변수

| 변수 | 필수 | 설명 |
|------|------|------|
| `DATABASE_URL` | ✅ | MariaDB 접속 (비밀번호 특수문자는 URL 인코딩) |
| `REDIS_URL` | ✅ | Redis Streams |
| `MILVUS_BROKER_URL` | ✅ | 검색 API |
| `EXTRACT_SERVICE_URL` | ✅ | URL 학습 HTTP API |
| `ORIGIN_PATH` / `EXTRACT_PATH` | ✅ | 원본 / 추출 결과 경로 |
| `NEXT_PUBLIC_APP_URL` | ✅ | 앱 외부 접속 주소 |
| `ENABLE_REDIS_CONSUMER` | | `false` 면 consumer 미기동 (로컬 개발용) |
| `MAX_FILE_SIZE_MB` | | 기본 100 |
| `APP_UID` / `APP_GID` | | 컨테이너 실행 uid:gid (docker-compose 전용) |

> `MILVUS_COLLECTION_NAME` 은 **폐기**되었습니다. 컬렉션은 요청의 `clientServiceId` 로 결정됩니다.

---

## 남은 작업

- [ ] 로그인/인증 구현 → `lib/auth.ts` 교체
- [ ] `documents.test.ts` 멀티테넌트 경로 반영 (위 테스트 항목 참조)
- [ ] `DELETE_PARTIAL_FAILURE` 상태의 운영 복구 절차 정립
