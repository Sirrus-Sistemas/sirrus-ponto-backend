USE ponto_web;

-- ─── USA_ESCALA no funcionário ───────────────────────────────────────────────
ALTER TABLE funcionarios
  ADD COLUMN IF NOT EXISTS usa_escala TINYINT(1) NOT NULL DEFAULT 0
    COMMENT '1 = precisa de escala gerada; 0 = presença seg-sáb, falta automática'
  AFTER lotacao_id;

-- ─── ESCALAS (calendário gerado por funcionário) ─────────────────────────────
CREATE TABLE IF NOT EXISTS escalas (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  funcionario_id INT UNSIGNED NOT NULL,
  data           DATE NOT NULL,
  tipo           ENUM('trabalho','folga') NOT NULL DEFAULT 'trabalho',

  -- Horários previstos para dias de trabalho (até 4 pares)
  entrada1       TIME NULL,
  saida1         TIME NULL,
  entrada2       TIME NULL,
  saida2         TIME NULL,
  entrada3       TIME NULL,
  saida3         TIME NULL,
  entrada4       TIME NULL,
  saida4         TIME NULL,
  fim_noturno    TIME NULL,

  gerado_por     INT UNSIGNED NULL,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uk_escala_func_data (funcionario_id, data),
  INDEX idx_escala_data (data),

  CONSTRAINT fk_escala_func
    FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id)
    ON DELETE CASCADE,

  CONSTRAINT fk_escala_gerado_por
    FOREIGN KEY (gerado_por) REFERENCES funcionarios(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── OCORRÊNCIAS (atestados, abonos, etc.) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS ocorrencias (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  funcionario_id INT UNSIGNED NOT NULL,
  data_inicio    DATE NOT NULL,
  data_fim       DATE NOT NULL,
  tipo           ENUM('atestado','abono','falta_justificada','licenca','outros') NOT NULL,
  descricao      VARCHAR(255) NULL,
  anexo_path     VARCHAR(500) NULL,
  lancado_por    INT UNSIGNED NOT NULL,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_ocorr_func_data (funcionario_id, data_inicio),

  CONSTRAINT fk_ocorr_func
    FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id)
    ON DELETE CASCADE,

  CONSTRAINT fk_ocorr_lancado
    FOREIGN KEY (lancado_por) REFERENCES funcionarios(id)
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
