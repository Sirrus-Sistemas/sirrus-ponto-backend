-- ─── Migration 044: ocorrencias.informativa ────────────────────────────────────
-- Ocorrência de crédito/débito num dia com batidas reais soma/cobre o período
-- que faltou (ver espelhoPontoService.js) — mas às vezes o admin só quer
-- registrar o MOTIVO (ex.: "Folga Compensativa" pra explicar por que faltou o
-- 2º período) sem que isso mude a conta do dia, deixando o débito natural
-- (batidas vs previsto) aparecer normalmente. Decidido a cada lançamento, não
-- por tipo de ocorrência — por isso fica na ocorrência em si, não em
-- tipos_ocorrencia.

ALTER TABLE ocorrencias
  ADD COLUMN informativa TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'Só rotula o Motivo da ficha — não soma/subtrai nada do cálculo do dia'
    AFTER quantidade_horas;

-- ─── DOWN ─────────────────────────────────────────────────────────────────────
-- ALTER TABLE ocorrencias DROP COLUMN informativa;
