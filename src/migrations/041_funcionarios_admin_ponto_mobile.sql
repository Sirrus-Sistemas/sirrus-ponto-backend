-- ─── Migration 040: funcionarios.admin_ponto_mobile ────────────────────────────
-- O Sirrus Ponto Velox tinha um campo próprio (ADMINISTRADOR = 'X') pra
-- marcar quem é administrador dentro do app Sirrus Ponto Mobile — conceito
-- separado do `role` interno da Sirrus (admin/gestor/funcionario), que rege
-- permissões daqui, não do app. Sem esse campo, o sync sempre mandava
-- `admin: 'N'` fixo pra API mobile (pontoMobileService.js), então nenhum
-- funcionário conseguia administrar nada por lá.

ALTER TABLE funcionarios
  ADD COLUMN admin_ponto_mobile TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'Administrador dentro do app Sirrus Ponto Mobile (sync envia admin S/N pra API mobile)'
    AFTER usa_mobile;

-- ─── DOWN ─────────────────────────────────────────────────────────────────────
-- ALTER TABLE funcionarios DROP COLUMN admin_ponto_mobile;
