USE ponto_web;

-- Vincula a empresa a um município para determinar o fuso horário padrão
-- quando o funcionário não tiver cidade cadastrada.
ALTER TABLE empresas
  ADD COLUMN municipio_id INT UNSIGNED NULL AFTER uf,
  ADD CONSTRAINT fk_empresa_municipio
    FOREIGN KEY (municipio_id) REFERENCES municipios(CODMUNICIPIO)
    ON DELETE SET NULL;
