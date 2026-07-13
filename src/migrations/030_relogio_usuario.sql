USE ponto_web;

ALTER TABLE relogios_ponto
  ADD COLUMN usuario VARCHAR(100) NULL AFTER porta;
