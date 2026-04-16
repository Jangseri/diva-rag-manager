-- 분산 삭제 confirmation gate용 테이블
-- (EXTRACT_DELETED + INDEX_DELETED 이벤트 수신 상태 추적)

CREATE TABLE IF NOT EXISTS deletion_confirmations (
  file_id              VARCHAR(26) NOT NULL PRIMARY KEY,
  extract_confirmed    TINYINT(1)  NOT NULL DEFAULT 0,
  extract_error_code   VARCHAR(50) NULL,
  extract_confirmed_at DATETIME    NULL,
  index_confirmed      TINYINT(1)  NOT NULL DEFAULT 0,
  index_error_code     VARCHAR(50) NULL,
  index_confirmed_at   DATETIME    NULL,
  deletion_due_at      DATETIME    NOT NULL,
  finalized_at         DATETIME    NULL,
  created_at           DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_finalized_due (finalized_at, deletion_due_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
