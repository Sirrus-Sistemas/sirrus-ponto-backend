import ExcelJS from 'exceljs';

// Linha 1 = instrução, linha 2 = cabeçalho, dados a partir da linha 3 — o
// mesmo layout nos três modelos (lotações, turnos, funcionários), para que
// quem preenche uma planilha já reconheça o padrão nas outras.
const LINHA_INSTRUCAO = 1;
const LINHA_CABECALHO = 2;
const PRIMEIRA_LINHA_DADOS = 3;

/**
 * Gera o .xlsx modelo para download: uma aba com a instrução na linha 1
 * (mesclada), cabeçalho em negrito na linha 2, e colunas já formatadas
 * como texto (evita o Excel "corrigir" CPF/horário para número/data).
 */
export async function criarModeloXlsx({ titulo, instrucao, colunas }) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(titulo);

  sheet.mergeCells(LINHA_INSTRUCAO, 1, LINHA_INSTRUCAO, colunas.length);
  const cellInstrucao = sheet.getCell(LINHA_INSTRUCAO, 1);
  cellInstrucao.value = instrucao;
  cellInstrucao.font = { italic: true, color: { argb: 'FF555555' } };
  cellInstrucao.alignment = { wrapText: true, vertical: 'top' };
  sheet.getRow(LINHA_INSTRUCAO).height = 45;

  const headerRow = sheet.getRow(LINHA_CABECALHO);
  colunas.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = col.titulo;
    cell.font = { bold: true };
    const coluna = sheet.getColumn(i + 1);
    coluna.width = col.largura ?? 22;
    if (col.textoLivre) coluna.numFmt = '@';
  });

  return workbook.xlsx.writeBuffer();
}

/**
 * Lê as linhas de dados de um .xlsx (a partir da linha 3, ver acima),
 * ignorando linhas totalmente vazias. Devolve, para cada linha, o número
 * da linha na planilha (para reportar erro no lugar certo) e as células
 * brutas — quem chama decide como interpretar cada coluna (texto, hora,
 * data, número).
 */
export async function lerLinhasXlsx(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const linhas = [];
  sheet.eachRow({ includeEmpty: false }, (row, numeroLinha) => {
    if (numeroLinha < PRIMEIRA_LINHA_DADOS) return;

    const celulas = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumero) => {
      celulas[colNumero - 1] = cell;
    });

    const vazia = celulas.every((c) => {
      const v = valorBruto(c);
      return v == null || v === '';
    });
    if (vazia) return;

    linhas.push({ numeroLinha, celulas });
  });
  return linhas;
}

/** Valor da célula sem interpretação — string, Date, número, ou '' se vazia. */
function valorBruto(cell) {
  if (!cell || cell.value == null) return '';
  const v = cell.value;
  if (v instanceof Date) return v;
  if (typeof v === 'object' && Array.isArray(v.richText)) {
    return v.richText.map((r) => r.text).join('').trim();
  }
  if (typeof v === 'object' && typeof v.text === 'string' && 'hyperlink' in v) return v.text.trim();
  if (typeof v === 'object' && 'result' in v) return String(v.result ?? '').trim();
  return v;
}

/** Texto simples de uma célula (nome, email, CPF etc.), já com trim. */
export function textoDaCelula(cell) {
  const v = valorBruto(cell);
  if (v instanceof Date) return '';
  return String(v ?? '').trim();
}

/** Interpreta a célula como horário HH:MM — aceita string digitada ou hora do Excel. */
export function horaDaCelula(cell) {
  const v = valorBruto(cell);
  if (v instanceof Date) {
    const hh = String(v.getUTCHours()).padStart(2, '0');
    const mm = String(v.getUTCMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }
  return String(v ?? '').trim();
}

/** Interpreta a célula como data — aceita DD/MM/AAAA, AAAA-MM-DD ou data do Excel. Retorna null se inválida. */
export function dataDaCelula(cell) {
  const v = valorBruto(cell);
  if (v instanceof Date) {
    const yyyy = v.getUTCFullYear();
    const mm = String(v.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(v.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  const s = String(v ?? '').trim();
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

/** Número inteiro de uma célula, ou undefined se vazia (para campos opcionais com default). */
export function inteiroDaCelula(cell) {
  const texto = textoDaCelula(cell);
  if (texto === '') return undefined;
  const n = parseInt(texto, 10);
  return Number.isFinite(n) ? n : NaN;
}
