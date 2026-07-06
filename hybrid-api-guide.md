# Hybrid RAG API 가이드 (collection · partition · 문서 · 검색)

> Milvus 기반 Hybrid(Dense + Sparse) RAG API. 외부 연동(적재·검색)용 레퍼런스.
> Dense = KURE-v1(1024d), Sparse = BGE-M3. 융합 = weighted ranker(dense 0.3 / sparse 0.7 기본).

> ⚠️ **2026-07-06 검증 결과 반영**: 검색(§6~§7.1) API의 body 키가 `dnis` → **`tenant_id`** 로 변경됨을
> `192.168.220.223:8009` 실제 호출로 확인했습니다. `index_info.params`도 `{"ef": 100}` 없이 `{}`로 보내도
> 정상 동작함을 확인했습니다. **검증은 검색 API(POST `/partitions/search` 계열, dense/sparse/hybrid)에
> 한정**되며, collection/partition 생성·문서 적재·삭제 API(§3~§5, §9)는 아직 `dnis` 표기 기준 미검증 상태이니
> 실제 호출 전 재확인하세요.

---

## 1. 공통 규약

### 1.1 Base URL
```
http://{host}:{port}        # 예: http://192.168.220.223:8009
```

### 1.2 경로 구조

**Hybrid (dense+sparse 융합) 검색**
```
/v2/collections/hybrid/{collection_name}/partitions/...
                        │
                        └ collection_name = 서비스/컬렉션 식별자 (= clientServiceId)
```
> ⚠️ 과거 경로의 고정 `workcenter` 세그먼트는 hybrid 경로에서 **제거**되었습니다.
> 구경로 `/v2/collections/hybrid/workcenter/...` 는 **deprecated alias** 로 한시 유지되나, 신규 연동은 위 신경로를 사용하세요.

**Dense 전용 / Sparse 전용 검색**은 동일 collection(hierarchical hybrid 스키마)에 대해 `workcenter` 세그먼트를 유지합니다.
```
/v2/collections/workcenter/{collection_name}/partitions/search           # Dense 전용
/v2/collections/sparse/workcenter/{collection_name}/partitions/search    # Sparse 전용
```
세 검색 API 모두 같은 collection/partition 데이터를 대상으로 하며, 어떤 벡터 공간(dense만 / sparse만 / 융합)을 쓸지만 다릅니다.

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
| 4 | Hybrid 검색 (권장) | POST | `/v2/collections/hybrid/{collection_name}/partitions/search` |
| 5 | Hybrid 검색 (간편) | GET | `/v2/collections/hybrid/{collection_name}/partitions/{dnis}/search` |
| 6 | Dense 전용 검색 | POST | `/v2/collections/workcenter/{collection_name}/partitions/search` |
| 7 | Sparse 전용 검색 | POST | `/v2/collections/sparse/workcenter/{collection_name}/partitions/search` |
| 8 | 전체 문서 조회 | GET | `/v2/collections/hybrid/{collection_name}/partitions/{dnis}/docs` |
| 9 | 문서 삭제(파일 단위) | DELETE | `/v2/collections/hybrid/{collection_name}/partitions/{dnis}/docs` |

> #3~#9 중 `{dnis}` 표기는 §3~§5, §9(미검증 구간)에 남겨둔 것입니다. 검증된 검색 API(§6 이하)의 실제 body 키는 `tenant_id` 입니다.

---

## 3. Collection 생성 (미검증 — `dnis` 표기 유지)

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

## 4. Partition 생성 (미검증 — `dnis` 표기 유지)

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

## 5. 문서 적재 (미검증 — `dnis` 표기 유지)

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

## 6. Hybrid 검색 (POST, 권장) — ✅ 검증 완료

```
POST /v2/collections/hybrid/{collection_name}/partitions/search
```
Dense + Sparse 양쪽 ANN 검색 후 ranker 로 융합하여 top-K 반환.

