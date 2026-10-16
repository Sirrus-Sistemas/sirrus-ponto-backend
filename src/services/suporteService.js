import crypto from 'crypto';
import { query } from '../config/database.js';
import { cpfValido, onlyCpfDigits } from '../utils/cpf.js';

// Acesso do suporte técnico da Sirrus a qualquer empresa: CPF do técnico +
// senha diária. Mesma regra do gerador do legado (UPrincipal.pas):
//   senha = Copy(MD5(CPF + DateToStr(Data) + SAL), 10, 6)
// DateToStr em pt-BR = "dd/mm/aaaa"; o Indy devolve o MD5 em hex maiúsculo.

const SAL = 'azwsxedcrfvtgbyhnujmik,ol.';

/**
 * CPFs autorizados (SUPORTE_CPFS no .env, separados por vírgula). Sem a lista
 * o acesso de suporte fica DESLIGADO: o algoritmo está no código, então só a
 * lista impede que qualquer CPF válido vire administrador de todos os clientes.
 */
function cpfsAutorizados() {
  return new Set(
    String(process.env.SUPORTE_CPFS || '').split(',').map(onlyCpfDigits).filter((c) => c.length === 11),
  );
}

/** Data de hoje em Brasília (a do gerador de senhas), "dd/mm/aaaa". */
function hojeBrasilia(agora = new Date()) {
  const [a, m, d] = agora.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }).split('-');
  return `${d}/${m}/${a}`;
}

/** Senha diária do CPF na data ("dd/mm/aaaa"). */
export function senhaDiaria(cpf, data = hojeBrasilia()) {
  const md5 = crypto
    .createHash('md5')
    .update(`${onlyCpfDigits(cpf)}${data}${SAL}`, 'latin1')
    .digest('hex')
    .toUpperCase();
  return md5.slice(9, 15);
}

/** CPF na lista de autorizados e senha = senha diária de hoje. */
export function ehLoginSuporte(cpf, senha) {
  const digits = onlyCpfDigits(cpf);
  if (!cpfValido(digits) || !cpfsAutorizados().has(digits)) return false;
  const esperada = Buffer.from(senhaDiaria(digits));
  const recebida = Buffer.from(String(senha ?? '').trim().toUpperCase());
  return esperada.length === recebida.length && crypto.timingSafeEqual(esperada, recebida);
}

/** Empresas para o técnico escolher (busca por nome ou CNPJ). */
export async function buscarEmpresas(busca) {
  const termo = String(busca ?? '').trim();
  const digits = termo.replace(/\D/g, '');
  const params = [];
  let filtro = '';
  if (termo) {
    filtro = ' WHERE (e.razao_social LIKE ? OR e.nome_fantasia LIKE ?'
      + (digits ? " OR REPLACE(REPLACE(REPLACE(e.cnpj, '.', ''), '/', ''), '-', '') LIKE ?" : '')
      + ')';
    params.push(`%${termo}%`, `%${termo}%`);
    if (digits) params.push(`%${digits}%`);
  }
  return query(
    `SELECT e.id, e.razao_social, e.nome_fantasia, e.cnpj, e.ativa
       FROM empresas e${filtro}
      ORDER BY e.ativa DESC, e.razao_social
      LIMIT 50`,
    params,
  );
}

/** Funcionário técnico "SUPORTE SIRRUS" da empresa (criado na primeira entrada). */
export async function garantirFuncionarioSuporte(empresaId) {
  const [existente] = await query(
    'SELECT id FROM funcionarios WHERE empresa_id = ? AND suporte_sirrus = 1 LIMIT 1',
    [empresaId],
  );
  if (existente) return existente.id;
  const r = await query(
    `INSERT INTO funcionarios (empresa_id, nome, email, role, ativo, controla_ponto, suporte_sirrus)
     VALUES (?, 'SUPORTE SIRRUS', 'suporte@sirrus.com.br', 'admin', 1, 0, 1)`,
    [empresaId],
  );
  return r.insertId;
}
