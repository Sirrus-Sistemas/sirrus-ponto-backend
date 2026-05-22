-- Adiciona campos de endereço à tabela funcionarios (idempotente)
ALTER TABLE funcionarios
  ADD COLUMN IF NOT EXISTS cep         VARCHAR(9)   NULL AFTER pis,
  ADD COLUMN IF NOT EXISTS logradouro  VARCHAR(200) NULL AFTER cep,
  ADD COLUMN IF NOT EXISTS numero      VARCHAR(20)  NULL AFTER logradouro,
  ADD COLUMN IF NOT EXISTS complemento VARCHAR(100) NULL AFTER numero,
  ADD COLUMN IF NOT EXISTS bairro      VARCHAR(100) NULL AFTER complemento,
  ADD COLUMN IF NOT EXISTS cidade      VARCHAR(100) NULL AFTER bairro,
  ADD COLUMN IF NOT EXISTS estado      CHAR(2)      NULL AFTER cidade;
