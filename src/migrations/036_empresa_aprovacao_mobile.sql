-- Parâmetro por empresa: se ligado, batidas do app mobile (status 'A' na API
-- PontoMobile) exigem aprovação manual antes de entrar em marcacoes.
ALTER TABLE empresas
  ADD COLUMN aprovacao_mobile_ativa TINYINT(1) NOT NULL DEFAULT 0
  COMMENT 'Batidas do app mobile exigem aprovação (status A/C/N) antes de entrar em marcacoes'
  AFTER max_funcionarios;