**Request body** (검증된 실제 예시)
```json
{
  "tenant_id": "01KVQ9F5PVJ54YWQ9KX7TF58RG",
  "message": "대표번호 변경 방법이 뭐야",
  "index_info": { "index_type": "HNSW", "metric_type": "COSINE", "params": {} },
  "limit": 3,
  "ranker": { "type": "weighted", "weights": { "dense": 0.3, "sparse": 0.7 } }
}
```

| 필드 | 필수 | 설명 |
|---|---|---|
| `tenant_id` | ✅ | 검색 대상 partition 이름 (구 `dnis`) |
| `message` | ✅ | 검색 쿼리 문장 |
| `index_info` | ✅ | `metric_type`(**COSINE**, dense 기준)·`params`(빈 객체 `{}`로도 정상 동작 확인) |
| `limit` | ✗ | Top-K. 생략 시 서버 SearchProfile, 없으면 10 |
| `ranker` | ✗ | 융합 방식 오버라이드 — 생략 시 서버 기본값(`weighted`, dense 0.3/sparse 0.7)과 동일하나, 명시 전달 권장. `{"type":"rrf","k":60}` 도 가능 |
| `filter` | ✗ | `{"expr": "...", "boosts": [...]}` — hard filter + soft boost 오버라이드 |
| `groupByParent` | ✗ | hierarchical 컬렉션에서 child 를 parent 로 묶어 반환 (기본 `false`) |
| `applyKeywordBoost` | ✗ | 쿼리 명사 추출 → `nouns` 필터 합성 (hierarchical 전용) |

**응답**: 성공 `2000`(결과 0건 포함) · 검색 실패 `3000`/`ER3000` (§8 응답 본문 참고)

**검증 결과**: collection `25`, tenant_id `01KVQ9F5PVJ54YWQ9KX7TF58RG`, 질의 "대표번호 변경 방법이 뭐야" →
weighted(0.3, 0.7) 융합 결과 dense 1위 hit가 가장 높은 스코어(0.648)로 재확인됨.

---

## 6.1 Dense 전용 검색 (POST) — ✅ 검증 완료

```
POST /v2/collections/workcenter/{collection_name}/partitions/search
```
Dense(KURE-v1) ANN 만 수행. `workcenter` 세그먼트 유지.

**Request body** (검증된 실제 예시)
```json
{
  "tenant_id": "01KVQ9F5PVJ54YWQ9KX7TF58RG",
  "message": "대표번호 변경 방법이 뭐야",
  "index_info": { "index_type": "HNSW", "metric_type": "COSINE", "params": {} },
  "limit": 3
}
```
`ranker`/`filter` 등 융합 관련 필드는 사용되지 않습니다.

**검증 결과**: 1위 hit "등록된 번호 중 대표번호 변경 가능... 상태 확인 후 수정 요청 가능" (distance 0.716, COSINE이라 클수록 유사).

---

## 6.2 Sparse 전용 검색 (POST) — ✅ 검증 완료

```
POST /v2/collections/sparse/workcenter/{collection_name}/partitions/search
```
Sparse(BGE-M3) 키워드 기반 검색만 수행.

**Request body** (검증된 실제 예시)
```json
{
  "tenant_id": "01KVQ9F5PVJ54YWQ9KX7TF58RG",
  "message": "대표번호 변경 방법이 뭐야",
  "index_info": { "index_type": "HNSW", "metric_type": "IP", "params": {} },
  "limit": 3
}
```
> Dense 와 달리 `metric_type` 은 **`IP`**(inner product) 입니다. `ranker` 는 무시됩니다(fusion 불필요).

**검증 결과**: 1위 hit "대표번호 등록은 1회 등록으로 계속 사용... 재등록을 진행해 주세요" — 키워드 매칭 기반이라 dense와 다른 청크가 1위로 나옴.

---

## 7. Hybrid 검색 (GET, 간편, 미검증 — `dnis` 표기 유지)

