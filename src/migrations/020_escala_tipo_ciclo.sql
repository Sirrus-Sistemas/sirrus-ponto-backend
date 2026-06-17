USE ponto_web;

-- Armazena o tipo de ciclo e a data de início do ciclo usados para gerar a escala.
-- Permite que a tela de edição recarregue esses parâmetros ao detectar uma escala existente.
ALTER TABLE escalas
  ADD COLUMN tipo_ciclo  VARCHAR(20) NULL AFTER gerado_por,
  ADD COLUMN inicio_ciclo DATE       NULL AFTER tipo_ciclo;
