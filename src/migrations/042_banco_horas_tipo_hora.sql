-- ─── Migration 042: banco_horas — tipo_hora, mes_referencia, origem ────────────
-- A tabela banco_horas existe desde a migration 001 mas nunca foi usada por
-- nenhum código (sem repository, sem rota) — ficou como esqueleto de uma
-- feature que nunca foi construída. Pra virar o "Banco de Horas" de verdade
-- (tela de lançamento manual + fechamento mensal automático da ficha de
-- ponto), faltam três coisas que o desenho original não previa:
--
--   tipo_hora      — 50% e 100% são carteiras de saldo INDEPENDENTES (a tela
--                    do Sirrus Ponto Velox já tinha esse campo; nunca existiu aqui).
--   mes_referencia — a tela antiga tem "Data" (dia do lançamento) e "Mês/Ano"
--                    (a que mês esse lançamento pertence) como campos
--                    SEPARADOS — um ajuste lançado hoje pode valer pra um mês
--                    passado. Também é o que impede fechar o mesmo mês duas
--                    vezes (checado na aplicação, não por constraint aqui).
--   origem         — distingue lançamento manual (tela) de fechamento
--                    automático (ficha de ponto do mês), pra exibir e auditar.
--
-- 'compensacao' e 'ajuste' saem do ENUM de tipo: nunca foram usados, e a tela
-- de lançamento manual só tem 2 opções (crédito/débito) — 'origem' já cobre
-- a distinção que 'ajuste' tentaria fazer.

ALTER TABLE banco_horas
  MODIFY COLUMN tipo ENUM('credito', 'debito') NOT NULL,
  ADD COLUMN tipo_hora ENUM('50pct', '100pct') NOT NULL DEFAULT '50pct' AFTER tipo,
  ADD COLUMN mes_referencia CHAR(7) NOT NULL DEFAULT '1970-01'
    COMMENT 'Mês/ano a que o lançamento pertence (YYYY-MM) — pode diferir da data do lançamento' AFTER data,
  ADD COLUMN origem ENUM('manual', 'fechamento_mensal') NOT NULL DEFAULT 'manual' AFTER descricao,
  ADD INDEX idx_bh_func_mes (funcionario_id, mes_referencia, tipo_hora);

-- ─── DOWN ─────────────────────────────────────────────────────────────────────
-- ALTER TABLE banco_horas
--   DROP INDEX idx_bh_func_mes,
--   DROP COLUMN origem,
--   DROP COLUMN mes_referencia,
--   DROP COLUMN tipo_hora,
--   MODIFY COLUMN tipo ENUM('credito', 'debito', 'compensacao', 'ajuste') NOT NULL;
