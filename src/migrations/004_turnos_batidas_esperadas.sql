USE ponto_web;

-- Batidas esperadas por dia útil (par 2–24; MariaDB 10.5.2+ / MySQL 8.0.12+).
ALTER TABLE turnos
  ADD COLUMN IF NOT EXISTS batidas_esperadas_dia TINYINT UNSIGNED NOT NULL DEFAULT 8 COMMENT 'Ciclo diário no espelho' AFTER tipo;
