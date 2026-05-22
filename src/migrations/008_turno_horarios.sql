-- ============================================================================
-- MIGRATION 008 — Horários por dia da semana (turno_horarios)
-- Permite configurar carga e horários diferentes para cada dia da semana
-- dentro de um mesmo turno (ex.: sábado meio período).
-- ============================================================================

USE ponto_web;

CREATE TABLE IF NOT EXISTS turno_horarios (
  id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  turno_id            INT UNSIGNED NOT NULL,
  dia_semana          TINYINT UNSIGNED NOT NULL COMMENT '0=Dom 1=Seg 2=Ter 3=Qua 4=Qui 5=Sex 6=Sáb',
  trabalha            TINYINT(1) NOT NULL DEFAULT 1,
  entrada             TIME NULL,
  saida_intervalo     TIME NULL,
  retorno_intervalo   TIME NULL,
  saida               TIME NULL,
  carga_minutos       SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_th_turno
    FOREIGN KEY (turno_id) REFERENCES turnos(id) ON DELETE CASCADE,

  UNIQUE KEY uk_th_turno_dia (turno_id, dia_semana),
  CONSTRAINT chk_th_dia CHECK (dia_semana BETWEEN 0 AND 6)
) ENGINE=InnoDB;
