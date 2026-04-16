# [Proposal] 인덱싱·삭제 lifecycle — 독립 처리 + Confirmation 발행

> 발신: docs-extract-system 팀
> 수신: milvus-indexer 팀, rag-manager 팀
> 작성일: 2026-04-15
> 상태: **제안 (합의 필요)**

---

## 1. 배경

### 1.1 발견된 문제
1. **삭제 잔류**: rag-manager 에서 파일 삭제 시 milvus 가 `rag:documents` 미구독 → 벡터 잔류
2. **인덱싱 완료 신호 부재**: milvus 가 인덱싱을 끝내도 rag-manager 가 확정할 신호가 없어 `file_status=INDEXED` 전이 불가 (현재 `EXTRACTED` 에서 멈춤)

두 문제 모두 본질은 **"각 서비스가 자기 처리 결과를 외부에 통보하지 않음"**. 같은 패턴으로 해결.

### 1.2 핵심 우려
**고객 입장에서 학습 데이터의 즉시 반영이 critical**. 잔류·인덱싱 지연은 정확도 저하로 이어지므로 정합성과 lifecycle 가시성이 절대 우선.

---

## 2. 원칙

| 원칙 | 의미 |
|------|------|
| **도메인 분리** | milvus=벡터, extract=추출 결과·DB·캐시, rag-manager=원본 파일·비즈니스 상태. 각자 자기 것만 처리 |
| **자체 책임** | 각 서비스는 자기 처리 실패에 대해 자체 재시도/DLQ/관측. 외부에서 떠안지 않음 |
| **결과 발행** | 자체 처리 결과(성공/실패)를 이벤트로 외부에 통보 |
| **트리거 체인 제거** | 한 이벤트(`DOCUMENT_DELETED`)가 여러 처리를 동시 트리거. 직렬 chain 아님 |
| **정합성 gate** | 원본 파일 unlink는 모든 confirmation 받은 후만 — rag-manager 가 gate 역할 |

---

## 3. 흐름도

### 3.1 인덱싱 (생성) lifecycle

```
[Client] → POST /v1/files
     │
     ▼
[rag-manager] file_status = UPLOADED
     │ DOCUMENT_UPLOADED → rag:documents
     ▼
[docs-extract-system]
     ① EXTRACT_STARTED  → rag:extract
     ② 추출 수행
     ③ EXTRACT_COMPLETED → rag:extract       (실패 시 EXTRACT_FAILED)
                             │
        ┌────────────────────┴────────────────────┐
        ▼                                         ▼
  [rag-manager]                            [milvus-indexer]
  status = EXTRACTED                       ④ 벡터화·저장
                                           ⑤ INDEX_COMPLETED → rag:index
                                              (실패 시 INDEX_FAILED)
                                                       │
                                                       ▼
                                              [rag-manager]
                                              status = INDEXED  ✅
                                              (또는 INDEX_FAILED 시 alert)
```

### 3.2 삭제 lifecycle
   │ DELETE /v1/files/{file_id}
   ▼
[rag-manager]
   ① file_status = DELETING            (원본 파일은 보존)
   ② DOCUMENT_DELETED 발행 → rag:documents
   ③ HTTP 202 응답
                                  ┌─────────────────┐
                                  │ rag:documents   │
                                  └────┬───────┬────┘
                                       │       │
                          ┌────────────┘       └────────────┐
                          ▼                                 ▼
                   [milvus-indexer]                 [docs-extract-system]
                   ④a 벡터 삭제                      ④b JSON+DB+캐시 삭제
                   ⑤a INDEX_DELETED 발행             ⑤b EXTRACT_DELETED 발행
                   (실패 시 INDEX_DELETE_FAILED)     (실패 시 EXTRACT_DELETE_FAILED)
                   → rag:index                       → rag:extract
                                  │                       │
                                  └───────────┬───────────┘
                                              ▼
                                       [rag-manager]
                          ⑥ 두 성공 confirmation 모두 수신 시
                             → 원본 unlink + status = DELETED
                          ⑦ 부분 실패 시 status = DELETE_PARTIAL_FAILURE
                             → 운영 알림, 재시도 정책 적용 (원본은 보존)
