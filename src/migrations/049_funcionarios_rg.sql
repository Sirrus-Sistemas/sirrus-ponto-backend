USE ponto_web;

-- O formulário de funcionário já tinha o campo RG, mas não existia coluna —
-- o valor digitado se perdia no envio.
ALTER TABLE funcionarios
  ADD COLUMN rg VARCHAR(30) NULL AFTER pis;
