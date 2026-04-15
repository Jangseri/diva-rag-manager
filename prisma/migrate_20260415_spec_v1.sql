-- docs-extract-system 연동 스펙 v1 마이그레이션
-- 실행 전: 기존 document_files 데이터는 테스트 용이라 TRUNCATE 후 구조 변경 권장

-- 1. 기존 데이터 제거 (테스트 데이터만 있음)
TRUNCATE TABLE document_files;

-- 2. uuid → file_id 컬럼명 변경 + 길이 26(ULID)로 축소
ALTER TABLE document_files
  CHANGE COLUMN uuid file_id VARCHAR(26) NOT NULL;

-- 3. 신규 컬럼 추가
ALTER TABLE document_files
  ADD COLUMN collection_name VARCHAR(200) NULL AFTER file_status,
  ADD COLUMN origin_path VARCHAR(1000) NULL AFTER collection_name,
  ADD COLUMN retry_count INT NOT NULL DEFAULT 0 AFTER origin_path,
  ADD COLUMN last_error_code VARCHAR(50) NULL AFTER retry_count;

-- 4. 인덱스 추가
CREATE INDEX idx_user_key ON document_files (user_key);

-- 5. 멱등성 보장용 처리된 이벤트 테이블
CREATE TABLE IF NOT EXISTS processed_events (
  event_id VARCHAR(30) NOT NULL PRIMARY KEY,
  event_type VARCHAR(50) NOT NULL,
  file_id VARCHAR(26) NULL,
  processed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_file_id (file_id),
  INDEX idx_processed_at (processed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
