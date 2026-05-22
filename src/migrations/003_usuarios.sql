-- Cadastro de acesso ao sistema: CPF + senha (1:1 com funcionário ativo)
USE ponto_web;

CREATE TABLE IF NOT EXISTS usuarios (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  funcionario_id  INT UNSIGNED NOT NULL,
  cpf             CHAR(11) NOT NULL COMMENT 'Somente 11 dígitos',
  senha_hash      VARCHAR(255) NOT NULL,
  ativo           TINYINT(1) NOT NULL DEFAULT 1,
  created_at      TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_usuarios_funcionario (funcionario_id),
  UNIQUE KEY uk_usuarios_cpf (cpf),
  CONSTRAINT fk_usuarios_funcionario
    FOREIGN KEY (funcionario_id) REFERENCES funcionarios (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
