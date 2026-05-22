USE ponto_web;

-- ─── FILIAIS ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS filiais (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  empresa_id   INT UNSIGNED NOT NULL,
  nome         VARCHAR(150) NOT NULL,
  cnpj         VARCHAR(18) NULL,
  endereco     VARCHAR(300) NULL,
  cidade       VARCHAR(100) NULL,
  uf           CHAR(2) NULL,
  cep          VARCHAR(10) NULL,
  telefone     VARCHAR(20) NULL,
  email        VARCHAR(150) NULL,
  ativa        TINYINT(1) NOT NULL DEFAULT 1,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_filial_empresa
    FOREIGN KEY (empresa_id) REFERENCES empresas(id)
    ON DELETE CASCADE,

  UNIQUE KEY uk_filial_empresa_nome (empresa_id, nome)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── VINCULA FUNCIONÁRIO À FILIAL ────────────────────────────────────────────
ALTER TABLE funcionarios
  ADD COLUMN IF NOT EXISTS filial_id INT UNSIGNED NULL AFTER empresa_id;

ALTER TABLE funcionarios DROP FOREIGN KEY IF EXISTS fk_func_filial;
ALTER TABLE funcionarios
  ADD CONSTRAINT fk_func_filial
    FOREIGN KEY (filial_id) REFERENCES filiais(id)
    ON DELETE SET NULL;

-- ─── ÍNDICE PARA FILTROS POR FILIAL ─────────────────────────────────────────
ALTER TABLE funcionarios
  ADD INDEX IF NOT EXISTS idx_func_filial (filial_id);
