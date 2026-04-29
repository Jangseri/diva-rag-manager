-- URL 학습 기능 도입: source_type / source_url 컬럼 추가
-- file_format은 URL 케이스에서 NULL 허용

-- 1. source_type 컬럼 추가 (file/url discriminator)
ALTER TABLE document_files
  ADD COLUMN source_type VARCHAR(10) NOT NULL DEFAULT 'file' AFTER file_id;

-- 2. source_url 컬럼 추가 (URL 케이스에서만 채움)
ALTER TABLE document_files
  ADD COLUMN source_url VARCHAR(2048) NULL AFTER source_type;

-- 3. file_format을 NULL 허용으로 변경 (URL 케이스에서는 NULL)
ALTER TABLE document_files
  MODIFY COLUMN file_format VARCHAR(20) NULL;

-- 4. URL 중복 검출용 인덱스 (user_key + source_url)
--    VARCHAR(2048) 전체 인덱싱은 키 길이 제한 때문에 prefix 인덱스 사용
CREATE INDEX idx_user_source_url ON document_files (user_key, source_url(255));

-- 5. source_type 필터용 인덱스
CREATE INDEX idx_source_type ON document_files (source_type);
