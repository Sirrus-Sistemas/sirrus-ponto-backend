-- ─── Migration 039: marcacoes_bloqueadas.tipo — corrige semântica da coluna ────
-- A coluna foi criada como CHAR(1) para E=entrada|S=saída (migration 027), mas
-- nunca foi usada assim: tanto bloquearGrupoDuplicatas (pontoMobileService.js)
-- quanto o script bloquear_duplicatas_historico.js sempre gravaram a origem da
-- batida ('rep'/'online', o mesmo domínio de marcacoes.tipo), não entrada/saída.
-- Sob sql_mode=STRICT_TRANS_TABLES isso sempre gerava "Data too long for column
-- 'tipo'" — silenciosamente engolido por try/catch — então a tabela nunca
-- recebeu uma linha sequer. Esta migration alinha a coluna ao que o código
-- sempre quis gravar, em vez de tentar calcular entrada/saída (que exigiria
-- rodar a lógica de pareamento sequencial neste ponto do fluxo, hoje ausente).

ALTER TABLE marcacoes_bloqueadas
  MODIFY COLUMN tipo ENUM('manual', 'geo', 'rep', 'online') NOT NULL DEFAULT 'online'
    COMMENT 'Origem da batida bloqueada (mesmo domínio de marcacoes.tipo) — não indica entrada/saída';

-- ─── DOWN ─────────────────────────────────────────────────────────────────────
-- ALTER TABLE marcacoes_bloqueadas
--   MODIFY COLUMN tipo CHAR(1) NOT NULL COMMENT 'E=entrada|S=saída';
