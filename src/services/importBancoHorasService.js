import { query } from '../config/database.js';
import { BancoHorasRepository } from '../repositories/bancoHorasRepository.js';
import { onlyCpfDigits } from '../utils/cpf.js';
import { criarModeloXlsx, lerLinhasXlsx, textoDaCelula, dataDaCelula } from '../utils/xlsxImport.js';

// Mesma ordem de colunas do export do Sirrus Ponto Velox (uFormExportarCadastro.pas,
// botão "Exportar Banco de Horas") — o admin pode subir esse arquivo direto,
// sem reformatar nada.
const COLUNAS = [
  { titulo: 'Nome', largura: 30, textoLivre: true },
  { titulo: 'CPF*', largura: 16, textoLivre: true },
  { titulo: 'Data', largura: 14, textoLivre: true },
  { titulo: 'Mês/Ano* (MM/AAAA)', largura: 16, textoLivre: true },
  { titulo: 'Tipo* (CREDITO/DEBITO)', largura: 20, textoLivre: true },
  { titulo: 'Tipo de Hora* (50%/100%)', largura: 20, textoLivre: true },
  { titulo: 'Qtde Horas* (HH:MM)', largura: 16, textoLivre: true },
  { titulo: 'Motivo', largura: 30, textoLivre: true },
  { titulo: 'Usuário', largura: 16, textoLivre: true },
  { titulo: 'Origem', largura: 12, textoLivre: true },
];

const TIPO_HORA_MAP = { '50%': '50pct', '100%': '100pct' };

/** "HH:MM" (aceita qualquer nº de dígitos na hora, ex.: "000:16", "0000:00") → minutos. null se inválido. */
function minutosDeHHMM(texto) {
  const m = texto.trim().match(/^(\d{1,4}):([0-5]?\d)$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** "MM/AAAA" → "AAAA-MM". null se inválido. */
function mesAnoParaReferencia(texto) {
  const m = texto.trim().match(/^(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const mes = Number(m[1]);
  if (mes < 1 || mes > 12) return null;
  return `${m[2]}-${m[1]}`;
}

/**
 * Modelo de import do banco de horas. Migração única do Sirrus Ponto Velox —
 * não faz parte do assistente de cadastro inicial (lotações/turnos/
 * funcionários), por isso não segue aquela numeração de passos.
 */
export async function gerarModeloBancoHoras() {
  return criarModeloXlsx({
    titulo: 'Banco de Horas',
    instrucao:
      'Preencha um lançamento por linha, a partir da linha 3. Não altere a linha 2 (cabeçalho). ' +
      'Pode subir direto o arquivo exportado do Sirrus Ponto Velox (mesma ordem de colunas), sem reformatar. ' +
      'O CPF precisa já estar cadastrado em Funcionários. Linhas com 0h00 de crédito/débito são ignoradas ' +
      '(não afetam saldo nenhum).',
    colunas: COLUNAS,
  });
}

export async function importarBancoHoras(buffer, empresaId, usuarioId) {
  const linhas = await lerLinhasXlsx(buffer);
  if (linhas.length === 0) {
    return { erros: [{ linha: 3, campo: 'CPF', mensagem: 'A planilha não tem nenhuma linha preenchida.' }] };
  }

  const funcionarios = await query(
    'SELECT id, cpf FROM funcionarios WHERE empresa_id = ? AND cpf IS NOT NULL',
    [empresaId],
  );
  const funcionarioPorCpf = new Map(funcionarios.map((f) => [onlyCpfDigits(f.cpf), f.id]));

  const erros = [];
  const validas = [];

  for (const { numeroLinha, celulas } of linhas) {
    const cpf = onlyCpfDigits(textoDaCelula(celulas[1]));
    const dataTexto = textoDaCelula(celulas[2]);
    const mesAnoTexto = textoDaCelula(celulas[3]);
    const tipoTexto = textoDaCelula(celulas[4]).toLowerCase();
    const tipoHoraTexto = textoDaCelula(celulas[5]);
    const qtdeHorasTexto = textoDaCelula(celulas[6]);
    const motivo = textoDaCelula(celulas[7]);
    const usuarioOriginal = textoDaCelula(celulas[8]);
    const origemOriginal = textoDaCelula(celulas[9]);

    // Linha "zerada" (crédito ou débito de 0h00) — o Sirrus Ponto Velox grava uma
    // linha dessas em todo fechamento automático (ver comentário no export),
    // só pra registrar que não houve o outro lado. Não afeta saldo nenhum,
    // então é ignorada em silêncio em vez de reportada como erro.
    const minutosPreCheck = minutosDeHHMM(qtdeHorasTexto);
    if (minutosPreCheck === 0) continue;

    let temErro = false;
    const erro = (campo, mensagem) => { erros.push({ linha: numeroLinha, campo, mensagem }); temErro = true; };

    let funcionarioId = null;
    if (cpf.length !== 11) {
      erro('CPF', 'Informe os 11 dígitos do CPF.');
    } else {
      funcionarioId = funcionarioPorCpf.get(cpf) ?? null;
      if (funcionarioId === null) {
        erro('CPF', `Nenhum funcionário com CPF ${cpf} encontrado nesta empresa — cadastre-o antes de importar.`);
      }
    }

    const mesReferencia = mesAnoParaReferencia(mesAnoTexto);
    if (!mesReferencia) erro('Mês/Ano', 'Use o formato MM/AAAA.');

    const tipo = tipoTexto === 'credito' ? 'credito' : tipoTexto === 'debito' ? 'debito' : null;
    if (!tipo) erro('Tipo', 'Deve ser CREDITO ou DEBITO.');

    const tipoHora = TIPO_HORA_MAP[tipoHoraTexto.trim()] ?? null;
    if (!tipoHora) erro('Tipo de Hora', 'Deve ser 50% ou 100%.');

    const minutos = minutosPreCheck;
    if (minutos == null) erro('Qtde Horas', 'Use o formato HH:MM.');

    if (dataTexto !== '' && !dataDaCelula(celulas[2])) erro('Data', 'Use o formato DD/MM/AAAA.');

    if (temErro) continue;

    const data = dataDaCelula(celulas[2]) || `${mesReferencia}-01`;
    const notaOrigem = usuarioOriginal || origemOriginal
      ? `Velox: usuário ${usuarioOriginal || '—'}, origem ${origemOriginal || '—'}`
      : null;
    const descricao = [motivo || null, notaOrigem].filter(Boolean).join(' — ') || null;

    validas.push({ funcionario_id: funcionarioId, data, mes_referencia: mesReferencia, tipo, tipo_hora: tipoHora, minutos, descricao });
  }

  if (erros.length > 0) return { erros };

  // Insere em ordem cronológica (por mês/ano) — cada lançamento calcula seu
  // saldo_anterior/saldo_posterior a partir do que já foi gravado antes dele
  // (ver BancoHorasRepository.lancar), então a ordem de inserção precisa
  // seguir a ordem real dos fatos, não a ordem em que vieram na planilha.
  validas.sort((a, b) => a.mes_referencia.localeCompare(b.mes_referencia));

  let importados = 0;
  for (const v of validas) {
    await BancoHorasRepository.lancar({
      funcionario_id: v.funcionario_id,
      data: v.data,
      mes_referencia: v.mes_referencia,
      tipo: v.tipo,
      tipo_hora: v.tipo_hora,
      minutos: v.minutos,
      descricao: v.descricao,
      origem: 'manual',
      created_by: usuarioId,
    });
    importados++;
  }

  return { importados };
}
