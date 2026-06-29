# Hybrid RAG API 가이드 (collection · partition · 문서 · 검색)

> Milvus 기반 Hybrid(Dense + Sparse) RAG API. 외부 연동(적재·검색)용 레퍼런스.
> Dense = KURE-v1(1024d), Sparse = BGE-M3. 융합 = weighted ranker(dense 0.3 / sparse 0.7 기본).

---

## 1. 공통 규약

### 1.1 Base URL
```
http://{host}:{port}        # 예: http://192.168.220.223:8009
```

### 1.2 경로 구조
```
/v2/collections/hybrid/{collection_name}/partitions/{dnis}/...
                        │                            │
                        │                            └ dnis = partition 식별자 (= tenantId)
                        └ collection_name = 서비스/컬렉션 식별자 (= clientServiceId)
```

> ⚠️ 과거 경로의 고정 `workcenter` 세그먼트는 **제거**되었습니다.
> 구경로 `/v2/collections/hybrid/workcenter/...` 는 **deprecated alias** 로 한시 유지되나, 신규 연동은 위 신경로를 사용하세요.

### 1.3 응답 envelope (모든 API 공통)
모든 응답은 `StandardResponse` 로 감쌉니다. **성공 판정은 반드시 `code == 2000`** 으로 합니다
(HTTP status 가 아니라 envelope 의 `code` 가 비즈니스 결과입니다).

```json
{ "code": 2000, "errCode": null, "errMessage": null, "body": null }
```

> JSON 키는 camelCase(`errCode`/`errMessage`).

### 1.4 공통 에러 코드

| code | errCode | 의미 | 발생 위치 |
|---|---|---|---|
| `2000` | – | 성공 (검색은 결과 0건도 성공) | 전체 |
| `2001` | – | collection 이 이미 존재 | collection 생성 |
| `3000` | `ER3000` | 검색 실패 (collection/partition 없음, Milvus 연결/임베딩 오류 등) | 검색 |
| `4999` | `ER4999` | collection 없음 / 필수 파라미터 누락 | partition 생성, GET 검색 |
| `5007` | `ER5007` | 문서 저장 실패 (입력 데이터 확인) | 문서 적재 |

---

## 2. API 목록

| # | 목적 | 메서드 | 경로 |
|---|---|---|---|
| 1 | Collection 생성 | POST | `/v2/collections/hybrid/{collection_name}` |
| 2 | Partition 생성 | POST | `/v2/collections/hybrid/{collection_name}/partitions` |
| 3 | 문서 적재 | POST | `/v2/collections/hybrid/{collection_name}/partitions/{dnis}/docs` |
| 4 | 검색 (권장) | POST | `/v2/collections/hybrid/{collection_name}/partitions/search` |
| 5 | 검색 (간편) | GET | `/v2/collections/hybrid/{collection_name}/partitions/{dnis}/search` |
| 6 | 전체 문서 조회 | GET | `/v2/collections/hybrid/{collection_name}/partitions/{dnis}/docs` |
| 7 | 문서 삭제(파일 단위) | DELETE | `/v2/collections/hybrid/{collection_name}/partitions/{dnis}/docs` |

---

## 3. Collection 생성

```
POST /v2/collections/hybrid/{collection_name}
```
Hybrid(dense + sparse) collection 을 V3Hierarchical 스키마로 생성합니다.

**Request body**
```json
{
  "dnis": "unused",
  "indexInfo": { "index_type": "HNSW", "metric_type": "COSINE", "params": { "ef": 100 } }
}
```

| 필드 | 필수 | 설명 |
|---|---|---|
| `dnis` | ✅ | 스키마 공유로 필수지만 **collection 생성에는 사용되지 않음** |
| `indexInfo.index_type` | ✅ | `HNSW` 등 |
| `indexInfo.metric_type` | ✅ | **`COSINE`** (KURE-v1 dense 인덱스 기준). 인덱스와 불일치 시 검색 에러 |
| `indexInfo.params` | ✅ | HNSW 는 `{"ef": 100}` |

**응답**: 성공 `2000`(HTTP 201) · 이미 존재 `2001`

---

## 4. Partition 생성

