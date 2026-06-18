USE ponto_web;

ALTER TABLE funcionarios
  ADD COLUMN senha_mobile VARCHAR(255) NULL AFTER senha_hash;
