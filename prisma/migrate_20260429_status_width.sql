-- document_files.status 컬럼 폭 확장
-- 기존 VARCHAR(10)은 'DELETE_PARTIAL_FAILURE' (22자) 저장 불가 → timeout-job이 에러로 실패하던 문제
-- 충분한 여유로 VARCHAR(30) 으로 확장

ALTER TABLE document_files
  MODIFY COLUMN status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE';
