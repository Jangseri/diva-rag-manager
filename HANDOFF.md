# RAG Manager - 연동 가이드

외부 시스템(docs-extract-system, milvus-indexer, milvus-broker, extract-unstructured)과의
연동 계약을 정리한 문서입니다. 내부 구조는 [DEVELOPMENT.md](DEVELOPMENT.md) 참고.

---

## 1. 시스템 구성

```
                    ┌──────────────────────────────┐
   브라우저 ───────▶│         rag-manager          │
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

rag-manager는 **`rag:extract` 와 `rag:index` 두 스트림을 모두 구독**합니다.
(과거에는 extract만 구독했으나, 인덱싱 완료/실패와 분산 삭제 confirmation을 받기 위해 확장됨)

---

## 2. 멀티테넌시 규약

모든 등록·검색 요청은 두 개의 식별자를 동반합니다.

| 식별자 | 의미 | 쓰임 |
|--------|------|------|
| `clientServiceId` | 서비스(고객사) 단위 | **Milvus 컬렉션명**, 파일 경로 1단계, `document_files.collection_name` |
| `tenantId` | 테넌트(사용자 그룹) 단위 | **Milvus 파티션 키**, 파일 경로 2단계, `document_files.tenant_id` |

- 검색 시 컬렉션은 `clientServiceId`, 파티션 격리는 `tenant_id` 로 이뤄집니다.
- 환경변수 `MILVUS_COLLECTION_NAME` 은 **폐기**되었습니다 (요청값으로 동적 결정).

---

## 3. DB 스키마

**DB:** MariaDB `extract_document` — docs-extract-system과 공유
**rag-manager 소유 테이블:** `document_files`, `processed_events`, `deletion_confirmations`
**docs-extract-system 소유:** `extraction_task`, `alembic_version`

전체 DDL은 [`prisma/init_schema.sql`](prisma/init_schema.sql) 이 정본입니다.

### document_files (주요 컬럼)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| file_id | VARCHAR(26) PK | ULID |
| source_type | VARCHAR(10) | `file` / `url` |
| source_url | VARCHAR(2048) NULL | URL 등록 시 원본 URL |
| file_name | VARCHAR(500) | 파일명 (URL은 `호스트_경로.url` 형태) |
| tenant_id | VARCHAR(100) | 테넌트 = Milvus partition |
| collection_name | VARCHAR(200) NULL | clientServiceId = Milvus collection |
| file_format | VARCHAR(20) NULL | URL 케이스는 NULL |
| file_status | VARCHAR(20) | 처리 상태 |
| status | VARCHAR(30) | 관리 상태 (ACTIVE/DELETING/DELETED/DELETE_PARTIAL_FAILURE) |
| origin_path | VARCHAR(1000) NULL | 원본 절대 경로 |
| retry_count | INT | 재시도 횟수 (최대 3) |
| last_error_code | VARCHAR(50) NULL | 마지막 실패 코드 |

> ⚠️ 과거 문서의 `uuid`, `user_key` 컬럼은 각각 **`file_id`, `tenant_id`** 로 바뀌었습니다.

### 상태 전이

```
file_status:
  UPLOADED ─▶ PROCESSING ─▶ EXTRACTED ─▶ INDEXED
                  │                          │
                  ├─▶ FAILED                 └─▶ INDEX_FAILED

status:
  ACTIVE ─▶ DELETING ─▶ DELETED
                    └─▶ DELETE_PARTIAL_FAILURE
