USE ponto_web;

-- Referências para o Sirrus Ponto Mobile (IDs retornados pela API externa)
ALTER TABLE empresas
  ADD COLUMN IF NOT EXISTS pontomobile_id INT NULL AFTER uf;

ALTER TABLE funcionarios
  ADD COLUMN IF NOT EXISTS pontomobile_id INT NULL AFTER gestor_id;

ALTER TABLE lotacoes
  ADD COLUMN IF NOT EXISTS pontomobile_id INT NULL AFTER ativo;

-- Deduplicação: impede reimportar a mesma batida do mobile
ALTER TABLE marcacoes
  ADD COLUMN IF NOT EXISTS mobile_ref_id INT NULL AFTER original;

ALTER TABLE marcacoes
  ADD UNIQUE INDEX IF NOT EXISTS uk_marcacao_mobile (mobile_ref_id);
