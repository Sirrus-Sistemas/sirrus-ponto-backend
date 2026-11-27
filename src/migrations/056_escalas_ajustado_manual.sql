USE ponto_web;

-- "Atualizar escala" (gerar/editar ciclo) regera o período inteiro do zero
-- (DELETE + INSERT), o que sempre sobrescrevia ajustes pontuais feitos na
-- tela "Ajustar escala" (POST /escalas/ajuste) sem avisar ninguém. Esta
-- coluna marca os dias tocados manualmente para que o regenerar os preserve.
ALTER TABLE escalas
  ADD COLUMN ajustado_manual TINYINT(1) NOT NULL DEFAULT 0
    COMMENT '1 = dia alterado manualmente em Ajustar escala; regenerar por ciclo/turno não sobrescreve'
  AFTER tipo;
