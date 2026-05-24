USE ponto_web;

-- Índices para acelerar as queries de sincronização do Ponto Mobile

-- syncAllFuncionarios: WHERE empresa_id = ? AND ativo = 1
ALTER TABLE funcionarios
  ADD INDEX IF NOT EXISTS idx_func_empresa_ativo (empresa_id, ativo);

-- pullMarcacoes auto-sync: WHERE filial_id = ? AND ativo = 1 AND pontomobile_id IS NULL
ALTER TABLE funcionarios
  ADD INDEX IF NOT EXISTS idx_func_filial_ativo (filial_id, ativo);

-- pullMarcacoes funcMap: WHERE filial_id = ? AND pontomobile_id IN (...)
ALTER TABLE funcionarios
  ADD INDEX IF NOT EXISTS idx_func_pontomobile (pontomobile_id);
