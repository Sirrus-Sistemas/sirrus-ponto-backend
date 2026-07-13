USE ponto_web;

-- MIGRATION 034 — data de corte por relógio + staging de marcações importadas
--
-- sincronizar_desde é obrigatório: evita que um relógio antigo com anos de
-- histórico importe marcações de ex-funcionários que nunca serão
-- cadastrados no sistema novo. Relógios já cadastrados recebem a data de
-- hoje como default — revise no cadastro se quiser outra data.
ALTER TABLE relogios_ponto
  ADD COLUMN sincronizar_desde DATE NOT NULL DEFAULT (CURRENT_DATE);

-- relogio_marcacoes_importadas é a fonte da verdade de "o que este agente
-- já viu deste relógio", vinculada ou não a um funcionário. Antes, uma
-- marcação sem funcionário correspondente era descartada e, pior, o
-- próximo NSR já avançava por cima dela — perdida para sempre mesmo que o
-- funcionário fosse cadastrado depois. `marcacoes` (usada para folha e
-- espelho de ponto) só recebe uma cópia quando o vínculo existe, na
-- importação ou depois, na reconciliação.
CREATE TABLE relogio_marcacoes_importadas (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  relogio_id     INT UNSIGNED NOT NULL,
  nsr            INT UNSIGNED NOT NULL,
  cpf            VARCHAR(14) NULL,
  pis            VARCHAR(20) NULL,
  data_hora      DATETIME NOT NULL,
  funcionario_id INT UNSIGNED NULL,
  status         ENUM('vinculada', 'pendente') NOT NULL DEFAULT 'pendente',
  marcacao_id    BIGINT UNSIGNED NULL,
  criado_em      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  vinculado_em   DATETIME NULL,

  UNIQUE KEY uq_rmi_relogio_nsr (relogio_id, nsr),
  INDEX idx_rmi_status (relogio_id, status),
  INDEX idx_rmi_cpf (cpf),
  INDEX idx_rmi_pis (pis),

  CONSTRAINT fk_rmi_relogio FOREIGN KEY (relogio_id) REFERENCES relogios_ponto(id) ON DELETE CASCADE,
  CONSTRAINT fk_rmi_funcionario FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id) ON DELETE SET NULL,
  CONSTRAINT fk_rmi_marcacao FOREIGN KEY (marcacao_id) REFERENCES marcacoes(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
