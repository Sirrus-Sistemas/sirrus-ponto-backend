-- Dobra, no resumo da ficha, as horas que caem no balde de 100% (feriado/
-- domingo/dia não previsto trabalhados). A coluna 100% do dia e os arquivos
-- MTE continuam com a hora real; só o total "Total Extras 100%" e o banco de
-- horas passam a contar em dobro quando ligado. Desligado por padrão.
ALTER TABLE lotacoes
  ADD COLUMN dobrar_100pct_trabalhado TINYINT(1) NOT NULL DEFAULT 0;
