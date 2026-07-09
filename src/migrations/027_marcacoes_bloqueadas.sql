-- ─── Migration 027: marcacoes_bloqueadas — quarentena de duplicatas ────────────
-- Armazena grupos de batidas duplicadas bloqueadas (2+ batidas em até 60 seg)
-- para visibilidade e auditoria. Admin pode desbloquear manualmente se necessário.

USE ponto_web;

CREATE TABLE IF NOT EXISTS marcacoes_bloqueadas (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  empresa_id       INT NOT NULL,
  funcionario_id   INT NOT NULL,
  data_hora        DATETIME NOT NULL,
  tipo             CHAR(1) NOT NULL COMMENT 'E=entrada|S=saída',
  mobile_ref_id    BIGINT UNSIGNED NULL,
  grupo_id         VARCHAR(50) NOT NULL
    COMMENT 'Hash MD5(funcionario_id + data_hora_primeira_do_grupo) para agrupar visualmente',
  motivo_bloqueio  VARCHAR(200) NOT NULL
    COMMENT 'Ex: "Grupo de duplicatas: 14:05:00, 14:05:08, 14:05:42" ou "Duplicata histórica"',
  desbloqueado_por INT NULL
    COMMENT 'ID do admin que desbloqueou (se aplicável)',
  desbloqueado_em  DATETIME NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_bloqueada_func (funcionario_id),
  INDEX idx_bloqueada_grupo (grupo_id),
  INDEX idx_bloqueada_desbloqueada (desbloqueado_em)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Quarentena: batidas bloqueadas por duplicação detectada';

-- ─── DOWN ─────────────────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS marcacoes_bloqueadas;
