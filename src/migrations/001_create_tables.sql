-- ============================================================================
-- SISTEMA DE PONTO WEB — MIGRATION 001
-- Criação de todas as tabelas base
-- ============================================================================

CREATE DATABASE IF NOT EXISTS ponto_web
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE ponto_web;

-- ─── EMPRESAS ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS empresas (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  razao_social VARCHAR(200) NOT NULL,
  nome_fantasia VARCHAR(200),
  cnpj        VARCHAR(18) UNIQUE,
  endereco    VARCHAR(300),
  cidade      VARCHAR(100),
  uf          CHAR(2),
  cep         VARCHAR(10),
  telefone    VARCHAR(20),
  email       VARCHAR(150),
  timezone    VARCHAR(50) DEFAULT 'America/Porto_Velho',
  ativa       TINYINT(1) DEFAULT 1,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ─── DEPARTAMENTOS ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS departamentos (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  empresa_id  INT UNSIGNED NOT NULL,
  nome        VARCHAR(100) NOT NULL,
  descricao   VARCHAR(255),
  ativo       TINYINT(1) DEFAULT 1,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_dept_empresa
    FOREIGN KEY (empresa_id) REFERENCES empresas(id)
    ON DELETE CASCADE,

  UNIQUE KEY uk_dept_empresa_nome (empresa_id, nome)
) ENGINE=InnoDB;

-- ─── TURNOS / HORÁRIOS ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS turnos (
  id                    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  empresa_id            INT UNSIGNED NOT NULL,
  nome                  VARCHAR(100) NOT NULL,
  entrada               TIME NOT NULL,
  saida_intervalo       TIME NOT NULL,
  retorno_intervalo     TIME NOT NULL,
  saida                 TIME NOT NULL,
  tolerancia_atraso_min INT UNSIGNED DEFAULT 10,
  tolerancia_extra_min  INT UNSIGNED DEFAULT 10,
  intervalo_minimo_min  INT UNSIGNED DEFAULT 60,
  carga_horaria_diaria  TIME DEFAULT '08:00:00',
  tipo                  ENUM('fixo', 'flexivel', 'escala') DEFAULT 'fixo',
  batidas_esperadas_dia TINYINT UNSIGNED NOT NULL DEFAULT 8 COMMENT 'Par 2-24; ciclo diário por turno',
  ativo                 TINYINT(1) DEFAULT 1,
  created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_turno_empresa
    FOREIGN KEY (empresa_id) REFERENCES empresas(id)
    ON DELETE CASCADE
) ENGINE=InnoDB;

-- ─── FUNCIONÁRIOS ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS funcionarios (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  empresa_id      INT UNSIGNED NOT NULL,
  departamento_id INT UNSIGNED,
  turno_id        INT UNSIGNED,
  gestor_id       INT UNSIGNED NULL,

  -- Dados pessoais
  nome            VARCHAR(200) NOT NULL,
  cpf             VARCHAR(14) UNIQUE,
  email           VARCHAR(150) NOT NULL,
  telefone        VARCHAR(20),
  foto_path       VARCHAR(500),
  data_nascimento DATE,

  -- Dados profissionais
  cargo           VARCHAR(100),
  matricula       VARCHAR(50),
  data_admissao   DATE NOT NULL,
  data_demissao   DATE NULL,
  pis             VARCHAR(20),

  -- Acesso
  senha_hash      VARCHAR(255) NOT NULL,
  role            ENUM('admin', 'gestor', 'funcionario') DEFAULT 'funcionario',
  ativo           TINYINT(1) DEFAULT 1,

  -- Central do funcionário
  central_ativa           TINYINT(1) DEFAULT 1,
  permitir_geo            TINYINT(1) DEFAULT 1,
  permitir_foto           TINYINT(1) DEFAULT 1,
  permitir_ajuste_ponto   TINYINT(1) DEFAULT 1,

  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_func_empresa
    FOREIGN KEY (empresa_id) REFERENCES empresas(id)
    ON DELETE CASCADE,

  CONSTRAINT fk_func_departamento
    FOREIGN KEY (departamento_id) REFERENCES departamentos(id)
    ON DELETE SET NULL,

  CONSTRAINT fk_func_turno
    FOREIGN KEY (turno_id) REFERENCES turnos(id)
    ON DELETE SET NULL,

  CONSTRAINT fk_func_gestor
    FOREIGN KEY (gestor_id) REFERENCES funcionarios(id)
    ON DELETE SET NULL,

  INDEX idx_func_empresa (empresa_id),
  INDEX idx_func_depto (departamento_id),
  INDEX idx_func_email (email),
  INDEX idx_func_matricula (matricula)
) ENGINE=InnoDB;

-- ─── REFRESH TOKENS ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  funcionario_id  INT UNSIGNED NOT NULL,
  token_hash      VARCHAR(255) NOT NULL,
  device_info     VARCHAR(255),
  ip_address      VARCHAR(45),
  expires_at      DATETIME NOT NULL,
  revoked         TINYINT(1) DEFAULT 0,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_rt_func
    FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id)
    ON DELETE CASCADE,

  INDEX idx_rt_token (token_hash),
  INDEX idx_rt_func (funcionario_id)
) ENGINE=InnoDB;

