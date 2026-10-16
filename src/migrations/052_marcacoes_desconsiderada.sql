USE ponto_web;

-- Batida do relógio (REP) ou do aplicativo não pode ser apagada — é o
-- registro original (Portaria 671). O "Abonar" da Ficha de Ponto fazia
-- DELETE em qualquer batida. Agora batida não manual só é DESCONSIDERADA:
-- sai do cálculo e do tratamento, mas continua gravada (e na coluna
-- "Marcações REP" do espelho) e pode ser reconsiderada. Manual continua
-- podendo ser excluída.
ALTER TABLE marcacoes
  ADD COLUMN desconsiderada TINYINT(1) NOT NULL DEFAULT 0
    COMMENT '1 = fora do cálculo (batida original mantida)',
  ADD COLUMN desconsiderada_por INT UNSIGNED NULL,
  ADD COLUMN desconsiderada_em DATETIME NULL;
