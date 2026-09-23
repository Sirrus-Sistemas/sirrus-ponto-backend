-- ─── Migration 043: funcionarios.usa_banco_horas ───────────────────────────────
-- No Sirrus Ponto Velox, o bloco "Banco de Horas" só aparecia impresso na
-- ficha de ponto se o funcionário tivesse esse parâmetro habilitado no
-- cadastro — quem tem hora extra sempre paga em folha (não compensada em
-- tempo) não deveria ver a seção. Sem esse campo, a ficha mostraria o bloco
-- pra todo mundo, o que não corresponde ao comportamento esperado.

ALTER TABLE funcionarios
  ADD COLUMN usa_banco_horas TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'Exibe o bloco Banco de Horas na ficha de ponto impressa'
    AFTER usa_escala;

-- ─── DOWN ─────────────────────────────────────────────────────────────────────
-- ALTER TABLE funcionarios DROP COLUMN usa_banco_horas;