```
POST /v2/collections/hybrid/{collection_name}/partitions
```

**Request body**
```json
{
  "dnis": "user01",
  "indexInfo": { "index_type": "HNSW", "metric_type": "COSINE", "params": { "ef": 100 } }
}
```

| 필드 | 필수 | 설명 |
|---|---|---|
| `dnis` | ✅ | **생성할 partition 이름** (= tenantId) |
| `indexInfo` | ✅ | 스키마 공유로 필수지만 **partition 생성에는 사용되지 않음** (collection 의 기존 인덱스를 따름) |

**응답**: 성공 `2000`(HTTP 201) · collection 없음 `4999`/`ER4999`
> **idempotent**: 동일 이름 partition 이 이미 있으면 새로 만들지 않고 성공 처리합니다.

---

## 5. 문서 적재

```
POST /v2/collections/hybrid/{collection_name}/partitions/{dnis}/docs
```
지정 partition 에 문서를 dense + sparse 임베딩하여 저장합니다.

**Request body**
```json
{
  "dnis": "user01",
  "milvusDocs": [
    {
      "context": "환불은 결제일로부터 7일 이내 가능합니다.",
      "fileName": "환불규정.pdf",
      "category": "NarrativeText",
      "subCategory": "page_1",
      "url": ""
    }
  ],
  "usedChunk": true,
  "chunker": "hierarchical"
}
```

| 필드 | 필수 | 설명 |
|---|---|---|
| `dnis` | ✅ | 대상 partition 이름 |
| `milvusDocs[]` | ✅ | 적재할 문서 배열 (아래 항목 구조) |
| `usedChunk` | ✅ | `true` 시 서버에서 자동 청킹 |
| `chunker` | ✗ | `sentence`(기본) / `semantic` / `hierarchical`. hierarchical 은 parent/child + nouns 필드 생성 |

**`milvusDocs[]` 항목**

| 키 | 설명 | 저장 필드 매핑 |
|---|---|---|
| `context` | 청크 본문 | `chunk_context` |
| `fileName` | 원본 파일명 | `file_name` |
| `category` | Element 타입 (NarrativeText, Title, ListItem 등) | `category` |
| `subCategory` | 페이지 정보 (`page_1` 형태) | `sub_category` |
| `url` | 원본 URL(선택) | `url` |

**응답**: 성공 `2000`(HTTP 201) · 저장 실패 `5007`/`ER5007`

---

## 6. 검색 (POST, 권장)

```
POST /v2/collections/hybrid/{collection_name}/partitions/search
```
Dense + Sparse 양쪽 ANN 검색 후 ranker 로 융합하여 top-K 반환.

**Request body**
```json
{
  "dnis": "user01",
  "message": "환불 규정 알려줘",
  "indexInfo": { "index_type": "HNSW", "metric_type": "COSINE", "params": { "ef": 100 } },
  "limit": 5
}
```

| 필드 | 필수 | 설명 |
|---|---|---|
| `dnis` | ✅ | 검색 대상 partition 이름 |
| `message` | ✅ | 검색 쿼리 문장 |
| `indexInfo` | ✅ | `metric_type`(**COSINE**)·`params` 가 검색에 실제 사용됨 |
| `limit` | ✗ | Top-K. 생략 시 서버 SearchProfile, 없으면 10 |
| `ranker` | ✗ | 융합 방식 오버라이드 — `{"type":"weighted","weights":{"dense":0.3,"sparse":0.7}}` 또는 `{"type":"rrf","k":60}` |
| `filter` | ✗ | `{"expr": "...", "boosts": [...]}` — hard filter + soft boost 오버라이드 |
| `groupByParent` | ✗ | hierarchical 컬렉션에서 child 를 parent 로 묶어 반환 (기본 `false`) |
| `applyKeywordBoost` | ✗ | 쿼리 명사 추출 → `nouns` 필터 합성 (hierarchical 전용) |

**응답**: 성공 `2000`(결과 0건 포함) · 검색 실패 `3000`/`ER3000` (§7 응답 본문 참고)

---

## 7. 검색 (GET, 간편)

