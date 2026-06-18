USE ponto_web;

-- Garante que a tabela municipios existe antes de adicionar o FK
CREATE TABLE IF NOT EXISTS municipios (
  CODMUNICIPIO  INT UNSIGNED NOT NULL,
  NOMEMUNICIPIO VARCHAR(100) NOT NULL,
  ESTADO        CHAR(2)      NOT NULL,
  fuso_horario  VARCHAR(50)  DEFAULT 'UTC-03:00',
  PRIMARY KEY (CODMUNICIPIO),
  INDEX idx_municipio_estado (ESTADO)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Vincula a empresa a um município para determinar o fuso horário padrão
-- quando o funcionário não tiver cidade cadastrada.
ALTER TABLE empresas
  ADD COLUMN municipio_id INT UNSIGNED NULL AFTER uf,
  ADD CONSTRAINT fk_empresa_municipio
    FOREIGN KEY (municipio_id) REFERENCES municipios(CODMUNICIPIO)
    ON DELETE SET NULL;
