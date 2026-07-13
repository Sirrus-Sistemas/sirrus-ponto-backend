-- Limites de contratação por empresa: controla quantas filiais e funcionários
-- ativos cada empresa pode ter, conforme o plano contratado.
ALTER TABLE empresas
  ADD COLUMN max_filiais       SMALLINT UNSIGNED NOT NULL DEFAULT 1  AFTER ativa,
  ADD COLUMN max_funcionarios  SMALLINT UNSIGNED NOT NULL DEFAULT 50 AFTER max_filiais;