```
GET /v2/collections/hybrid/{collection_name}/partitions/{dnis}/search?message=...&limit=10
```
- query param: `message`(✅, URL 인코딩), `limit`(✗, 기본 10)
- **SearchProfile 의 ranker/filter/adaptive topK 미적용**, metric 은 서버 config(`dense_metric`) 고정. 튜닝이 필요하면 POST 사용.
- `message` 누락 시 `4999`/`ER4999`

### 검색 응답 본문 (§6·§7 공통)
`body` 는 hit 배열입니다.

```json
{
  "code": 2000, "errCode": null, "errMessage": null,
  "body": [
    {
      "id": "550e8400-...",
      "distance": 0.92,
      "entity": {
        "id": "550e8400-...",
        "file_name": "환불규정.pdf",
        "chunk_context": "환불은 결제일로부터 7일 이내...",
        "category": "NarrativeText",
        "sub_category": "page_1",
        "url": "",
        "parent_id": "...",
        "parent_context": "...",
        "nouns": ["환불", "규정"]
      }
    }
  ]
}
```

| 필드 | 설명 |
|---|---|
| `id` | 청크 PK |
| `distance` | **정규화된 융합 점수** (높을수록 관련도 높음, L2 거리 아님) |
| `entity.file_name` | 원본 파일명 |
| `entity.chunk_context` | 청크 본문(매칭 텍스트) |
| `entity.category` / `sub_category` | Element 타입 / 페이지 정보 |
| `entity.url` | 원본 URL |
| `entity.parent_id` / `parent_context` / `nouns` | V3Hierarchical 전용 (`groupByParent=true` 시 parent 단위 묶음 반환) |

---

## 8. 전체 문서 조회

```
GET /v2/collections/hybrid/{collection_name}/partitions/{dnis}/docs
```
지정 partition 의 전체 문서를 반환합니다. **응답**: `2000`, `body` = 문서 배열(§7 entity 필드 구조).

---

## 9. 문서 삭제 (파일 단위)

```
DELETE /v2/collections/hybrid/{collection_name}/partitions/{dnis}/docs
```

**Request body**
```json
{ "dnis": "user01", "fileName": "환불규정.pdf" }
```

| 필드 | 필수 | 설명 |
|---|---|---|
| `dnis` | ✅ | 대상 partition 이름 |
| `fileName` | ✅ | 삭제할 파일명 (해당 파일의 모든 청크 삭제) |

**응답**: `2000`

---

## 10. 식별자 정리 (외부 적재 시 맞출 것)

| 위치 | 값 | 의미 |
|---|---|---|
| 경로 `{collection_name}` | `clientServiceId` | 서비스/컬렉션 식별자 — 적재·검색이 **문자열 완전 일치**해야 함 |
| `dnis` (path/body) | `tenantId` | partition 이름 — `dnis` 는 레거시 키명이며 실제 값은 partition(tenantId) |

> 적재 측과 검색 측은 `collection_name`·`dnis`·필드명(§5 `milvusDocs[]`)을 동일하게 맞춰야 검색 결과가 정상적으로 채워집니다.

---

## 11. curl 예시

```bash
BASE=http://192.168.220.223:8009
COL=my_service          # = clientServiceId
DNIS=user01             # = tenantId (partition)

# 1) 문서 적재 (서버 자동 청킹)
curl -X POST "$BASE/v2/collections/hybrid/$COL/partitions/$DNIS/docs" \
  -H 'Content-Type: application/json' \
  -d '{"dnis":"'"$DNIS"'","milvusDocs":[{"context":"환불은 7일 이내 가능합니다","fileName":"환불규정.pdf","category":"NarrativeText","subCategory":"page_1","url":""}],"usedChunk":true}'

# 2) Hybrid 검색
curl -X POST "$BASE/v2/collections/hybrid/$COL/partitions/search" \
  -H 'Content-Type: application/json' \
  -d '{"dnis":"'"$DNIS"'","message":"환불 규정 알려줘","indexInfo":{"index_type":"HNSW","metric_type":"COSINE","params":{"ef":100}},"limit":5}'
```

> Swagger UI: `http://{host}:{port}/docs` (Tag: `Hybrid`)
