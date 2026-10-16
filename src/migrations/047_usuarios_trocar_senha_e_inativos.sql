USE ponto_web;

-- Senha definida por outra pessoa (admin, cadastro, import da planilha com
-- os 6 primeiros dígitos do CPF) não pode continuar valendo: quem sabe o CPF
-- entra na conta. Com trocar_senha = 1 o login só libera a rota de troca de
-- senha até o próprio usuário escolher uma nova. Vale só para senhas definidas
-- daqui em diante — contas existentes ficam com 0 (sem troca forçada).
ALTER TABLE usuarios
  ADD COLUMN trocar_senha TINYINT(1) NOT NULL DEFAULT 0;

-- Funcionário inativado precisa perder o acesso junto — antes disso o
-- usuário continuava "Ativo" em Usuários do Sistema (ex.: funcionário 374).
UPDATE usuarios u
  JOIN funcionarios f ON f.id = u.funcionario_id
   SET u.ativo = 0
 WHERE f.ativo = 0 AND u.ativo = 1;

UPDATE refresh_tokens rt
  JOIN funcionarios f ON f.id = rt.funcionario_id
   SET rt.revoked = 1
 WHERE f.ativo = 0 AND rt.revoked = 0;