```

### 핵심
- ④a, ④b는 **병렬**. 서로 알지 못함
- 어느 한 쪽이 죽어있어도 다른 쪽은 진행
- ⑥ confirmation gate가 정합성 보장
- 원본 파일은 **모든 confirmation 받기 전까지 절대 unlink 안 됨**

---

## 4. 새 이벤트 스펙

### 4.0 `INDEX_COMPLETED` (milvus → rag:index)

```json
{
  "event_id": "01K...",
  "event_type": "INDEX_COMPLETED",
  "schema_version": "1",
  "timestamp": "2026-04-15T12:00:00+00:00",
  "file_id": "01K...",
  "user_key": "01012345678",
  "collection_name": "llm_workcenter_v2",
  "indexed_count": 142
}
```

| 필드 | 비고 |
|------|------|
| `indexed_count` | 저장된 벡터 엔트리 수 (chunk 단위) |

### 4.0a `INDEX_FAILED` (milvus → rag:index)

```json
{
  "event_id": "...",
  "event_type": "INDEX_FAILED",
  "schema_version": "1",
  "timestamp": "...",
  "file_id": "...",
  "user_key": "...",
  "collection_name": "...",
  "error_code": "EMBEDDING_TIMEOUT",
  "error_message": "...",
  "retryable": true
}
```

### 4.1 `INDEX_DELETED` (milvus → rag:index)

```json
{
  "event_id": "01K...",
  "event_type": "INDEX_DELETED",
  "schema_version": "1",
  "timestamp": "2026-04-15T12:00:00+00:00",
  "file_id": "01K...",
  "user_key": "01012345678",
  "collection_name": "llm_workcenter_v2",
  "deleted_count": 42
}
```

| 필드 | 비고 |
|------|------|
| `deleted_count` | 삭제된 벡터 엔트리 수 (0 이어도 정상 — 원래 인덱싱 안 됐던 file_id 일 수 있음) |

### 4.2 `INDEX_DELETE_FAILED` (milvus → rag:index)

```json
{
  "event_id": "...",
  "event_type": "INDEX_DELETE_FAILED",
  "schema_version": "1",
  "timestamp": "...",
  "file_id": "...",
  "user_key": "...",
  "collection_name": "...",
  "error_code": "MILVUS_TIMEOUT",
  "error_message": "...",
  "retryable": true
}
```

### 4.3 `EXTRACT_DELETED` (extract → rag:extract)

```json
{
  "event_id": "...",
  "event_type": "EXTRACT_DELETED",
  "schema_version": "1",
  "timestamp": "...",
  "file_id": "...",
  "user_key": "...",
  "collection_name": "...",
  "removed": {
    "output_file": true,
    "db_row": true,
    "cache_key": true
  }
}
```

### 4.4 `EXTRACT_DELETE_FAILED` (extract → rag:extract)

```json
{
  "event_id": "...",
  "event_type": "EXTRACT_DELETE_FAILED",
  "schema_version": "1",
  "timestamp": "...",
  "file_id": "...",
  "user_key": "...",
  "error_code": "OUTPUT_UNLINK_FAILED",
  "error_message": "...",
  "retryable": true
}
```

### 4.5 공통
- envelope 필드 (`event_id`, `event_type`, `schema_version`, `timestamp`) 기존 규약과 동일
- `file_id` 가 모든 서비스에서 키
- `retryable` 플래그로 rag-manager 가 자동 재시도 여부 판단

---

## 5. 스트림·구독자 매트릭스

| 스트림 | 발행자 | 구독 group | 신규/기존 |
|--------|--------|------------|-----------|
| `rag:documents` | rag-manager | `cg:extract` (extract), `cg:milvus` (milvus) | extract 기존, milvus **신규 구독** |
| `rag:extract` | extract | `cg:rag-manager`, `milvus-indexer` | 모두 기존 |
| `rag:index` | milvus | `cg:rag-manager` | **신규 스트림** |
| `*:dlq` | 각 consumer | (운영자) | 기존 패턴 |

### 5.1 이벤트 → 구독자 처리 매트릭스

| 이벤트 | 발행 | rag-manager | extract | milvus |
|--------|------|-------------|---------|--------|
| DOCUMENT_UPLOADED | rag-manager | (자기 발행) | 추출 시작 | ack-만 |
| DOCUMENT_DELETED | rag-manager | (자기 발행, status=DELETING) | 결과 정리 | 벡터 삭제 |
| EXTRACT_STARTED | extract | status=PROCESSING | (자기 발행) | ack-만 |
| EXTRACT_COMPLETED | extract | status=EXTRACTED | (자기 발행) | 인덱싱 |
| EXTRACT_FAILED | extract | status=FAILED + retry 정책 | (자기 발행) | ack-만 |
| EXTRACT_DELETED | extract | confirmation gate 입력 | (자기 발행) | ack-만 |
| EXTRACT_DELETE_FAILED | extract | 부분 실패 정책 | (자기 발행) | ack-만 |
| INDEX_COMPLETED | milvus | status=INDEXED | ack-만 | (자기 발행) |
| INDEX_FAILED | milvus | status=INDEX_FAILED + alert | ack-만 | (자기 발행) |
| INDEX_DELETED | milvus | confirmation gate 입력 | ack-만 | (자기 발행) |
| INDEX_DELETE_FAILED | milvus | 부분 실패 정책 | ack-만 | (자기 발행) |

---

## 6. 양 팀 작업 항목

### 6.1 milvus-indexer

| 항목 | 변경 |
|------|------|
| 신규 구독 | `rag:documents` 에 consumer group `cg:milvus` 추가 |
| 라우팅 | `DOCUMENT_DELETED` 만 처리, `DOCUMENT_UPLOADED` 는 ack-만 |
| 신규 스트림 | `rag:index` 발행 |
| 인덱싱 발행 | `INDEX_COMPLETED` (성공) / `INDEX_FAILED` (실패) — `EXTRACT_COMPLETED` 처리 후 |
| 삭제 발행 | `INDEX_DELETED` (성공) / `INDEX_DELETE_FAILED` (실패) — `DOCUMENT_DELETED` 처리 후 |
| 재시도 | 자체 retry/DLQ 정책 (실패 신호 발행 후에도 PEL 유지로 재시도 가능) |

### 6.2 docs-extract-system (우리)

| 항목 | 변경 |
|------|------|
| `app/common/enum/stream_event_type.py` | `EXTRACT_DELETED`, `EXTRACT_DELETE_FAILED` 추가 |
| `app/common/schema/stream_event.py` | `ExtractDeletedEvent`, `ExtractDeleteFailedEvent` 모델 |
| `app/extraction/publisher/extract_event_publisher.py` | `publish_deleted`, `publish_delete_failed` |
| `app/extraction/consumer/document_consumer.py:219` `_handle_deleted` | 정리 성공 시 `publish_deleted`, 실패 시 `publish_delete_failed` |
| 자체 재시도 | 실패 후 DLQ 정책 기존과 동일 |

### 6.3 rag-manager

| 항목 | 변경 |
|------|------|
| `file_status` 머신 | `UPLOADED → PROCESSING → EXTRACTED → INDEXED` (정상) / `DELETING → DELETED` (삭제) / `*_FAILED` 분기 |
| 발행 | `DOCUMENT_UPLOADED`, `DOCUMENT_DELETED` (기존) — 삭제 시 `status=DELETING` (원본 보존) |
| 신규 구독 | `rag:index` (`INDEX_COMPLETED/FAILED`, `INDEX_DELETED/FAILED`) |
| 인덱싱 처리 | `INDEX_COMPLETED` 수신 → `status=INDEXED`. `INDEX_FAILED` → `status=INDEX_FAILED` + alert + retry 정책 |
| 삭제 confirmation gate | `EXTRACT_DELETED` + `INDEX_DELETED` 모두 수신 시 → 원본 unlink + `status=DELETED` |
| 삭제 부분 실패 | `*_DELETE_FAILED` 또는 timeout 시 `status=DELETE_PARTIAL_FAILURE`, 알림, 재시도 (원본 보존) |
| Timeout | 모든 confirmation 을 N 분 내에 못 받으면 부분 실패 처리 |

> rag-manager 의 confirmation gate 책임 신설은 본 제안의 핵심. 별도 협의 진행.

### 6.4 file_status 상태 머신 (참고)

```
UPLOADED ─DOCUMENT_UPLOADED─▶ (extract 처리)
   │
   ├─ EXTRACT_STARTED   ─▶ PROCESSING
   │      │
   │      ├─ EXTRACT_COMPLETED ─▶ EXTRACTED
   │      │      │
   │      │      ├─ INDEX_COMPLETED ─▶ INDEXED ✅
   │      │      └─ INDEX_FAILED    ─▶ INDEX_FAILED (alert)
   │      └─ EXTRACT_FAILED   ─▶ FAILED
   │
   └─ DOCUMENT_DELETED  ─▶ DELETING
          │
          ├─ EXTRACT_DELETED + INDEX_DELETED 모두 수신 ─▶ DELETED ✅ (원본 unlink)
          └─ 부분 실패 / timeout ─▶ DELETE_PARTIAL_FAILURE (원본 보존)
