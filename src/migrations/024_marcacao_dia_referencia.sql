-- ============================================================================
-- MIGRATION 024 — Dia de referência para batidas de turno noturno
-- Permite associar uma batida ao dia de turno correto mesmo quando
-- o horário cruza a madrugada além do corte automático de 5h.
-- Exemplo: batida das 05:57 do dia 03/06 pertence ao turno do dia 02/06.
-- NULL = comportamento padrão (janela noturna de 5h via DATE_SUB).
-- ============================================================================

USE ponto_web;

ALTER TABLE marcacoes
  ADD COLUMN dia_referencia DATE NULL
  COMMENT 'Dia de referência para agrupamento no espelho/ficha. NULL = usa DATE(data_hora) com janela noturna de 5h.'
  AFTER data_hora;
