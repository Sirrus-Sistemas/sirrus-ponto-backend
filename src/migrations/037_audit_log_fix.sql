-- audit_log foi criada por duas migrations conflitantes (001 com funcionario_id,
-- 018 com usuario_id); como 001 roda primeiro, a tabela real ficou com
-- funcionario_id, enquanto auditService.js sempre inseriu em usuario_id — todo
-- INSERT falhava silenciosamente (engolido pelo try/catch do serviço).
-- Corrige o nome da coluna e adiciona empresa_id para os filtros do relatório.
--
-- O runner reexecuta todos os .sql a cada deploy (não há tabela de controle de
-- migrations aplicadas), então o rename precisa ser condicional: CHANGE COLUMN
-- não é idempotente por si só — rodar de novo depois que já renomeou quebra
-- com "Unknown column 'funcionario_id'" e trava o restante das migrations.
SET @precisa_renomear := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_log' AND COLUMN_NAME = 'funcionario_id'
);
SET @sql_rename := IF(@precisa_renomear > 0,
  'ALTER TABLE audit_log CHANGE COLUMN funcionario_id usuario_id INT UNSIGNED NULL COMMENT ''funcionarios.id do usuário que executou a ação (NULL = sistema)''',
  'SELECT 1');
PREPARE stmt_rename FROM @sql_rename;
EXECUTE stmt_rename;
DEALLOCATE PREPARE stmt_rename;

-- ADD COLUMN / ADD INDEX já são idempotentes na prática: o runner trata
-- ER_DUP_FIELDNAME e ER_DUP_KEYNAME como "já aplicado" e segue em frente.
ALTER TABLE audit_log ADD COLUMN empresa_id INT UNSIGNED NULL AFTER usuario_id;
ALTER TABLE audit_log ADD INDEX idx_audit_empresa (empresa_id);