```

| file_status | 트리거 |
|-------------|--------|
| UPLOADED | rag-manager 등록 완료 |
| PROCESSING | `EXTRACT_STARTED` 수신 (또는 재시도 재발행 시) |
| EXTRACTED | `EXTRACT_COMPLETED` 수신 |
| INDEXED | `INDEX_COMPLETED` 수신 |
| FAILED | `EXTRACT_FAILED` 수신 + 재시도 소진 |
| INDEX_FAILED | `INDEX_FAILED` 수신 + 재시도 소진 |

---

## 4. 파일 저장 구조

```
{ORIGIN_PATH}/{clientServiceId}/{tenantId}/{file_id}.{ext}    ← rag-manager 저장
{EXTRACT_PATH}/...                                             ← docs-extract-system 저장
```

- 운영 기준: `ORIGIN_PATH=/data/diva/origin`, `EXTRACT_PATH=/data/diva/extract`
- rag-manager는 `EXTRACT_PATH` 를 **읽기만** 합니다 (미리보기용)
- 두 경로는 rag-manager 컨테이너와 docs-extract-system이 **공유 볼륨**으로 접근해야 합니다

---

## 5. Redis Streams 연동

### 5.1 스트림 구조

| 스트림 | 발행자 | rag-manager 역할 | 이벤트 |
|--------|--------|------------------|--------|
| `rag:documents` | rag-manager | **발행** | DOCUMENT_UPLOADED, DOCUMENT_DELETED |
| `rag:extract` | docs-extract-system | **구독** (`cg:rag-manager`) | EXTRACT_STARTED/COMPLETED/FAILED/DELETED/DELETE_FAILED |
| `rag:index` | milvus-indexer | **구독** (`cg:rag-manager`) | INDEX_COMPLETED/FAILED/DELETED/DELETE_FAILED |
| `rag:*:dlq` | 각 consumer | 수동 처리 | 재시도 초과 |

- Consumer Group: `cg:rag-manager`
- Consumer 이름: `rag-manager-{hostname}-{pid}`
- 발행 시 `MAXLEN ~ 100000` 적용
- 페이로드는 단일 필드 `data` 에 JSON 문자열로 담습니다: `XADD rag:documents * data '<json>'`

### 5.2 공통 필드

모든 이벤트는 아래 3개 필드를 포함합니다.

| 필드 | 설명 |
|------|------|
| `event_id` | 이벤트 고유 ID (ULID). **멱등성 키** |
| `schema_version` | 현재 `"1"` |
| `timestamp` | ISO 8601 |

### 5.3 rag-manager 발행 (`rag:documents`)

**DOCUMENT_UPLOADED** — 파일 등록 완료 후, 그리고 재시도 시 재발행
```json
{
  "event_id": "01JBXK...",
  "event_type": "DOCUMENT_UPLOADED",
  "schema_version": "1",
  "timestamp": "2026-08-13T10:30:00.000Z",
  "file_id": "01JBXK7Q2N4W8ZC3F5H9M1TPVR",
  "tenant_id": "user001",
  "collection_name": "25",
  "file_name": "문서.pdf",
  "file_type": "pdf",
  "file_size": 102400,
  "origin_path": "/data/diva/origin/25/user001/01JBXK7Q2N4W8ZC3F5H9M1TPVR.pdf"
}
```

**DOCUMENT_DELETED** — 삭제 요청 시
```json
{
  "event_id": "01JBXL...",
  "event_type": "DOCUMENT_DELETED",
  "schema_version": "1",
  "timestamp": "2026-08-13T11:00:00.000Z",
  "file_id": "01JBXK7Q2N4W8ZC3F5H9M1TPVR",
  "tenant_id": "user001",
  "collection_name": "25"
}
```

### 5.4 rag-manager 구독

수신 이벤트의 공통 필드 + `file_id` 는 **필수**입니다. 없으면 ACK 후 스킵합니다.
실패 이벤트는 `error_code`, `error_message`, `retryable` 을 함께 보내주세요.

| 스트림 | 이벤트 | rag-manager 처리 |
|--------|--------|------------------|
| `rag:extract` | `EXTRACT_STARTED` | file_status → PROCESSING |
| | `EXTRACT_COMPLETED` | file_status → EXTRACTED |
| | `EXTRACT_FAILED` | 재시도 가능하면 재발행, 아니면 FAILED |
| | `EXTRACT_DELETED` | 삭제 게이트 extract 확인 |
| | `EXTRACT_DELETE_FAILED` | status → DELETE_PARTIAL_FAILURE |
| `rag:index` | `INDEX_COMPLETED` | file_status → INDEXED |
| | `INDEX_FAILED` | 재시도 가능하면 재발행, 아니면 INDEX_FAILED |
| | `INDEX_DELETED` | 삭제 게이트 index 확인 |
| | `INDEX_DELETE_FAILED` | status → DELETE_PARTIAL_FAILURE |

수신 예시:
```json
{
  "event_id": "01JBXM...",
  "event_type": "EXTRACT_FAILED",
  "schema_version": "1",
  "timestamp": "2026-08-13T10:35:00.000Z",
  "file_id": "01JBXK7Q2N4W8ZC3F5H9M1TPVR",
  "tenant_id": "user001",
  "error_code": "EXTRACT_TIMEOUT",
  "error_message": "처리 시간 초과",
  "retryable": true
}
```

### 5.5 멱등성

수신한 `event_id` 는 `processed_events` 테이블에 기록되며, **이미 있으면 스킵**합니다.

> `event_id` 컬럼은 VARCHAR(**100**) 입니다. 이보다 긴 ID를 보내면 저장에 실패합니다.

### 5.6 재처리 / DLQ

```
XREADGROUP (COUNT 16, BLOCK 5s) → 처리 성공 → XACK
                                → 실패/crash → PEL 잔류
                                              → XAUTOCLAIM (30초 주기, idle 60초)
                                              → delivery_count ≥ 5 → {stream}:dlq 로 이동 + XACK
