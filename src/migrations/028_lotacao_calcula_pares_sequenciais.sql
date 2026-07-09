USE ponto_web;

ALTER TABLE lotacoes
ADD COLUMN calcula_pares_sequenciais_noturno TINYINT(1) NOT NULL DEFAULT 0
COMMENT 'Para turnos noturnos: calcula pares de batidas em sequência, sem reordenar por data_hora. Resolve problema de horas absurdas quando turno cruza meia-noite'
AFTER hora_inicio_adicional_noturno;
