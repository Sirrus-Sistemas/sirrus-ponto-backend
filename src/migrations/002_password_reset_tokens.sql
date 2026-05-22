-- Tokens de recuperação de senha (um uso, com expiração)
USE ponto_web;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  funcionario_id  INT UNSIGNED NOT NULL,
  token_hash      CHAR(64) NOT NULL,
  expires_at      DATETIME NOT NULL,
  used_at         DATETIME NULL DEFAULT NULL,
  created_at      TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_prt_token_hash (token_hash),
  KEY idx_prt_func_expires (funcionario_id, expires_at),
  CONSTRAINT fk_prt_funcionario
    FOREIGN KEY (funcionario_id) REFERENCES funcionarios (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
