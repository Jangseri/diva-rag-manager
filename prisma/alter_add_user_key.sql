ALTER TABLE document_files
  ADD COLUMN user_key VARCHAR(100) NOT NULL DEFAULT '' AFTER file_name;

CREATE INDEX idx_user_key ON document_files (user_key);
