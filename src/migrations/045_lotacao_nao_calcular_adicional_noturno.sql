USE ponto_web;

-- Algumas empresas têm convenção coletiva que não prevê adicional noturno
-- (ou já embute isso em outra verba) — quando ativo, zera o cálculo de
-- minutos noturnos (e o acréscimo da hora reduzida, CLT art. 73 §1º) no
-- relatório e na ficha de ponto, independente do horário batido.
ALTER TABLE lotacoes
  ADD COLUMN nao_calcular_adicional_noturno TINYINT(1) NOT NULL DEFAULT 0
  COMMENT 'Quando 1, não calcula adicional noturno (22h-5h) nem o acréscimo da hora reduzida'
  AFTER hora_inicio_adicional_noturno;
