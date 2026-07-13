USE ponto_web;

CREATE TABLE IF NOT EXISTS relogio_sync_fila (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  relogio_id      INT UNSIGNED NOT NULL,
  funcionario_id  INT UNSIGNED NOT NULL,
  operacao        ENUM('inserir', 'atualizar', 'excluir') NOT NULL,
  status          ENUM('pendente', 'enviado', 'erro') NOT NULL DEFAULT 'pendente',
  tentativas      SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  erro_msg        TEXT NULL,
  criado_em       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  processado_em   DATETIME NULL,

  -- Um único registro ativo por (relógio, funcionário); dedup via ON DUPLICATE KEY
  UNIQUE KEY uq_fila_relogio_func (relogio_id, funcionario_id),
  INDEX idx_fila_status     (relogio_id, status),
  INDEX idx_fila_funcionario (funcionario_id),

  CONSTRAINT fk_fila_relogio     FOREIGN KEY (relogio_id)     REFERENCES relogios_ponto(id) ON DELETE CASCADE,
  CONSTRAINT fk_fila_funcionario FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id)   ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
