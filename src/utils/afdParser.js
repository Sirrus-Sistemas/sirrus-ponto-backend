// Parser do arquivo AFD (Arquivo Fonte de Dados) — usado tanto na
// importação manual por upload (relógios AFD, sem rede) quanto, em
// espírito, no agente de coleta via TCP/IP (mesma lógica, portada de lá).
// O layout é definido por portaria (1510 ou 671) e é o mesmo para
// qualquer fabricante: é um padrão regulatório do Ministério do
// Trabalho, não específico de equipamento.

// substr replica Copy(s, start, length) do Delphi (1-indexado): só
// devolve a fatia se a linha for longa o bastante; senão, null — é assim
// que registros de outro tipo/tamanho (mais curtos) são descartados sem
// lançar exceção.
function substr(s, start, length) {
  const i = start - 1;
  if (i < 0 || length < 0 || i + length > s.length) return null;
  return s.slice(i, i + length);
}

function anoRazoavel(ano) {
  const anoAtual = new Date().getFullYear();
  return ano >= 2000 && ano <= anoAtual + 1;
}

/**
 * Layout da portaria 1510: NSR(9) TIPO(1) DDMMAAAA(8) HHMM(4) PIS(12).
 * Não filtra por tipo — o 1510 não distingue tipos de registro do jeito
 * que o AFD-T da 671 faz.
 */
function parseLinha1510(linha) {
  const nsrStr = substr(linha, 1, 9);
  const dia = substr(linha, 11, 2);
  const mes = substr(linha, 13, 2);
  const ano = substr(linha, 15, 4);
  const hora = substr(linha, 19, 2);
  const minuto = substr(linha, 21, 2);
  const pisStr = substr(linha, 23, 12);
  if ([nsrStr, dia, mes, ano, hora, minuto, pisStr].some((v) => v === null)) return null;

  const nsr = parseInt(nsrStr, 10);
  const pis = pisStr.trim();
  if (!Number.isInteger(nsr) || nsr <= 0 || !pis) return null;
  if (!anoRazoavel(Number(ano))) return null;

  return { nsr, pis, dataHora: `${ano}-${mes}-${dia} ${hora}:${minuto}:00` };
}

/**
 * Layout real da portaria 671 (validado contra arquivo AFD de um
 * equipamento control iD de verdade — diverge do que o sistema legado em
 * Delphi assumia): NSR(10) DATAHORA-ISO-COM-FUSO(24, ex.:
 * "2025-07-20T19:22:00-0400") TIPO(1) CPF(11) CHECKSUM(4) = 50
 * caracteres. Só sobrevive quando TIPO == '0' (marcação original) — o
 * mesmo arquivo tem outros tipos de registro (cabeçalho, inclusão de
 * funcionário com nome, etc.), sempre com comprimento de linha diferente.
 *
 * O fuso embutido em cada registro (equipamentos no Amazonas, por
 * exemplo, gravam "-0400", não "-0300") é ignorado de propósito: o
 * sistema não converte fuso horário nenhum, ele só preserva os dígitos de
 * relógio de parede exatamente como o equipamento os registrou — a mesma
 * hora que aparece no relógio deve aparecer na ficha de ponto, não importa
 * o fuso real de onde o equipamento está fisicamente instalado.
 */
function parseLinha671(linha) {
  const nsrStr = substr(linha, 1, 10);
  const dataHoraIso = substr(linha, 11, 24);
  const tipo = substr(linha, 35, 1);
  const cpfStr = substr(linha, 36, 11);
  if ([nsrStr, dataHoraIso, tipo, cpfStr].some((v) => v === null)) return null;
  if (tipo !== '0') return null;

  const nsr = parseInt(nsrStr, 10);
  const cpf = cpfStr.trim();
  if (!Number.isInteger(nsr) || nsr <= 0 || !/^\d{11}$/.test(cpf)) return null;

  // Só os 19 primeiros caracteres (AAAA-MM-DDTHH:MM:SS) importam — os 5
  // últimos (o offset de fuso) são descartados sem conversão nenhuma.
  const dataHoraLiteral = dataHoraIso.slice(0, 19);
  const ano = Number(dataHoraLiteral.slice(0, 4));
  if (!anoRazoavel(ano)) return null;

  return { nsr, cpf, dataHora: dataHoraLiteral.replace('T', ' ') };
}

/**
 * Deriva de qual portaria é o AFD a partir do modelo cadastrado do
 * relógio: modelos com sufixo "_671" (ou idface_671) identificam
 * funcionário por CPF; os demais, pela portaria 1510, por PIS.
 */
export function chaveParaModelo(modelo) {
  return modelo && modelo.includes('671') ? 'cpf' : 'pis';
}

/**
 * Parseia o conteúdo de um arquivo AFD inteiro, uma linha de texto por
 * marcação. chave decide o layout: 'pis' -> portaria 1510, 'cpf' -> 671.
 * Linhas curtas demais, malformadas, ou de outro tipo de registro são
 * descartadas silenciosamente — o mesmo critério usado na coleta via
 * rede.
 */
export function parseAfd(conteudo, chave) {
  const linhas = conteudo.replace(/\r\n/g, '\n').split('\n');

  const marcacoes = [];
  for (const linhaBruta of linhas) {
    const linha = linhaBruta.replace(/\r$/, '');
    if (!linha.trim()) continue;

    const marcacao = chave === 'cpf' ? parseLinha671(linha) : parseLinha1510(linha);
    if (marcacao) marcacoes.push(marcacao);
  }
  return marcacoes;
}
