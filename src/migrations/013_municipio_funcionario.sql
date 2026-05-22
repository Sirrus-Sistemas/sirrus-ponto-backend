-- Vincula funcionário a um município cadastrado para fuso horário (idempotente)
ALTER TABLE funcionarios
  ADD COLUMN IF NOT EXISTS municipio_id INT UNSIGNED NULL AFTER estado;

-- Índice para agilizar o JOIN com municipios
ALTER TABLE funcionarios
  ADD INDEX IF NOT EXISTS idx_func_municipio (municipio_id);
