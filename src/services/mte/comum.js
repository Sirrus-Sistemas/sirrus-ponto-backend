// Utilitários dos arquivos do Ministério do Trabalho (AFD, AFDT, ACJEF, AEJ).
// Layouts portados de sirrus-ponto-velox-delphi/pas/DM_F.pas (GerarAFD,
// GerarAFDT, GerarACJEF, GerarAEJ) e das Portarias 1510/2009 e 671/2021.

/** Desenvolvedor do programa de tratamento (registro 08 do AEJ / cabeçalho do AFD). */
export const DESENVOLVEDOR = {
  programa: 'SIRRUS PONTO',
  tipoIdentificacao: '1', // 1 = CNPJ
  cnpj: process.env.MTE_DESENVOLVEDOR_CNPJ || '10692111000160',
  razaoSocial: process.env.MTE_DESENVOLVEDOR_RAZAO || 'WORK SOFT COMERCIO DE INFORMATICA E SERVICOS LTDA',
  email: process.env.MTE_DESENVOLVEDOR_EMAIL || 'desenvolvimento@sirrus.com.br',
};

/**
 * Número de registro do REP-P (app/web) no INPI — 17 dígitos. Sem ele o
 * legado usava 9s (placeholder); configure REP_P_NUMERO_INPI no .env.
 */
export const NUMERO_REP_P = (process.env.REP_P_NUMERO_INPI || '99999999999999999').replace(/\D/g, '').padStart(17, '0').slice(-17);

export const digitos = (v) => String(v ?? '').replace(/\D/g, '');

/** Número com zeros à esquerda, cortado no tamanho (campos numéricos de largura fixa). */
export const num = (v, tam) => digitos(v).padStart(tam, '0').slice(-tam);

/** Texto alinhado à esquerda e completado com espaços (campos alfanuméricos de largura fixa). */
export const alfa = (v, tam) => String(v ?? '').replace(/[\r\n|]/g, ' ').padEnd(tam, ' ').slice(0, tam);

/** Texto para campo delimitado por "|" (AEJ): sem quebras nem pipe, sem espaço sobrando. */
export const campo = (v) => String(v ?? '').replace(/[\r\n|]/g, ' ').trim();

/** Minutos → "hhmm" (4 dígitos). */
export function hhmm(minutos) {
  const m = Math.max(0, Math.round(Number(minutos) || 0));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}${String(m % 60).padStart(2, '0')}`.slice(-4);
}

/** "08:30" / "08:30:00" → "0830"; vazio → "". */
export const horaSemDoisPontos = (h) => (h ? String(h).slice(0, 5).replace(':', '') : '');

/** "08:30:00" → minutos. */
export function horaParaMinutos(h) {
  if (!h) return 0;
  const [hh, mm] = String(h).split(':').map(Number);
  return (hh || 0) * 60 + (mm || 0);
}

/** "YYYY-MM-DD" → "ddmmaaaa" (Portaria 1510). */
export const ddmmaaaa = (iso) => `${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(0, 4)}`;

/** "-04:00" → "-0400". */
export const offsetCompacto = (tz) => String(tz || '-03:00').replace(':', '');

/** Offset "-04:00" → milissegundos. */
export function offsetMs(tz) {
  const m = String(tz || '-03:00').match(/^([+-])(\d{2}):(\d{2})$/);
  if (!m) return -3 * 3600000;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) * 60000;
}

/** Date (instante) → "AAAA-MM-DDThh:mm:00-0400" no fuso informado (Portaria 671). */
export function dataHora671(date, tz) {
  const local = new Date(date.getTime() + offsetMs(tz)).toISOString();
  return `${local.slice(0, 16)}:00${offsetCompacto(tz)}`;
}

/**
 * CRC-16 dos registros do AFD — mesma implementação do legado
 * (TDM.CalcularCRC16: polinômio 0x1021, valor inicial 0x0000 = CRC-16/XMODEM),
 * sobre os bytes ISO-8859-1 da linha. Hex maiúsculo, 4 caracteres.
 */
export function crc16(texto) {
  let crc = 0x0000;
  for (const b of Buffer.from(texto, 'latin1')) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Linhas → conteúdo do arquivo: CRLF e ISO-8859-1, como o TStringList.SaveToFile
 * do legado gravava. Caracteres fora do Latin-1 viram "?".
 */
export function montarArquivo(linhas) {
  const texto = linhas.join('\r\n') + '\r\n';
  return Buffer.from(texto.replace(/[^\u0000-ÿ]/g, '?'), 'latin1');
}

/** Identificação do empregador a partir do documento da filial. */
export function identificacaoEmpregador(documento) {
  const doc = digitos(documento);
  return { tipo: doc.length === 11 ? '2' : '1', documento: doc };
}

/**
 * Percentual da hora extra (ACJEF) conforme a lotação — mesma tabela do legado
 * (TP_HORAEXTRA → '5000', '6000', '7000', '8000', '1000' = 100%).
 */
export function percentualExtra(tipoExtra) {
  return { '50_clt': '5000', 60: '6000', 80: '8000', 100: '1000' }[tipoExtra] ?? '5000';
}