-- ─── FERIADOS ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS feriados (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  empresa_id  INT UNSIGNED NOT NULL,
  data        DATE NOT NULL,
  descricao   VARCHAR(150) NOT NULL,
  tipo        ENUM('nacional', 'estadual', 'municipal', 'empresa') DEFAULT 'nacional',
  recorrente  TINYINT(1) DEFAULT 0,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_feriado_empresa
    FOREIGN KEY (empresa_id) REFERENCES empresas(id)
    ON DELETE CASCADE,

  UNIQUE KEY uk_feriado_empresa_data (empresa_id, data)
) ENGINE=InnoDB;

-- ─── MARCAÇÕES DE PONTO ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS marcacoes (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  funcionario_id  INT UNSIGNED NOT NULL,
  data_hora       DATETIME NOT NULL,
  tipo            ENUM('manual', 'geo', 'rep', 'online') DEFAULT 'manual',
  
  -- Geolocalização
  latitude        DECIMAL(10, 7) NULL,
  longitude       DECIMAL(10, 7) NULL,
  endereco_geo    VARCHAR(300) NULL,
  dentro_perimetro TINYINT(1) NULL,

  -- Foto
  foto_path       VARCHAR(500) NULL,

  -- Device
  device_info     VARCHAR(255),
  ip_address      VARCHAR(45),

  -- Controle
  original        TINYINT(1) DEFAULT 1,
  editado_por     INT UNSIGNED NULL,
  motivo_edicao   VARCHAR(255),

  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_marc_func
    FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id)
    ON DELETE CASCADE,

  CONSTRAINT fk_marc_editor
    FOREIGN KEY (editado_por) REFERENCES funcionarios(id)
    ON DELETE SET NULL,

  INDEX idx_marc_func_data (funcionario_id, data_hora),
  INDEX idx_marc_data (data_hora)
) ENGINE=InnoDB;

-- ─── CARTÃO PONTO (resumo diário calculado) ────────────────────────────────
CREATE TABLE IF NOT EXISTS cartao_ponto (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  funcionario_id  INT UNSIGNED NOT NULL,
  data            DATE NOT NULL,

  -- Marcações do dia (nullable = ainda não bateu)
  entrada         TIME NULL,
  saida_intervalo TIME NULL,
  retorno_intervalo TIME NULL,
  saida           TIME NULL,

  -- Cálculos
  horas_trabalhadas   TIME DEFAULT '00:00:00',
  horas_extras        TIME DEFAULT '00:00:00',
  horas_faltas        TIME DEFAULT '00:00:00',
  horas_noturnas      TIME DEFAULT '00:00:00',
  atraso              TIME DEFAULT '00:00:00',

  -- Banco de horas
  saldo_banco         INT DEFAULT 0 COMMENT 'Saldo em minutos (+/-)',

  -- Status
  status          ENUM('normal', 'falta', 'feriado', 'folga', 'ferias', 'afastamento', 'abonado') DEFAULT 'normal',
  justificativa_id INT UNSIGNED NULL,
  observacao      VARCHAR(255),

  -- Controle
  calculado       TINYINT(1) DEFAULT 0,
  assinado        TINYINT(1) DEFAULT 0,
  assinado_em     DATETIME NULL,

  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_cp_func
    FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id)
    ON DELETE CASCADE,

  UNIQUE KEY uk_cp_func_data (funcionario_id, data),
  INDEX idx_cp_data (data),
  INDEX idx_cp_status (status)
) ENGINE=InnoDB;