```

애플리케이션 레벨 재시도(추출/인덱싱 재발행)는 `retry_count < 3` 까지입니다.

### 5.7 URL 케이스 주의

`source_type = 'url'` 문서는 **스트림 재발행으로 재시도할 수 없습니다**
(HTTP로 진입한 작업이라 `DOCUMENT_UPLOADED` 재발행이 무의미).
따라서 `EXTRACT_FAILED` / `INDEX_FAILED` 수신 시 `retryable` 값과 무관하게 즉시 실패로 확정합니다.

---

## 6. 분산 삭제 프로토콜

```
사용자 DELETE 요청
  ├─ document_files.status = DELETING
  ├─ deletion_confirmations 생성 (deletion_due_at = now + 5분)
  └─ DOCUMENT_DELETED 발행
        │
        ├── docs-extract-system ──▶ EXTRACT_DELETED  (또는 EXTRACT_DELETE_FAILED)
        └── milvus-indexer      ──▶ INDEX_DELETED    (또는 INDEX_DELETE_FAILED)

  둘 다 확인 ─▶ 원본 파일 unlink ─▶ status = DELETED
  5분 초과   ─▶ timeout-job(1분 주기) ─▶ status = DELETE_PARTIAL_FAILURE
  하나라도 FAILED ────────────────────▶ status = DELETE_PARTIAL_FAILURE
```

**양측 모두 반드시 응답해야 합니다.** 한쪽이 침묵하면 5분 뒤
`DELETE_PARTIAL_FAILURE` 로 확정되어 수동 확인 대상이 됩니다.

URL 문서는 추가로 extract-unstructured에 `DELETE /v1/extract/tasks/url/{file_id}` 도 호출합니다.

---

## 7. 검색 API (milvus-broker)

`rag-manager /api/search` → **milvus-broker** → Milvus

### 7.1 엔드포인트

| 방식 | URL |
|------|-----|
| Hybrid | `POST {BROKER}/v2/collections/hybrid/{clientServiceId}/partitions/search` |
| BM25 (sparse) | `POST {BROKER}/v2/collections/sparse/workcenter/{clientServiceId}/partitions/search` |
| Vector (dense) | `POST {BROKER}/v2/collections/workcenter/{clientServiceId}/partitions/search` |

- 인증 없음. `tenant_id` 로 partition 격리
- 타임아웃 10초

### 7.2 요청

```json
{
  "tenant_id": "user001",
  "message": "검색어",
  "index_info": { "index_type": "HNSW", "metric_type": "COSINE", "params": {} },
  "limit": 5
}
```

| 방식 | index_info | 추가 필드 |
|------|-----------|-----------|
| Vector | `HNSW` / `COSINE` | — |
| BM25 | `HNSW` / `IP` | — |
| Hybrid | `HNSW` / `COSINE` | `ranker: { type: "weighted", weights: { dense: 0.3, sparse: 0.7 } }` |

> 요청 키는 `dnis` 가 아니라 **`tenant_id`** 입니다 (구 스펙에서 변경됨).

### 7.3 응답

```json
{
  "code": 2000,
  "errCode": null,
  "errMessage": null,
  "body": [
    {
      "id": "...",
      "distance": 0.87,
      "entity": {
        "id": "...",
        "file_name": "문서.pdf",
        "chunk_context": "실제 청크 문장",
        "category": "...",
        "sub_category": "page_3",
        "url": "..."
      }
    }
  ]
}
```

- **HTTP 200이어도 `code != 2000` 이면 실패**로 처리합니다 (에러 필드는 `errCode`/`errMessage`)
- `sub_category` 가 `page_N` 형태면 스니펫 앞에 `[p.N]` 으로 표시
- 점수 처리:
  - **Vector** — COSINE 유사도는 절대 척도이므로 원본값 유지 (0~1 clamp)
  - **BM25 / Hybrid** — IP·가중 융합 점수는 절대 척도가 아니므로 결과 내 max 기준 상대 정규화

### 7.4 헬스체크

`GET /health` — rag-manager `/api/health` 의 `milvus_broker` 항목에서 호출

---

## 8. URL 학습 API (extract-unstructured)

rag-manager `/api/documents/url` → **extract-unstructured** HTTP 호출 (동기)

### 8.1 등록

`POST {EXTRACT_SERVICE_URL}/v1/extract/tasks/url`

```json
{
  "file_id": "01JBXK7Q2N4W8ZC3F5H9M1TPVR",
  "url": "https://example.com/docs",
  "tenant_id": "user001",
  "collection_name": "25",
  "crawler_options": {
    "max_pages": 10,
    "max_depth": 2,
    "allow_external_links": false
  }
}
```

| crawler_options | 범위 |
|-----------------|------|
| `max_pages` | 1 ~ 500 |
| `max_depth` | 0 ~ 10 |
| `allow_external_links` | boolean |

### 8.2 삭제

`DELETE {EXTRACT_SERVICE_URL}/v1/extract/tasks/url/{file_id}`

### 8.3 응답 규약

```json
{ "success": true, "data": { ... }, "message": null, "code": 200 }
```

`success: false` 이거나 HTTP 에러면 실패로 처리합니다. 타임아웃 10초.

### 8.4 URL → file_name 규칙

`https://www.example.com/about?x=1` → `www.example.com_about_x=1.url` (100자 초과 시 절단)
`http(s)` 만 허용하며, 요청당 최대 50건입니다.

