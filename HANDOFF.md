# RAG Manager - 연동 가이드

## 1. 시스템 구성

```
┌──────────┐  POST /v1/files  ┌──────────────┐                ┌──────────────┐
│ Client   │─────────────────▶│ rag-manager  │                │    Milvus    │
└──────────┘                  │              │                └──────▲───────┘
                              │  file_status │                       │
                              └──┬────────▲──┘                       │
                                 │ XADD   │ XACK / 상태갱신          │
                                 │        │                          │
                              ┌──▼────────┴──────────────────┐       │
                              │        Redis Streams          │       │
                              │  rag:documents → cg:extract   │       │
                              │  rag:extract   → cg:rag-manager       │
                              └──┬──────────▲──────────▲─────┘       │
                                 │          │          │             │
                                 │ XREAD    │ XADD     │ consume     │
                                 ▼          │          ▼             │
                          ┌──────────────────┐  ┌──────────────┐     │
                          │docs-extract-system│  │milvus-indexer│─────┘
                          └──────┬────────────┘  └──────────────┘
                                 │ JSON 저장
                                 ▼
                          ┌──────────────────┐
                          │ /data/diva/extract  │
                          └──────────────────┘
```

**rag-manager의 통신 대상은 docs-extract-system만**입니다. milvus-indexer 관련 이벤트/상태는 수신하지 않습니다.

---

## 2. DB 스키마

**DB:** `192.168.220.223:3306/extract_document`
**테이블:** `document_files`

| 컬럼 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| uuid | VARCHAR(30) | PK | TSID 기반 고유 ID |
| file_name | VARCHAR(500) | | 원본 파일명 |
| user_key | VARCHAR(100) | | 업로드 사용자 식별 키 (= DNIS = partition_name) |
| file_format | VARCHAR(20) | | pdf/docx/txt/hwp/xlsx/pptx |
| file_status | VARCHAR(20) | UPLOADED | 파일 처리 상태 |
| file_size | BIGINT | | 바이트 |
| rgst_dt | DATETIME | now() | 등록일시 |
| rgst_nm | VARCHAR(100) | | 등록자명 |
| status | VARCHAR(10) | ACTIVE | 문서 관리 상태 (ACTIVE/DELETED) |
| updt_dt | DATETIME | auto | 수정일시 |
| updt_nm | VARCHAR(100) | | 수정자명 |

### 상태 전이 (rag-manager 관점)

```
file_status:
  UPLOADED ──▶ PROCESSING ──▶ EXTRACTED (성공)
                    │
                    └──▶ FAILED (실패)

status (소프트 삭제):
  ACTIVE ──▶ DELETED
```

| file_status | 의미 | 변경 주체 | 트리거 |
|-------------|------|-----------|--------|
| UPLOADED | 업로드 완료 | rag-manager | POST /v1/files |
| PROCESSING | 추출 중 | rag-manager | rag:extract → EXTRACT_STARTED 수신 |
| EXTRACTED | 추출 완료 | rag-manager | rag:extract → EXTRACT_COMPLETED 수신 |
| FAILED | 추출 실패 | rag-manager | rag:extract → EXTRACT_FAILED 수신 |

---

## 3. 파일 저장 구조

```
/data/diva/origin/{uuid}/{원본파일명}     ← rag-manager가 업로드 시 저장 (공유 볼륨)
/data/diva/extract/{uuid}/                   ← docs-extract-system이 추출 결과 JSON 저장 (공유 볼륨)
```

- rag-manager는 `/data/diva/extract`를 **읽기만** 함 (미리보기용)
- 경로는 환경변수(`ORIGIN_PATH`, `EXTRACT_PATH`)로 주입

---

## 4. Redis Streams 연동

### 4.1 연결 정보

| 항목 | 값 |
|------|-----|
| 주소 | 192.168.220.222:6379 |
| DB | 0 |
| 비밀번호 | 없음 |

### 4.2 스트림 구조

| 스트림 키 | 발행자 | 구독자 (Consumer Group) | 이벤트 |
|-----------|--------|-------------------------|--------|
| `rag:documents` | rag-manager | `cg:extract`(docs-extract-system), `cg:milvus`(milvus-indexer) | DOCUMENT_UPLOADED, DOCUMENT_DELETED |
| `rag:extract` | docs-extract-system | `cg:rag-manager`, `cg:milvus` | EXTRACT_STARTED, EXTRACT_COMPLETED, EXTRACT_FAILED |
| `rag:documents:dlq` | 각 consumer | 수동 | 재시도 초과 항목 |
| `rag:extract:dlq` | 각 consumer | 수동 | 재시도 초과 항목 |

### 4.3 rag-manager 발행 (rag:documents)

**DOCUMENT_UPLOADED** — 파일 업로드 완료 후
```json
{
  "event": "DOCUMENT_UPLOADED",
  "uuid": "8sClidpsJpw",
  "file_name": "문서.pdf",
  "file_format": "pdf",
  "file_path": "/data/diva/origin/8sClidpsJpw/문서.pdf",
  "user_key": "user01",
  "timestamp": "2026-04-13T10:30:00.000Z"
}
```

**DOCUMENT_DELETED** — 소프트 삭제 후
```json
{
  "event": "DOCUMENT_DELETED",
  "uuid": "8sClidpsJpw",
  "timestamp": "2026-04-13T11:00:00.000Z"
}
```