-- ─── BANCO DE HORAS (movimentações) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS banco_horas (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  funcionario_id  INT UNSIGNED NOT NULL,
  data            DATE NOT NULL,
  tipo            ENUM('credito', 'debito', 'compensacao', 'ajuste') NOT NULL,
  minutos         INT NOT NULL COMMENT 'Valor em minutos (sempre positivo)',
  saldo_anterior  INT DEFAULT 0 COMMENT 'Saldo antes da movimentação (min)',
  saldo_posterior INT DEFAULT 0 COMMENT 'Saldo após movimentação (min)',
  descricao       VARCHAR(255),
  created_by      INT UNSIGNED NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_bh_func
    FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id)
    ON DELETE CASCADE,

  CONSTRAINT fk_bh_created_by
    FOREIGN KEY (created_by) REFERENCES funcionarios(id)
    ON DELETE SET NULL,

  INDEX idx_bh_func_data (funcionario_id, data)
) ENGINE=InnoDB;

-- ─── JUSTIFICATIVAS ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS justificativas (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  funcionario_id  INT UNSIGNED NOT NULL,
  tipo            ENUM('atestado', 'falta_justificada', 'abono', 'outros') NOT NULL,
  data_inicio     DATE NOT NULL,
  data_fim        DATE NOT NULL,
  descricao       TEXT,
  anexo_path      VARCHAR(500),
  status          ENUM('pendente', 'aprovado', 'rejeitado') DEFAULT 'pendente',
  aprovado_por    INT UNSIGNED NULL,
  aprovado_em     DATETIME NULL,
  motivo_rejeicao VARCHAR(255),
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_just_func
    FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id)
    ON DELETE CASCADE,

  CONSTRAINT fk_just_aprovador
    FOREIGN KEY (aprovado_por) REFERENCES funcionarios(id)
    ON DELETE SET NULL,

  INDEX idx_just_func (funcionario_id),
  INDEX idx_just_status (status)
) ENGINE=InnoDB;

-- ─── SOLICITAÇÕES DE AJUSTE ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS solicitacoes (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  funcionario_id  INT UNSIGNED NOT NULL,
  tipo            ENUM('ajuste_ponto', 'inclusao_ponto', 'exclusao_ponto', 'justificativa', 'banco_horas') NOT NULL,
  data_referencia DATE NOT NULL,
  descricao       TEXT NOT NULL,

  -- Dados do ajuste
  hora_original   TIME NULL,
  hora_solicitada TIME NULL,

  -- Workflow
  status          ENUM('pendente', 'visto_gestor', 'aprovado', 'rejeitado') DEFAULT 'pendente',
  gestor_id       INT UNSIGNED NULL,
  gestor_visto_em DATETIME NULL,
  aprovado_por    INT UNSIGNED NULL,
  aprovado_em     DATETIME NULL,
  motivo_rejeicao VARCHAR(255),

  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_sol_func
    FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id)
    ON DELETE CASCADE,

  CONSTRAINT fk_sol_gestor
    FOREIGN KEY (gestor_id) REFERENCES funcionarios(id)
    ON DELETE SET NULL,

  CONSTRAINT fk_sol_aprovador
    FOREIGN KEY (aprovado_por) REFERENCES funcionarios(id)
    ON DELETE SET NULL,

  INDEX idx_sol_func (funcionario_id),
  INDEX idx_sol_status (status),
  INDEX idx_sol_data (data_referencia)
) ENGINE=InnoDB;

-- ─── CONFIGURAÇÕES POR EMPRESA ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS configuracoes (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  empresa_id      INT UNSIGNED NOT NULL,
  chave           VARCHAR(100) NOT NULL,
  valor           TEXT,
  descricao       VARCHAR(255),
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_config_empresa
    FOREIGN KEY (empresa_id) REFERENCES empresas(id)
    ON DELETE CASCADE,

  UNIQUE KEY uk_config_empresa_chave (empresa_id, chave)
) ENGINE=InnoDB;

-- ─── LOG DE AUDITORIA ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  funcionario_id  INT UNSIGNED NULL,
  acao            VARCHAR(100) NOT NULL,
  tabela          VARCHAR(50),
  registro_id     BIGINT UNSIGNED,
  dados_anteriores JSON,
  dados_novos     JSON,
  ip_address      VARCHAR(45),
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_audit_func (funcionario_id),
  INDEX idx_audit_acao (acao),
  INDEX idx_audit_data (created_at)
) ENGINE=InnoDB;