---

## 9. rag-manager API 스펙

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/documents` | 목록 (page, size, sort, order, search, format, status, file_status, clientServiceId, tenantId) |
| POST | `/api/documents` | 파일 업로드 (multipart: `files[]`, `clientServiceId`, `tenantId`) |
| POST | `/api/documents/url` | URL 등록 (`urls[]`, `crawler_options`, identity) |
| GET | `/api/documents/{file_id}` | 상세 |
| DELETE | `/api/documents/{file_id}` | 삭제 요청 |
| POST | `/api/documents/bulk-delete` | 일괄 삭제 (`{ids}`, 최대 100건) |
| GET | `/api/documents/{file_id}/download` | 스트리밍 다운로드 |
| GET | `/api/documents/{file_id}/preview` | 원본/추출 미리보기 |
| POST | `/api/search` | RAG 검색 (`query`, `method`, `top_k`, identity) |
| GET | `/api/health` | 헬스체크 |

**`clientServiceId` + `tenantId` 는 등록·검색 요청에 필수**입니다 (누락 시 400).

### 업로드 제약

| 항목 | 값 |
|------|-----|
| 형식 | pdf, docx, pptx, xlsx, hwp, hwpx, txt, md, json, jpg, jpeg, png |
| 파일명 | 100자 이하, 특수문자/널바이트 금지 |
| 파일당 | 100MB |
| 요청 합계 | 1GB |
| Rate Limit | IP 기반, 프로덕션만 — `/api/documents` 20회/분, `/api/search` 60회/분 |

### 에러 코드

| HTTP | 의미 |
|------|------|
| 400 | 유효성 검증 실패 / identity 누락 |
| 404 | 문서·파일 없음 |
| 409 | 이미 삭제(또는 삭제 중)인 문서 |
| 410 | 삭제된 문서 다운로드 시도 |
| 429 | Rate Limit 초과 |
| 500 | 서버 오류 |
| 502 | 검색 서비스 비정상 응답 |
| 503 | 검색 서비스 연결 불가/타임아웃, 헬스체크 critical 실패 |

### 외부 error_code 매핑

`lib/error-codes.ts` — 미등록 코드는 "처리 중 오류가 발생했습니다"로 표시됩니다.

| code | 사용자 메시지 |
|------|---------------|
| UNSUPPORTED_FORMAT | 지원하지 않는 파일 형식입니다 |
| FILE_CORRUPTED | 파일이 손상되어 처리할 수 없습니다 |
| FILE_TOO_LARGE | 파일 크기가 제한을 초과했습니다 |
| EXTRACT_TIMEOUT | 처리 시간이 초과되었습니다. 재시도됩니다 |
| GPU_OOM | 서버 자원이 부족하여 재시도됩니다 |
| OCR_FAILED | 문자 인식에 일시적인 오류가 발생했습니다. 재시도됩니다 |
| INTERNAL_ERROR | 내부 처리 오류가 발생했습니다. 재시도됩니다 |

---

## 10. 환경 정보 (기존 운영 서버)

> 신규 서버 구축 시 아래 값은 모두 교체 대상입니다. [DEPLOY.md](DEPLOY.md) 참고.

| 항목 | 값 |
|------|-----|
| 배포 서버 | 192.168.220.223 (Docker, seri 계정 uid 1007 / gid 1012) |
| rag-manager | :3000 |
| DB | 192.168.220.223:3306 / `extract_document` (MariaDB 10.11) |
| Redis | 192.168.220.222:6379 (db=0, 비밀번호 없음) |
| milvus-broker | 192.168.220.223:8009 |
| extract-unstructured | 192.168.220.223:9005 |
| 원본 저장소 | /data/diva/origin |
| 추출 저장소 | /data/diva/extract (읽기 전용) |
