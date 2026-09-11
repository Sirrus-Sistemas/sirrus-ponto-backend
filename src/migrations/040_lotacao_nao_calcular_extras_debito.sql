USE ponto_web;

-- Lotação onde o cliente não quer nenhum cálculo de hora extra nem de
-- débito/falta — nem no relatório nem na ficha de ponto (ambos usam o
-- mesmo EspelhoPontoService). Quando ativo, o dia sempre fecha com
-- saldo/extras zerados, independente de tipo_extra/domingo_tipo/etc.
ALTER TABLE lotacoes
  ADD COLUMN nao_calcular_extras_debito TINYINT(1) NOT NULL DEFAULT 0
  COMMENT 'Quando 1, zera horas extras e débito/falta no relatório e na ficha de ponto'
  AFTER tabela_zerada_e_folga;
