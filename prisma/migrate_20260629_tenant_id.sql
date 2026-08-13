-- ============================================================
-- 누락되어 있던 마이그레이션 (뒤늦게 git에 기록)
-- ============================================================
-- 아래 두 변경은 운영 DB(223)에 직접 적용된 뒤 prisma/schema.prisma 에만
-- 반영되고 SQL 파일이 커밋되지 않아, git 기준으로 DB를 만들면
-- 코드와 스키마가 어긋나는 원인이 되었습니다.
--   - c78fd8e  refactor: user_key -> tenant_id 전체 교체
--   - dc52990  fix: processed_events.event_id 컬럼 확장 (30 -> 100)
--
-- 대상: git의 구버전 SQL(create_table.sql / reset_20260415_spec_v1.sql 등)로
--       만들어진 DB를 현재 코드에 맞추는 경우.
-- 신규 서버는 이 파일 대신 prisma/init_schema.sql 하나만 실행하세요.
-- ============================================================

-- ------------------------------------------------------------
-- 1. document_files.user_key -> tenant_id
--    (인덱스명 idx_user_key / idx_user_source_url 은 운영 DB와
--     동일하게 맞추기 위해 그대로 둡니다)
-- ------------------------------------------------------------
ALTER TABLE document_files
  CHANGE COLUMN user_key tenant_id VARCHAR(100) NOT NULL;

-- ------------------------------------------------------------
-- 2. processed_events.event_id 폭 확장
--    RAG 인덱서가 보내는 event_id가 30자를 초과해 P2000 저장 실패
-- ------------------------------------------------------------
ALTER TABLE processed_events
  MODIFY COLUMN event_id VARCHAR(100) NOT NULL;
