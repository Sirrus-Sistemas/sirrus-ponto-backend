-- audit_log foi criada por duas migrations conflitantes (001 com funcionario_id,
-- 018 com usuario_id); como 001 roda primeiro, a tabela real ficou com
-- funcionario_id, enquanto auditService.js sempre inseriu em usuario_id — todo
-- INSERT falhava silenciosamente (engolido pelo try/catch do serviço).
-- Corrige o nome da coluna e adiciona empresa_id para os filtros do relatório.
ALTER TABLE audit_log
  CHANGE COLUMN funcionario_id usuario_id INT UNSIGNED NULL
    COMMENT 'funcionarios.id do usuário que executou a ação (NULL = sistema)',
  ADD COLUMN empresa_id INT UNSIGNED NULL AFTER usuario_id,
  ADD INDEX idx_audit_empresa (empresa_id);
