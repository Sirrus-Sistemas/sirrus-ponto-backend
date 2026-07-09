-- ─── Migration 027: marcacoes_conflitos — fila de revisão de batidas duplicadas ─────────
-- Armazena conflitos detectados durante importação do app mobile (batidas próximas no tempo)
-- para que um admin revise e decida manualmente qual(quais) manter.
-- UP

USE ponto_web;

CREATE TABLE IF NOT EXISTS marcacoes_conflitos (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  empresa_id        INT NOT NULL,
  funcionario_id    INT NOT NULL,
  candidatos        JSON NOT NULL
    COMMENT 'Array de {mobile_ref_id, data_hora, tipo, observacao, marcacao_id}',
  status            ENUM('pendente','resolvido') NOT NULL DEFAULT 'pendente'
    COMMENT 'pendente = aguardando decisão do admin; resolvido = já revisado',
  resolucao         JSON NULL
    COMMENT 'Array de índices dos candidatos mantidos + quem resolveu',
  resolvido_por     INT NULL,
  resolvido_em      DATETIME NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_conflito_func_status (funcionario_id, status),
  INDEX idx_conflito_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Fila de conflitos de batidas (duplicatas próximas) aguardando revisão manual';

-- ─── DOWN ─────────────────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS marcacoes_conflitos;
