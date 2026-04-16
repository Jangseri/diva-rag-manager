-- 문서 데이터 전체 초기화 (테이블 구조는 유지, row만 삭제)
-- 외부 RAG 서비스 인덱스와 디스크 원본 파일은 별도로 정리 필요

SET FOREIGN_KEY_CHECKS = 0;

TRUNCATE TABLE document_files;
TRUNCATE TABLE deletion_confirmations;
TRUNCATE TABLE processed_events;

SET FOREIGN_KEY_CHECKS = 1;
