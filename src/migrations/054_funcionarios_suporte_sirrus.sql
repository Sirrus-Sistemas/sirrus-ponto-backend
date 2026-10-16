USE ponto_web;

-- Acesso do suporte técnico da Sirrus: o técnico entra com o próprio CPF e a
-- senha diária (ver suporteService.senhaDiaria) e escolhe a empresa. Como
-- várias tabelas referenciam funcionarios (editado_por, lancado_por,
-- refresh_tokens…), cada empresa ganha, na primeira entrada do suporte, um
-- funcionário técnico "SUPORTE SIRRUS" com esta marca — fora das listagens,
-- do controle de ponto, do limite de funcionários e das integrações.
ALTER TABLE funcionarios
  ADD COLUMN suporte_sirrus TINYINT(1) NOT NULL DEFAULT 0
    COMMENT '1 = usuário técnico do suporte Sirrus (oculto)';
