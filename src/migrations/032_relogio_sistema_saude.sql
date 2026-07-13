USE ponto_web;

CREATE TABLE IF NOT EXISTS relogio_sistema_saude (
  empresa_id   INT UNSIGNED NOT NULL PRIMARY KEY,
  versao       VARCHAR(50)  NULL,
  status       VARCHAR(30)  NULL,
  ultimo_sync  DATETIME     NULL,
  relogios     LONGTEXT     NULL COMMENT 'JSON: array de status por relógio',
  recebido_em  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_saude_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
