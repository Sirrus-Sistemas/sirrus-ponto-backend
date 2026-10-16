import { query } from '../config/database.js';

// Cerca eletrônica do Ponto Mobile — configuração por filial, lotação e
// funcionário (ver migration 053). A API do Ponto Mobile só conhece a cerca
// do funcionário; resolverParaFuncionario monta o que vai na sincronização.

export const ESCOPOS = ['filial', 'lotacao', 'funcionario'];

const TABELA = { filial: 'filiais', lotacao: 'lotacoes', funcionario: 'funcionarios' };

function mapLocal(r) {
  return {
    id: r.id,
    descricao: r.descricao,
    latitude: Number(r.latitude),
    longitude: Number(r.longitude),
    raio_metros: Number(r.raio_metros),
  };
}

/** Dono (filial/lotação/funcionário) — null se não existe ou é de outra empresa. */
export async function buscarDono(escopo, id, empresaId) {
  const [row] = await query(
    `SELECT id, empresa_id, valida_localizacao FROM ${TABELA[escopo]} WHERE id = ? LIMIT 1`,
    [id],
  );
  if (!row || row.empresa_id !== empresaId) return null;
  return row;
}

export async function listarLocais(escopo, id) {
  const rows = await query(
    `SELECT id, descricao, latitude, longitude, raio_metros
       FROM cerca_locais WHERE escopo = ? AND referencia_id = ? ORDER BY id`,
    [escopo, id],
  );
  return rows.map(mapLocal);
}

/** Converte a coluna (TINYINT NULL) para o valor da tela. */
function validaParaTela(v) {
  if (v === null || v === undefined) return 'herdar';
  return Number(v) === 1 ? 'sim' : 'nao';
}

/**
 * Configuração de um nível + o que ele herda (para a tela mostrar os locais
 * e a regra que vêm de cima).
 */
export async function obterConfiguracao(escopo, id, empresaId) {
  const dono = await buscarDono(escopo, id, empresaId);
  if (!dono) return null;
  const config = {
    valida_localizacao: escopo === 'filial'
      ? (Number(dono.valida_localizacao) === 1 ? 'sim' : 'nao')
      : validaParaTela(dono.valida_localizacao),
    locais: await listarLocais(escopo, id),
    herdado: null,
  };

  if (escopo === 'funcionario') {
    const [f] = await query(
      `SELECT f.filial_id, f.lotacao_id, fi.nome AS filial_nome, l.nome AS lotacao_nome
         FROM funcionarios f
         LEFT JOIN filiais fi ON fi.id = f.filial_id
         LEFT JOIN lotacoes l ON l.id = f.lotacao_id
        WHERE f.id = ?`,
      [id],
    );
    const resolvido = await resolverParaFuncionario(id);
    config.herdado = {
      filial: f?.filial_id ? { nome: f.filial_nome, locais: await listarLocais('filial', f.filial_id) } : null,
      lotacao: f?.lotacao_id ? { nome: f.lotacao_nome, locais: await listarLocais('lotacao', f.lotacao_id) } : null,
      valida_localizacao_efetiva: resolvido.validaLocalizacao,
      origem_validacao: resolvido.origem,
    };
  }
  return config;
}

/** Substitui a regra e os locais de um nível. */
export async function salvarConfiguracao(escopo, id, empresaId, { valida_localizacao, locais }) {
  let valor;
  if (escopo === 'filial') valor = valida_localizacao === 'sim' ? 1 : 0;
  else valor = valida_localizacao === 'herdar' ? null : (valida_localizacao === 'sim' ? 1 : 0);
  await query(`UPDATE ${TABELA[escopo]} SET valida_localizacao = ? WHERE id = ?`, [valor, id]);

  await query('DELETE FROM cerca_locais WHERE escopo = ? AND referencia_id = ?', [escopo, id]);
  for (const l of locais) {
    await query(
      `INSERT INTO cerca_locais (empresa_id, escopo, referencia_id, descricao, latitude, longitude, raio_metros)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [empresaId, escopo, id, l.descricao?.trim() || null, l.latitude, l.longitude, Math.round(l.raio_metros)],
    );
  }
}

/**
 * Cerca final de um funcionário para o Ponto Mobile:
 *  - validaLocalizacao: funcionário → lotação → filial (o primeiro definido);
 *  - locais: soma dos locais da filial, da lotação e do funcionário.
 */
export async function resolverParaFuncionario(funcionarioId) {
  const [f] = await query(
    `SELECT f.id, f.filial_id, f.lotacao_id, f.valida_localizacao AS v_func,
            l.valida_localizacao AS v_lot, fi.valida_localizacao AS v_fil
       FROM funcionarios f
       LEFT JOIN lotacoes l ON l.id = f.lotacao_id
       LEFT JOIN filiais fi ON fi.id = f.filial_id
      WHERE f.id = ?`,
    [funcionarioId],
  );
  if (!f) return { validaLocalizacao: false, origem: null, locais: [] };

  let validaLocalizacao = false;
  let origem = null;
  if (f.v_func !== null) { validaLocalizacao = Number(f.v_func) === 1; origem = 'funcionario'; }
  else if (f.lotacao_id && f.v_lot !== null) { validaLocalizacao = Number(f.v_lot) === 1; origem = 'lotacao'; }
  else if (f.filial_id) { validaLocalizacao = Number(f.v_fil) === 1; origem = 'filial'; }

  const locais = [
    ...(f.filial_id ? await listarLocais('filial', f.filial_id) : []),
    ...(f.lotacao_id ? await listarLocais('lotacao', f.lotacao_id) : []),
    ...(await listarLocais('funcionario', f.id)),
  ];
  return { validaLocalizacao, origem, locais };
}
