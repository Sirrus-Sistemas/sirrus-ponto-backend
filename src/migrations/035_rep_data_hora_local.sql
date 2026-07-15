-- Relógios de ponto (tipo='rep') têm o horário registrado no horário LOCAL do
-- equipamento. O código antigo aplicava CONVERT_TZ('-03:00','+00:00') no INSERT,
-- tratando erroneamente o horário local como BRT e armazenando em UTC.
--
-- Esta migration reverte as batidas REP existentes para o horário local original
-- (desfaz a conversão usando o mesmo offset -03:00 que foi aplicado).
-- Após esta migration, insertFromRelogio passa a armazenar a hora local diretamente,
-- e o espelho exibe data_hora sem CONVERT_TZ para tipo='rep'.

UPDATE marcacoes
SET data_hora = CONVERT_TZ(data_hora, '+00:00', '-03:00')
WHERE tipo = 'rep';
