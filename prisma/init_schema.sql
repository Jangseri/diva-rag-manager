-- ============================================================
-- RAG Manager 전체 스키마 (신규 서버 최초 구축용)
-- ============================================================
-- 기준: 192.168.220.223 운영 DB `extract_document` 의 실제 DDL
--       (MariaDB 10.11 에서 SHOW CREATE TABLE 로 추출, 2026-08-13)
--       prisma/schema.prisma 와 1:1 로 일치함
--
-- 사용법: 신규 서버는 이 파일 하나만 실행하면 됩니다.
--         prisma/ 하위의 create_table.sql / alter_*.sql / migrate_*.sql 은
--         과거 이력 보존용이며, 신규 구축 시 실행하지 마세요.
--
--   mysql -h <DB_HOST> -u root -p extract_document < prisma/init_schema.sql
--
-- 주의: 이 DB(`extract_document`)는 docs-extract-system(extract-unstructured)
--       와 공유합니다. 해당 서비스의 테이블(extraction_task, alembic_version)은
--       그쪽 저장소의 Alembic 마이그레이션으로 별도 생성해야 합니다.
-- ============================================================

CREATE DATABASE IF NOT EXISTS extract_document
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE extract_document;

-- ------------------------------------------------------------
-- 1. document_files : 학습 자료(파일/URL) 마스터
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS document_files (
  file_id         VARCHAR(26)   NOT NULL,
  source_type     VARCHAR(10)   NOT NULL DEFAULT 'file',
  source_url      VARCHAR(2048) DEFAULT NULL,
  file_name       VARCHAR(500)  NOT NULL,
  tenant_id       VARCHAR(100)  NOT NULL,
  file_format     VARCHAR(20)   DEFAULT NULL,
  file_size       BIGINT        NOT NULL,
  file_status     VARCHAR(20)   NOT NULL DEFAULT 'UPLOADED',
  collection_name VARCHAR(200)  DEFAULT NULL,
  origin_path     VARCHAR(1000) DEFAULT NULL,
  retry_count     INT           NOT NULL DEFAULT 0,
  last_error_code VARCHAR(50)   DEFAULT NULL,
  rgst_dt         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  rgst_nm         VARCHAR(100)  NOT NULL,
  status          VARCHAR(30)   NOT NULL DEFAULT 'ACTIVE',
  updt_dt         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updt_nm         VARCHAR(100)  NOT NULL,
  PRIMARY KEY (file_id),
  -- idx_user_key 는 user_key -> tenant_id 컬럼명 변경 당시 인덱스명을 그대로 둔 것.
  -- 운영 DB와 이름을 맞추기 위해 의도적으로 유지합니다.
  KEY idx_user_key (tenant_id),
  KEY idx_status (status),
  KEY idx_file_format (file_format),
  KEY idx_rgst_dt (rgst_dt),
  KEY idx_user_source_url (tenant_id, source_url(255)),
  KEY idx_source_type (source_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- 2. processed_events : Redis Stream 이벤트 멱등성 보장
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS processed_events (
  event_id     VARCHAR(100) NOT NULL,
  event_type   VARCHAR(50)  NOT NULL,
  file_id      VARCHAR(26)  DEFAULT NULL,
  processed_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (event_id),
  KEY idx_file_id (file_id),
  KEY idx_processed_at (processed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- 3. deletion_confirmations : 분산 삭제 confirmation gate
--    (EXTRACT_DELETED + INDEX_DELETED 수신 상태 추적)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS deletion_confirmations (
  file_id              VARCHAR(26) NOT NULL,
  extract_confirmed    TINYINT(1)  NOT NULL DEFAULT 0,
  extract_error_code   VARCHAR(50) DEFAULT NULL,
  extract_confirmed_at DATETIME    DEFAULT NULL,
  index_confirmed      TINYINT(1)  NOT NULL DEFAULT 0,
  index_error_code     VARCHAR(50) DEFAULT NULL,
  index_confirmed_at   DATETIME    DEFAULT NULL,
  deletion_due_at      DATETIME    NOT NULL,
  finalized_at         DATETIME    DEFAULT NULL,
  created_at           DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (file_id),
  KEY idx_finalized_due (finalized_at, deletion_due_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
