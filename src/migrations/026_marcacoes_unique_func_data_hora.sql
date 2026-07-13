-- ============================================================================
-- MIGRATION 026 — UNIQUE (funcionario_id, data_hora) em marcacoes
-- Impede duplicatas exatas no segundo, independente do caminho de inserção:
-- lançamento manual, batida online, geo ou REP.
-- O mobile_ref_id NULL não conflita (MySQL/MariaDB trata NULL como distinto
-- em índices únicos), então registros não-mobile continuam funcionando.
-- Remove duplicatas antes de criar o índice, mantendo o registro mais antigo.
-- ============================================================================

USE ponto_web;

-- Remove duplicatas mantendo apenas o registro com menor id por (funcionario_id, data_hora)
DELETE m1
FROM marcacoes m1
INNER JOIN marcacoes m2
  ON  m2.funcionario_id = m1.funcionario_id
  AND m2.data_hora      = m1.data_hora
  AND m2.id             < m1.id;

ALTER TABLE marcacoes
  ADD UNIQUE INDEX uq_marcacao_func_data_hora (funcionario_id, data_hora);
