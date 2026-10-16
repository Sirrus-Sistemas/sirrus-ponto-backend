USE ponto_web;

-- Cerca eletrônica do Ponto Mobile em três níveis: filial (= "empresa" no
-- Ponto Mobile), lotação e funcionário. A API do Ponto Mobile só guarda a
-- cerca por funcionário (valida_localizacao + lista de locais), então aqui
-- fica a configuração de cada nível e, na sincronização, cada funcionário
-- recebe a lista final (ver cercaService.resolverParaFuncionario):
--   • locais: SOMA dos locais da filial, da lotação e do próprio funcionário;
--   • validar: o nível mais específico que estiver definido vence
--     (funcionário → lotação → filial). NULL = herdar do nível acima.

CREATE TABLE IF NOT EXISTS cerca_locais (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  empresa_id    INT UNSIGNED NOT NULL,
  escopo        ENUM('filial', 'lotacao', 'funcionario') NOT NULL,
  referencia_id INT UNSIGNED NOT NULL COMMENT 'id da filial, lotação ou funcionário',
  descricao     VARCHAR(120) NULL,
  latitude      DECIMAL(10, 7) NOT NULL,
  longitude     DECIMAL(10, 7) NOT NULL,
  raio_metros   INT UNSIGNED NOT NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_cerca_escopo (escopo, referencia_id),
  INDEX idx_cerca_empresa (empresa_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Filial: liga/desliga a validação (padrão desligado).
ALTER TABLE filiais
  ADD COLUMN valida_localizacao TINYINT(1) NOT NULL DEFAULT 0;

-- Lotação e funcionário: NULL = herda do nível acima.
ALTER TABLE lotacoes
  ADD COLUMN valida_localizacao TINYINT(1) NULL DEFAULT NULL;

ALTER TABLE funcionarios
  ADD COLUMN valida_localizacao TINYINT(1) NULL DEFAULT NULL;
