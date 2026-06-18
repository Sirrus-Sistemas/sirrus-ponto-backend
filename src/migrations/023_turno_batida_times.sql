-- ============================================================================
-- MIGRATION 023 — Armazena array completo de batidas no turno
-- Necessário para suportar > 4 batidas/dia (6, 8, etc.) sem perder os
-- horários intermediários (SAÍDA INT.2, RETORNO 2, SAÍDA INT.3, RETORNO 3).
-- ============================================================================

USE ponto_web;

ALTER TABLE turnos
  ADD COLUMN batida_times_json TEXT NULL
  COMMENT 'Array JSON com todos os horários ex: ["08:00","12:00","13:00","17:00"]'
  AFTER saida;
