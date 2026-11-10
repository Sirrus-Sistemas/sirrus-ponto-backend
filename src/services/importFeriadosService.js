import { query } from '../config/database.js';
import { criarModeloXlsx, lerLinhasXlsx, textoDaCelula, dataDaCelula } from '../utils/xlsxImport.js';

const TIPOS_VALIDOS = ['nacional', 'estadual', 'municipal', 'empresa'];
const RECORRENTE_SIM = ['sim', 's', '1', 'true'];
const RECORRENTE_VALIDOS = [...RECORRENTE_SIM, 'não', 'nao', 'n', '0', 'false'];

const COLUNAS = [
  { titulo: 'Nome*', largura: 40, textoLivre: true },
  { titulo: 'Data* (DD/MM/AAAA)', largura: 20, textoLivre: true },
  { titulo: 'Tipo (nacional/estadual/municipal/empresa)', largura: 26, textoLivre: true },
  { titulo: 'Recorrente (Sim/Não)', largura: 18, textoLivre: true },
  { titulo: 'UF', largura: 8, textoLivre: true },
];

/**
 * Modelo de import de feriados: Município fica de fora — resolver um nome de
 * cidade digitado numa planilha contra ~5.500 municípios (muitos com o mesmo
 * nome em estados diferentes) é ambíguo demais pra fazer sem um combobox.
 * Feriado municipal continua só pelo formulário da tela.
 */
export async function gerarModeloFeriados() {
  return criarModeloXlsx({
    titulo: 'Feriados',
    instrucao:
      'Preencha um feriado por linha, a partir da linha 3. Não altere a linha 2 (cabeçalho). ' +
      'Tipo padrão é "empresa" se deixar em branco. Marque Recorrente = Sim para feriados fixos que se repetem ' +
      'todo ano (ex.: 25/12) — nesse caso o ano da Data não importa, só dia e mês. ' +
      'Feriados nacionais móveis (Carnaval, Sexta-Feira Santa, Corpus Christi) têm botão próprio de ' +
      'importação automática na tela — não precisa digitar aqui.',
    colunas: COLUNAS,
  });
}

/**
 * Valida todas as linhas antes de gravar qualquer coisa (tudo ou nada).
 * Retorna { erros } se qualquer linha falhar, ou { importados } se tudo
 * passou e já foi inserido.
 */
export async function importarFeriados(buffer, empresaId) {
  const linhas = await lerLinhasXlsx(buffer);
  if (linhas.length === 0) {
    return { erros: [{ linha: 3, campo: 'Nome', mensagem: 'A planilha não tem nenhuma linha preenchida.' }] };
  }

  const existentes = await query('SELECT data FROM feriados WHERE empresa_id = ?', [empresaId]);
  const datasExistentes = new Set(existentes.map((r) => String(r.data).slice(0, 10)));

  const erros = [];
  const datasNoArquivo = new Set();
  const validas = [];

  for (const { numeroLinha, celulas } of linhas) {
    const nome = textoDaCelula(celulas[0]);
    const dataTexto = textoDaCelula(celulas[1]);
    const tipoTexto = textoDaCelula(celulas[2]).toLowerCase();
    const recorrenteTexto = textoDaCelula(celulas[3]).toLowerCase();
    const uf = textoDaCelula(celulas[4]).toUpperCase();

    let temErro = false;
    const erro = (campo, mensagem) => { erros.push({ linha: numeroLinha, campo, mensagem }); temErro = true; };

    if (nome.length < 2) erro('Nome', 'Informe um nome com pelo menos 2 caracteres.');

    const dataIso = dataDaCelula(celulas[1]);
    if (!dataIso) erro('Data', `Use o formato DD/MM/AAAA (recebido: "${dataTexto}").`);

    if (tipoTexto !== '' && !TIPOS_VALIDOS.includes(tipoTexto)) {
      erro('Tipo', 'Deve ser nacional, estadual, municipal ou empresa (ou deixe em branco).');
    }

    if (recorrenteTexto !== '' && !RECORRENTE_VALIDOS.includes(recorrenteTexto)) {
      erro('Recorrente', 'Deve ser Sim ou Não (ou deixe em branco).');
    }

    if (uf !== '' && uf.length !== 2) erro('UF', 'Use a sigla de 2 letras (ex.: SP).');

    if (temErro) continue;

    const recorrente = RECORRENTE_SIM.includes(recorrenteTexto);
    const dataDb = recorrente ? `2000-${dataIso.slice(5)}` : dataIso;

    if (datasExistentes.has(dataDb) || datasNoArquivo.has(dataDb)) {
      erro('Data', `Já existe um feriado cadastrado em ${dataTexto}.`);
      continue;
    }
    datasNoArquivo.add(dataDb);

    validas.push({ nome, data: dataDb, tipo: tipoTexto || 'empresa', recorrente: recorrente ? 1 : 0, uf: uf || null });
  }

  if (erros.length > 0) return { erros };

  for (const f of validas) {
    await query(
      'INSERT INTO feriados (empresa_id, data, descricao, tipo, recorrente, uf) VALUES (?, ?, ?, ?, ?, ?)',
      [empresaId, f.data, f.nome, f.tipo, f.recorrente, f.uf],
    );
  }

  return { importados: validas.length };
}