```
GET /v2/collections/hybrid/{collection_name}/partitions/{dnis}/search?message=...&limit=10
```
- query param: `message`(✅, URL 인코딩), `limit`(✗, 기본 10)
- **SearchProfile 의 ranker/filter/adaptive topK 미적용**, metric 은 서버 config(`dense_metric`) 고정. 튜닝이 필요하면 POST 사용.
- `message` 누락 시 `4999`/`ER4999`
- 경로 파라미터명이 POST와 동일하게 `tenant_id` 로 바뀌었는지는 미검증입니다.

### 검색 응답 본문 (§6·§6.1·§6.2·§7 공통)
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

## 8. 전체 문서 조회 (미검증 — `dnis` 표기 유지)

```
GET /v2/collections/hybrid/{collection_name}/partitions/{dnis}/docs
```
지정 partition 의 전체 문서를 반환합니다. **응답**: `2000`, `body` = 문서 배열(§7 entity 필드 구조).

---

## 9. 문서 삭제 (파일 단위, 미검증 — `dnis` 표기 유지)

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
| 검색 API body 키 (§6~§6.2) | `tenant_id` | partition 이름 (= tenantId). **2026-07-06 검증 완료**, 과거 `dnis` 표기에서 변경됨 |
| 적재/삭제/생성 API body 키 (§3~§5, §7, §9) | `dnis` | partition 이름 (= tenantId). **미검증** — 검색 API와 동일하게 `tenant_id` 로 바뀌었을 가능성이 높으니 사용 전 재확인 |

> 적재 측과 검색 측은 `collection_name`·partition 식별자·필드명(§5 `milvusDocs[]`)을 동일하게 맞춰야 검색 결과가 정상적으로 채워집니다.

---

## 11. curl 예시

```bash
BASE=http://192.168.220.223:8009
COL=25                                  # = clientServiceId (collection_name)
TENANT=01KVQ9F5PVJ54YWQ9KX7TF58RG       # = tenantId (partition)

# 1) Hybrid 검색 (검증됨)
curl -X POST "$BASE/v2/collections/hybrid/$COL/partitions/search" \
  -H 'Content-Type: application/json' \
  -d '{
    "tenant_id": "'"$TENANT"'",
    "message": "대표번호 변경 방법이 뭐야",
    "index_info": {"index_type":"HNSW","metric_type":"COSINE","params":{}},
    "limit": 3,
    "ranker": {"type":"weighted","weights":{"dense":0.3,"sparse":0.7}}
  }'

# 2) Dense 전용 검색 (검증됨)
curl -X POST "$BASE/v2/collections/workcenter/$COL/partitions/search" \
  -H 'Content-Type: application/json' \
  -d '{
    "tenant_id": "'"$TENANT"'",
    "message": "대표번호 변경 방법이 뭐야",
    "index_info": {"index_type":"HNSW","metric_type":"COSINE","params":{}},
    "limit": 3
  }'

# 3) Sparse 전용 검색 (검증됨)
curl -X POST "$BASE/v2/collections/sparse/workcenter/$COL/partitions/search" \
  -H 'Content-Type: application/json' \
  -d '{
    "tenant_id": "'"$TENANT"'",
    "message": "대표번호 변경 방법이 뭐야",
    "index_info": {"index_type":"HNSW","metric_type":"IP","params":{}},
    "limit": 3
  }'

# 4) 문서 적재 (미검증 — dnis 표기 그대로, 재확인 필요)
curl -X POST "$BASE/v2/collections/hybrid/$COL/partitions/$TENANT/docs" \
  -H 'Content-Type: application/json' \
  -d '{"dnis":"'"$TENANT"'","milvusDocs":[{"context":"환불은 7일 이내 가능합니다","fileName":"환불규정.pdf","category":"NarrativeText","subCategory":"page_1","url":""}],"usedChunk":true}'
```

> Swagger UI: `http://{host}:{port}/docs` (Tag: `Hybrid`)