```

---

## 7. 호환성·배포 순서

### 7.1 신규 이벤트는 backward-compatible
기존 `EXTRACT_STARTED/COMPLETED/FAILED` 와 라우팅 분리. 기존 흐름 변경 없음.

### 7.2 권장 순서
1. **docs-extract-system 배포** — `EXTRACT_DELETED/FAILED` 발행 시작 (rag-manager 가 모르면 무시)
2. **milvus 배포** — `rag:documents` 구독 + `INDEX_DELETED/FAILED` 발행 시작
3. **rag-manager 배포** — confirmation gate 활성화, `status=DELETING` 도입
4. 운영 검증 후 폐기 문서 정리

### 7.3 호환 기간
- 1번까지만 배포 + rag-manager 미반영: extract 가 발행해도 무시됨, 기존 흐름 동일
- 2번까지 배포 + rag-manager 미반영: milvus 도 처리하지만 confirmation gate 없으니 기존처럼 즉시 status=DELETED 도 가능

---

## 8. 검증 시나리오

### 8.0 정상 인덱싱
1. rag-manager → `DOCUMENT_UPLOADED`
2. extract → 추출 → `EXTRACT_COMPLETED`
3. rag-manager → `status=EXTRACTED`
4. milvus → 인덱싱 → `INDEX_COMPLETED`
5. rag-manager → `status=INDEXED` ✅

### 8.0a milvus 인덱싱 실패
1~3 동일
4. milvus → `INDEX_FAILED (retryable=true)`
5. rag-manager → `status=INDEX_FAILED`, alert, 자체 재시도 정책

### 8.1 정상 (삭제)
1. rag-manager → `DOCUMENT_DELETED`, status=DELETING
2. milvus → 벡터 삭제 → `INDEX_DELETED`
3. extract → 정리 → `EXTRACT_DELETED`
4. rag-manager → 두 성공 수신 → 원본 unlink, status=DELETED ✅

### 8.2 milvus 일시 실패
1. milvus → `INDEX_DELETE_FAILED (retryable=true)` 발행 + 자체 PEL 유지
2. extract → `EXTRACT_DELETED` 정상
3. rag-manager → 부분 신호만 수신 → status=DELETE_PARTIAL_FAILURE, 원본 보존
4. milvus 자체 재시도 성공 → `INDEX_DELETED` 추가 발행
5. rag-manager → 모든 신호 확보 → 원본 unlink, status=DELETED

### 8.3 extract 영구 실패
1. extract → `EXTRACT_DELETE_FAILED (retryable=false)`
2. rag-manager → status=DELETE_PARTIAL_FAILURE, 원본 보존, 운영 알림
3. 운영자 수동 개입

### 8.4 양쪽 모두 실패
- rag-manager 가 두 실패 신호 모두 수신 → 원본 보존, 알림, 수동 개입

### 8.5 timeout (응답 없음)
- rag-manager 가 N분 내 confirmation 미수신 → status=DELETE_PARTIAL_FAILURE, 원본 보존, 알림

---

## 9. 합의 사항

다음 항목 양 팀 의견 부탁드립니다:

1. **원칙 동의** — 각 서비스가 자기 처리 결과를 confirmation 으로 발행, rag-manager 가 lifecycle 종합
2. **새 스트림 `rag:index`** — milvus 가 발행, rag-manager 가 구독
3. **새 이벤트 6종** 스키마
   - 인덱싱: `INDEX_COMPLETED`, `INDEX_FAILED`
   - 삭제: `INDEX_DELETED`, `INDEX_DELETE_FAILED`, `EXTRACT_DELETED`, `EXTRACT_DELETE_FAILED`
4. **Confirmation gate 책임** — rag-manager 가 삭제 시 두 신호 대기 후 원본 unlink (별도 협의 중)
5. **Timeout 기준** — 권장값 (예: 인덱싱 10분, 삭제 5분)
6. **부분 실패 시 자동 재시도 정책** — 자동 retry 회수, 알림 채널
7. **배포 시점·순서**

---

## 10. 참고

- 원 설계 문서: `docs/RAG_MANAGER_REQUIREMENTS.md`, `plans/rag-pipeline.plan.md`
- 우선순위: **중간~높음** (정합성 critical, 잔류 = 사고)
