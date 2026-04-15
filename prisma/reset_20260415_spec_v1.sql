-- 완전 재생성 (기존 데이터는 테스트용이라 삭제)

DROP TABLE IF EXISTS document_files;
DROP TABLE IF EXISTS processed_events;

CREATE TABLE document_files (
  file_id VARCHAR(26) NOT NULL PRIMARY KEY,
  file_name VARCHAR(500) NOT NULL,
  user_key VARCHAR(100) NOT NULL,
  file_format VARCHAR(20) NOT NULL,
  file_size BIGINT NOT NULL,
  file_status VARCHAR(20) NOT NULL DEFAULT 'UPLOADED',
  collection_name VARCHAR(200) NULL,
  origin_path VARCHAR(1000) NULL,
  retry_count INT NOT NULL DEFAULT 0,
  last_error_code VARCHAR(50) NULL,
  rgst_dt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  rgst_nm VARCHAR(100) NOT NULL,
  status VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',
  updt_dt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updt_nm VARCHAR(100) NOT NULL,
  INDEX idx_user_key (user_key),
  INDEX idx_status (status),
  INDEX idx_file_format (file_format),
  INDEX idx_rgst_dt (rgst_dt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE processed_events (
  event_id VARCHAR(30) NOT NULL PRIMARY KEY,
  event_type VARCHAR(50) NOT NULL,
  file_id VARCHAR(26) NULL,
  processed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_file_id (file_id),
  INDEX idx_processed_at (processed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
