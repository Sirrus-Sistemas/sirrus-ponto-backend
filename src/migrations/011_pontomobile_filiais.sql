USE ponto_web;

ALTER TABLE filiais
  ADD COLUMN IF NOT EXISTS pontomobile_id INT NULL AFTER ativa;
