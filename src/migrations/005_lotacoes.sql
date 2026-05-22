USE ponto_web;

CREATE TABLE IF NOT EXISTS lotacoes (
  id                              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  empresa_id                      INT UNSIGNED NOT NULL,
  nome                            VARCHAR(100) NOT NULL,

  -- Tipo de hora extra base
  tipo_extra                      ENUM('50_clt','60','80','100') NOT NULL DEFAULT '50_clt',
  calcular_extras_escalonado      TINYINT(1) NOT NULL DEFAULT 0 COMMENT '50/60/80/100% progressivo',

  -- Regra domingo
  domingo_tipo                    ENUM('nao_calcular','50pct','100pct_extra','100pct_total') NOT NULL DEFAULT '100pct_extra',

  -- Regra feriado
  feriado_tipo                    ENUM('nao_calcular','50pct','100pct_extra','100pct_total') NOT NULL DEFAULT '100pct_total',

  -- Flags de cálculo
  somar_esq_horas_trabalhadas     TINYINT(1) NOT NULL DEFAULT 0,
  converter_falta_banco_horas     TINYINT(1) NOT NULL DEFAULT 0,
  lancar_100pct_banco_horas       TINYINT(1) NOT NULL DEFAULT 0,
  converter_falta_folha_ponto     TINYINT(1) NOT NULL DEFAULT 0,
  nao_gerar_debitos_meia_falta    TINYINT(1) NOT NULL DEFAULT 0,
  banco_horas_somente_dom_feriado TINYINT(1) NOT NULL DEFAULT 0,
  dividir_extras_50_100           TINYINT(1) NOT NULL DEFAULT 0,
  calcular_60pct_sabados          TINYINT(1) NOT NULL DEFAULT 0,
  sabado_somente_extras           TINYINT(1) NOT NULL DEFAULT 0,
  juntar_100pct_sabado_normal     TINYINT(1) NOT NULL DEFAULT 0,
  atribuir_100pct_terceiro_domingo TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Escala 12x36',
  lancar_debitos_domingo_50pct    TINYINT(1) NOT NULL DEFAULT 0,
  tabela_zerada_e_folga           TINYINT(1) NOT NULL DEFAULT 0,

  -- Horários de referência
  hora_inicio_100pct              TIME NULL,
  hora_inicio_adicional_noturno   TIME NOT NULL DEFAULT '22:00:00',

  ativo                           TINYINT(1) NOT NULL DEFAULT 1,
  created_at                      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at                      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_lotacao_empresa
    FOREIGN KEY (empresa_id) REFERENCES empresas(id)
    ON DELETE CASCADE,

  UNIQUE KEY uk_lotacao_empresa_nome (empresa_id, nome)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE funcionarios
  ADD COLUMN IF NOT EXISTS lotacao_id INT UNSIGNED NULL AFTER turno_id;

ALTER TABLE funcionarios DROP FOREIGN KEY IF EXISTS fk_func_lotacao;
ALTER TABLE funcionarios
  ADD CONSTRAINT fk_func_lotacao
    FOREIGN KEY (lotacao_id) REFERENCES lotacoes(id)
    ON DELETE SET NULL;
