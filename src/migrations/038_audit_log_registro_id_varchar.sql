-- registro_id era BIGINT UNSIGNED, mas vários call sites de auditar() (bloquear/
-- desbloquear/justificar período) já usam identificadores compostos tipo
-- "225-2026-06-01" (funcionario_id-data). Com sql_mode=STRICT_TRANS_TABLES isso
-- gera erro de INSERT (nunca percebido porque a auditoria já falhava antes por
-- outro motivo — ver 037). Amplia a coluna para aceitar ambos os formatos.
ALTER TABLE audit_log
  CHANGE COLUMN registro_id registro_id VARCHAR(100) NULL
    COMMENT 'PK do registro afetado, ou identificador composto (ex.: funcionario_id-data)';