// ─── Importar feriados nacionais via BrasilAPI ───────────────────────────────
//
// https://brasilapi.com.br/api/feriados/v1/{ano} — pública, sem autenticação,
// já devolve as datas móveis (Carnaval, Sexta-Feira Santa, Corpus Christi)
// calculadas, então não precisamos calcular Páscoa aqui.

// Feriados nacionais de data fixa — marcados como recorrente (cadastra uma
// vez só, vale todo ano, não precisa reimportar). Os móveis variam a cada
// ano — ficam não-recorrentes; reimporte no ano seguinte quando quiser.
const NACIONAIS_FIXOS_MM_DD = new Set([
  '01-01', // Confraternização Universal
  '04-21', // Tiradentes
  '05-01', // Dia do Trabalho
  '09-07', // Independência
  '10-12', // Nossa Senhora Aparecida
  '11-02', // Finados
  '11-15', // Proclamação da República
  '11-20', // Dia da Consciência Negra (federal desde a Lei 14.759/2023)
  '12-25', // Natal
]);

/** Traduz a data da BrasilAPI pro formato gravado em `feriados.data` — "2000-MM-DD" quando é um feriado fixo (recorrente), ou a data real quando é móvel. */
function _dataDbNacional(dataApi) {
  const mmdd = String(dataApi).slice(5);
  const recorrente = NACIONAIS_FIXOS_MM_DD.has(mmdd);
  return { recorrente, dataDb: recorrente ? `2000-${mmdd}` : dataApi };
}

/**
 * Busca os feriados nacionais do ano na BrasilAPI SEM gravar nada — devolve a
 * lista pra tela mostrar um a um, com `ja_existe` indicando quais já estão
 * cadastrados (pra desabilitar o botão daquela linha).
 */
export async function listarFeriadosNacionaisApi(empresaId, ano) {
  const res = await fetch(`https://brasilapi.com.br/api/feriados/v1/${ano}`);
  if (!res.ok) throw new Error(`Não foi possível consultar a BrasilAPI (HTTP ${res.status}).`);
  const itens = await res.json();
  if (!Array.isArray(itens) || itens.length === 0) {
    throw new Error('A BrasilAPI não retornou feriados para esse ano.');
  }

  const existentes = await query('SELECT data FROM feriados WHERE empresa_id = ?', [empresaId]);
  const datasExistentes = new Set(existentes.map((r) => String(r.data).slice(0, 10)));

  return itens.map((item) => {
    const { recorrente, dataDb } = _dataDbNacional(item.date);
    return {
      data: item.date,
      nome: item.name,
      recorrente,
      ja_existe: datasExistentes.has(dataDb),
    };
  });
}

/** Importa um único feriado nacional (clicado na lista de `listarFeriadosNacionaisApi`). */
export async function importarFeriadoNacionalApi(empresaId, { data, nome }) {
  const { recorrente, dataDb } = _dataDbNacional(data);
  const [existente] = await query(
    'SELECT id FROM feriados WHERE empresa_id = ? AND data = ?',
    [empresaId, dataDb],
  );
  if (existente) throw new Error('Esse feriado já está cadastrado.');

  const result = await query(
    'INSERT INTO feriados (empresa_id, data, descricao, tipo, recorrente) VALUES (?, ?, ?, ?, ?)',
    [empresaId, dataDb, nome, 'nacional', recorrente ? 1 : 0],
  );
  return { id: result.insertId };
}
