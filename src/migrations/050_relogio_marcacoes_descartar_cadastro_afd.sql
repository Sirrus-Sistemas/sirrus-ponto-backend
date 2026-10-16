USE ponto_web;

-- Registros de cadastro de empregado do AFD (tipo 5: operação I/A/E + PIS,
-- ex.: "A02003287047") entraram como batida pelo sistema de coleta e ficam
-- presos em "Marcações Pendentes" para sempre — não são marcação de ponto e
-- não têm funcionário a vincular. A API passou a recusá-los na entrada
-- (POST /relogios/marcacoes); aqui saem da fila os que já entraram.
-- Marcados como 'descartada' (não apagados) para dar para conferir/reverter:
--   UPDATE relogio_marcacoes_importadas SET status = 'pendente' WHERE status = 'descartada';
ALTER TABLE relogio_marcacoes_importadas
  MODIFY COLUMN status ENUM('vinculada', 'pendente', 'descartada') NOT NULL DEFAULT 'pendente';

UPDATE relogio_marcacoes_importadas
   SET status = 'descartada'
 WHERE status = 'pendente'
   AND (pis REGEXP '[A-Za-z]' OR cpf REGEXP '[A-Za-z]');
