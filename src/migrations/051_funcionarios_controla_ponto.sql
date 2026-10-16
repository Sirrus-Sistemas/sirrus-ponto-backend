USE ponto_web;

-- Cargo de gestão dispensado do controle de jornada (art. 62, II da CLT):
-- o gerente continua acessando o sistema, mas não tem folha de ponto — some
-- da Ficha/Espelho/relatórios de ponto e não gera falta nem débito. Antes,
-- para "esconder" a própria folha, o gerente inativava o próprio usuário.
ALTER TABLE funcionarios
  ADD COLUMN controla_ponto TINYINT(1) NOT NULL DEFAULT 1
    COMMENT '0 = dispensado do controle de ponto (art. 62 CLT)'
    AFTER usa_banco_horas;
