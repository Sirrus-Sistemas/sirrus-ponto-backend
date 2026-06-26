-- ============================================================================
-- MIGRATION 025 — Dias bloqueados para re-importação do mobile
-- Um dia bloqueado indica que as marcações daquele dia foram ajustadas
-- manualmente e não devem ser sobrescritas por um novo pull-marcacoes.
-- ============================================================================

USE ponto_web;

CREATE TABLE IF NOT EXISTS marcacoes_dia_bloqueado (
  id            INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  empresa_id    INT           NOT NULL,
  funcionario_id INT          NOT NULL,
  data          DATE          NOT NULL,
  bloqueado_por INT           NULL COMMENT 'usuario_id que realizou o bloqueio',
  bloqueado_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_func_data (funcionario_id, data),
  KEY idx_empresa_data (empresa_id, data),
  KEY idx_func_data    (funcionario_id, data)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
