USE ponto_web;

-- MIGRATION 033 — coleta de marcações via relógio (sistema de coleta local)
--
-- relogio_id + nsr identificam de onde veio uma marcação importada de um
-- equipamento físico. A deduplicação de verdade já é garantida pela UNIQUE
-- (funcionario_id, data_hora) da migration 026 — reenviar a mesma marcação
-- não gera duplicata; o índice abaixo só acelera a consulta de "qual o
-- último NSR que já importei deste relógio", usada pelo sistema de coleta
-- local para não pedir ao equipamento marcações que ele já entregou.

ALTER TABLE marcacoes
  ADD COLUMN relogio_id INT UNSIGNED NULL,
  ADD COLUMN nsr        INT UNSIGNED NULL;

ALTER TABLE marcacoes
  ADD CONSTRAINT fk_marcacao_relogio FOREIGN KEY (relogio_id) REFERENCES relogios_ponto(id) ON DELETE SET NULL;

CREATE INDEX idx_marcacao_relogio_nsr ON marcacoes (relogio_id, nsr);
