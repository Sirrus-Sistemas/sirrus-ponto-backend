-- ============================================================================
-- MIGRATION 026 — UNIQUE (funcionario_id, data_hora) em marcacoes
-- Impede duplicatas exatas no segundo, independente do caminho de inserção:
-- lançamento manual, batida online, geo ou REP.
-- O mobile_ref_id NULL não conflita (MySQL/MariaDB trata NULL como distinto
-- em índices únicos), então registros não-mobile continuam funcionando.
-- ============================================================================

USE ponto_web;

ALTER TABLE marcacoes
  ADD UNIQUE INDEX uq_marcacao_func_data_hora (funcionario_id, data_hora);
