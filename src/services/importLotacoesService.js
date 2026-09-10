import { query } from '../config/database.js';
import { criarModeloXlsx, lerLinhasXlsx, textoDaCelula } from '../utils/xlsxImport.js';

const COLUNAS = [{ titulo: 'Nome*', largura: 40, textoLivre: true }];

/**
 * Modelo de import de lotações: só o nome. As ~20 flags de regra de
 * cálculo (tipo de hora extra, domingo/feriado, banco de horas etc.)
 * ficam com o padrão do sistema — ajuste manual depois em Lotações para
 * quem precisar de algo diferente do padrão.
 */
export async function gerarModeloLotacoes() {
  return criarModeloXlsx({
    titulo: 'Lotações',
    instrucao:
      'Preencha um nome de lotação por linha, a partir da linha 3. Não altere a linha 2 (cabeçalho). ' +
      'As regras de cálculo de cada lotação (hora extra, domingo, feriado, banco de horas etc.) ficam ' +
      'com o padrão do sistema — ajuste manualmente depois em Lotações se precisar de algo diferente.',
    colunas: COLUNAS,
  });
}

/**
 * Valida todas as linhas antes de gravar qualquer coisa (tudo ou nada).
 * Retorna { erros } se qualquer linha falhar, ou { importados } se tudo
 * passou e já foi inserido.
 */
export async function importarLotacoes(buffer, empresaId) {
  const linhas = await lerLinhasXlsx(buffer);
  if (linhas.length === 0) {
    return { erros: [{ linha: 3, campo: 'Nome', mensagem: 'A planilha não tem nenhuma linha preenchida.' }] };
  }

  const existentes = await query('SELECT nome FROM lotacoes WHERE empresa_id = ?', [empresaId]);
  const nomesExistentes = new Set(existentes.map((r) => r.nome.trim().toLowerCase()));

  const erros = [];
  const nomesNoArquivo = new Set();
  const validas = [];

  for (const { numeroLinha, celulas } of linhas) {
    const nome = textoDaCelula(celulas[0]);
    if (nome.length < 2) {
      erros.push({ linha: numeroLinha, campo: 'Nome', mensagem: 'Informe um nome com pelo menos 2 caracteres.' });
      continue;
    }

    const chave = nome.toLowerCase();
    if (nomesExistentes.has(chave) || nomesNoArquivo.has(chave)) {
      erros.push({ linha: numeroLinha, campo: 'Nome', mensagem: `Já existe uma lotação chamada "${nome}".` });
      continue;
    }

    nomesNoArquivo.add(chave);
    validas.push(nome);
  }

  if (erros.length > 0) return { erros };

  for (const nome of validas) {
    await query('INSERT INTO lotacoes (empresa_id, nome) VALUES (?, ?)', [empresaId, nome]);
  }

  return { importados: validas.length };
}
