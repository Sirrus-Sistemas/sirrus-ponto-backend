USE ponto_web;

-- ─── TIPOS DE OCORRÊNCIA (cadastro por empresa) ──────────────────────────────
CREATE TABLE IF NOT EXISTS tipos_ocorrencia (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  empresa_id      INT UNSIGNED NOT NULL,
  descricao       VARCHAR(100) NOT NULL,
  tipo_lancamento ENUM('credito','debito') NOT NULL,
  ativo           TINYINT(1) NOT NULL DEFAULT 1,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_to_empresa (empresa_id),

  CONSTRAINT fk_to_empresa
    FOREIGN KEY (empresa_id) REFERENCES empresas(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── COLUNAS EXTRAS NA TABELA OCORRÊNCIAS ────────────────────────────────────
ALTER TABLE ocorrencias
  ADD COLUMN tipo_ocorrencia_id INT UNSIGNED NULL
    AFTER tipo,
  ADD COLUMN turno ENUM('integral','1_periodo','2_periodo','3_periodo','4_periodo') NULL
    AFTER tipo_ocorrencia_id,
  ADD COLUMN tipo_hora ENUM('hora_50_60','hora_100') NULL
    AFTER turno,
  ADD COLUMN quantidade_horas DECIMAL(5,2) UNSIGNED NULL
    AFTER tipo_hora;

