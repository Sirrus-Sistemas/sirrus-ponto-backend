-- Permite fixar a posição de exibição de uma batida no espelho (slot 0-7).
-- NULL = posição automática por ordem cronológica (comportamento padrão).
ALTER TABLE marcacoes
  ADD COLUMN slot_override TINYINT UNSIGNED NULL DEFAULT NULL
  COMMENT 'Posição forçada no espelho (0=E1..7=S4). NULL = ordem por data_hora.';
