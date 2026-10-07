-- ============================================================================
-- MIGRATION 046 — inclui `tipo` na UNIQUE (funcionario_id, data_hora, tipo)
--
-- A migration 026 criou UNIQUE(funcionario_id, data_hora) presumindo que todo
-- data_hora era UTC de verdade. A migration 035 (depois) passou a gravar
-- batida tipo='rep' em hora LOCAL pura, sem conversão — mas essa constraint
-- nunca foi revisada. Resultado: uma batida 'rep' às 18:02 (local) e uma
-- batida 'manual'/'online'/'geo' às 18:02 (UTC, equivalente a 14:02 local)
-- colidem no banco só por coincidência de string, embora sejam horários
-- reais completamente diferentes — bloqueando lançamentos manuais legítimos
-- com "Já existe um registro com esses dados".
--
-- Incluir `tipo` na chave resolve isso sem perder a proteção real: duas
-- batidas do MESMO tipo no mesmo data_hora cru continuam bloqueadas (ex.:
-- reimportar o mesmo NSR do relógio duas vezes, ou duplo-clique no manual).
-- ============================================================================

USE ponto_web;

ALTER TABLE marcacoes
  DROP INDEX uq_marcacao_func_data_hora,
  ADD UNIQUE INDEX uq_marcacao_func_data_hora_tipo (funcionario_id, data_hora, tipo);
