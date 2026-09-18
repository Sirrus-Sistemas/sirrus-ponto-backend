USE ponto_web;

-- pontomobile_id é a chave do funcionário no banco do Ponto Mobile — nunca
-- deveria se repetir entre dois funcionários locais. Sem essa restrição, um
-- CPF duplicado/parecido resolvido via login (ver syncFuncionario) podia
-- vincular dois funcionários locais ao mesmo pontomobile_id, misturando as
-- batidas de pessoas diferentes.
--
-- Esta migration FALHA de propósito se ainda houver duplicatas no banco —
-- rode antes:
--   SELECT pontomobile_id, GROUP_CONCAT(id) FROM funcionarios
--    WHERE pontomobile_id IS NOT NULL GROUP BY pontomobile_id HAVING COUNT(*) > 1;
-- e resolva cada caso (confira no banco do Ponto Mobile qual CPF/nome é o
-- dono de cada pontomobile_id e zere o campo do funcionário errado) antes
-- de rodar `npm run migrate` de novo.
ALTER TABLE funcionarios
  ADD UNIQUE INDEX uq_funcionarios_pontomobile_id (pontomobile_id);
