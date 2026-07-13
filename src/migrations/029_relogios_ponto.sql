CREATE TABLE IF NOT EXISTS relogios_ponto (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  empresa_id    INT UNSIGNED NOT NULL,
  filial_id     INT UNSIGNED NULL,
  numero_serie  VARCHAR(100) NOT NULL,
  descricao     VARCHAR(200) NOT NULL,
  modelo        ENUM(
    'arquivo_afd',
    'control_id',
    'control_id_class',
    'control_id_class_671',
    'henry_super_facil',
    'henry_sf_advanced',
    'arquivo_afd_671',
    'idface_671',
    'henry_1510'
  ) NOT NULL DEFAULT 'control_id',
  ip            VARCHAR(45)  NULL     COMMENT 'IP na rede local do cliente',
  porta         SMALLINT UNSIGNED NULL DEFAULT 80,
  usuario       VARCHAR(100) NULL,
  senha         VARCHAR(100) NULL,
  usa_afd       TINYINT(1)   NOT NULL DEFAULT 0,
  ativo         TINYINT(1)   NOT NULL DEFAULT 1,
  criado_em     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_relogio_serie_empresa (empresa_id, numero_serie),
  CONSTRAINT fk_relogio_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_relogio_filial  FOREIGN KEY (filial_id)  REFERENCES filiais(id)  ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
