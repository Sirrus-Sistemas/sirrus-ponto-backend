export const ROLES = {
  ADMIN: 'admin',
  GESTOR: 'gestor',
  FUNCIONARIO: 'funcionario',
};

export const PUNCH_TYPES = {
  MANUAL: 'manual',
  GEO: 'geo',
  REP: 'rep',
  ONLINE: 'online',
};

export const REQUEST_STATUS = {
  PENDING: 'pendente',
  APPROVED: 'aprovado',
  REJECTED: 'rejeitado',
};

export const JUSTIFICATION_TYPES = {
  ATESTADO: 'atestado',
  FALTA_JUSTIFICADA: 'falta_justificada',
  ABONO: 'abono',
  OUTROS: 'outros',
};

export const EXTRA_PERCENTAGES = {
  NORMAL: 50,       // Dia útil
  DOMINGO: 100,     // Domingos e feriados
  NOTURNO: 20,      // Adicional noturno (22h-05h)
};

export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 10000,
};

export const PONTO_DUPLICATA_JANELA_SEG = 60; // Janela para detectar grupos de duplicatas (1 minuto)