### 4.4 rag-manager 구독 (rag:extract, cg:rag-manager)

| 이벤트 | DB 처리 |
|--------|---------|
| `EXTRACT_STARTED` | file_status → PROCESSING |
| `EXTRACT_COMPLETED` | file_status → EXTRACTED |
| `EXTRACT_FAILED` | file_status → FAILED |

메시지 예시:
```json
{
  "event": "EXTRACT_COMPLETED",
  "uuid": "8sClidpsJpw",
  "timestamp": "2026-04-13T10:35:00.000Z"
}
```

### 4.5 재처리 / DLQ

```
XREADGROUP → 처리 성공? → XACK
           → 실패/crash → PEL 잔류
                         → XAUTOCLAIM (30초 주기)
                         → delivery_count ≥ 5 → rag:extract:dlq로 XADD + 원 스트림 XACK
```

---

## 5. 검색 API (milvus-broker)

rag-manager `/api/search` → **milvus-broker** → Milvus

### 5.1 milvus-broker 엔드포인트

| 방식 | URL | 용도 |
|------|-----|------|
| Hybrid (권장) | `POST /v2/collections/hybrid/workcenter/{collection_name}/partitions/search` | BGE-M3 sparse + Dense RRF |
| Dense | `POST /v2/collections/workcenter/{collection_name}/partitions/search` | Vector만 |

- **BM25 단독 엔드포인트 없음** (Hybrid에서만 sparse 포함)
- 인증: 없음. `dnis(= user_key)`로 partition 격리
- 포트: milvus-broker 9005 / Milvus Gateway 8009

### 5.2 요청

```json
{
  "dnis": "user01",
  "message": "검색어",
  "index_info": { "index_type": "HNSW", "metric_type": "L2", "params": {} },
  "limit": 10
}
```

### 5.3 응답

```json
{
  "code": 2000,
  "error_code": null,
  "error_message": null,
  "body": [
    {
      "id": "...",
      "distance": 0.95,
      "entity": {
        "id": "...",
        "file_name": "문서.pdf",
        "chunk_context": "실제 청크 문장",
        "category": "...",
        "sub_category": "..."
      }
    }
  ]
}
```

- `distance`는 L2 거리 (작을수록 유사) → rag-manager에서 UI 표시용 0~1 score로 변환 필요
- `chunk_context`가 snippet으로 표시됨

### 5.4 헬스체크

- `GET /health`
- `GET /ping` → "success"

---

## 6. rag-manager API 스펙

### 6.1 문서 관리

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/documents` | 목록 (page, size, sort, order, search, format, status, file_status) |
| POST | `/api/documents` | 파일 업로드 (multipart, files[]) |
| GET | `/api/documents/{uuid}` | 상세 조회 |
| DELETE | `/api/documents/{uuid}` | 소프트 삭제 |
| POST | `/api/documents/bulk-delete` | 일괄 삭제 (body: `{ids: string[]}`, 최대 100건) |
| GET | `/api/documents/{uuid}/download` | 스트리밍 다운로드 |
| GET | `/api/documents/{uuid}/preview` | 미리보기 (TXT 원본 / EXTRACTED 상태는 /data/diva/extract 내용) |
| POST | `/api/search` | RAG 검색 (query, method, top_k) |
| GET | `/api/health` | 헬스체크 (DB/스토리지 상태) |

### 6.2 업로드 제약

- 형식: pdf, docx, txt, hwp, xlsx, pptx
- 크기: 100MB/파일
- 중복: 동일 user_key + file_name ACTIVE 존재 시 경고
- Rate Limit: IP당 분당 20회 (프로덕션만)

### 6.3 에러 코드

| 코드 | 의미 |
|------|------|
| 400 | 유효성 검증 실패 |
| 404 | 문서/파일 없음 |
| 409 | 이미 삭제된 문서 |
| 410 | 삭제된 문서 다운로드 시도 |
| 429 | Rate Limit 초과 |
| 500 | 서버 오류 |

---

## 7. 보안

| 항목 | 상태 |
|------|------|
| 인증 | **미구현** (임시 하드코딩: user_key=user01, 이름=admin) |
| 파일명 경로 조작 | 차단 (basename + resolve 검증) |
| 파일 크기 제한 | 100MB, 서버사이드 이중 검증 |
| 보안 헤더 | X-Frame-Options, XSS-Protection, HSTS 등 |
| Rate Limiting | IP 기반 (업로드 20/분, 검색 60/분, 프로덕션만) |
| 파일명 검증 | 특수문자/널바이트/255자 제한 |
| 업로드 롤백 | DB 실패 시 저장된 파일 자동 삭제 |

---

## 8. 환경 정보

| 항목 | 값 |
|------|-----|
| DB | mysql://root:aidb!@34@192.168.220.223:3306/extract_document |
| 원본 저장소 | /data/diva/origin |
| 추출 저장소 | /data/diva/extract (읽기 전용) |
| Redis | 192.168.220.222:6379 (db=0) |
| docs-extract-system | 192.168.220.223:9005 |
| milvus-broker | 192.168.220.223:8009 |
| 배포 서버 | 223 (Docker, seri 계정) |
| rag-manager 포트 | 3000 |
| 허용 파일형식 | pdf, docx, txt, hwp, xlsx, pptx |
| 최대 파일크기 | 100MB |
