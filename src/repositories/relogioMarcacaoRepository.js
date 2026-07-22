import { query } from '../config/database.js';
import { MarcacaoRepository } from './marcacaoRepository.js';

const LOTE = 500;

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Chave (funcionario_id, data_hora) — normaliza tanto um Date do mysql2 quanto a string "YYYY-MM-DD HH:MM:SS" do parser AFD para o mesmo formato. */
function chaveMarcacao(funcionarioId, dataHora) {
  const iso = dataHora instanceof Date ? dataHora.toISOString() : new Date(dataHora.replace(' ', 'T') + 'Z').toISOString();
  return `${funcionarioId}|${iso}`;
}

export const RelogioMarcacaoRepository = {
  /**
   * Mesmo pipeline de `importar`, mas processando um arquivo AFD inteiro em
   * lote — resolve funcionário e verifica duplicatas com poucas consultas
   * (uma tabela de funcionários e uma de NSRs já conhecidos, carregadas uma
   * única vez), em vez de várias consultas sequenciais por linha. Necessário
   * para arquivos grandes (relógio com anos de histórico): o pipeline linha
   * a linha original excede o tempo de uma requisição HTTP bem antes de
   * terminar um arquivo com dezenas de milhares de linhas.
   */
  async importarLote({ relogioId, empresaId, marcacoes }) {
    if (marcacoes.length === 0) return { total_linhas: 0, inserida: 0, duplicada: 0, pendente: 0 };

    const funcs = await query('SELECT id, cpf, pis FROM funcionarios WHERE empresa_id = ?', [empresaId]);
    const porCpf = new Map();
    const porPis = new Map();
    for (const f of funcs) {
      if (f.cpf) porCpf.set(String(f.cpf).replace(/\D/g, ''), f.id);
      if (f.pis) porPis.set(String(f.pis).replace(/\D/g, ''), f.id);
    }

    const existentes = await query('SELECT nsr FROM relogio_marcacoes_importadas WHERE relogio_id = ?', [relogioId]);
    const nsrConhecidos = new Set(existentes.map((r) => r.nsr));

    const novas = marcacoes.filter((m) => !nsrConhecidos.has(m.nsr));
    const duplicadas = marcacoes.length - novas.length;

    for (const m of novas) {
      let funcionarioId = null;
      if (m.cpf) funcionarioId = porCpf.get(String(m.cpf).replace(/\D/g, '')) ?? null;
      if (!funcionarioId && m.pis) funcionarioId = porPis.get(String(m.pis).replace(/\D/g, '')) ?? null;
      m.funcionarioId = funcionarioId;
    }

    const comFuncionario = novas.filter((m) => m.funcionarioId);
    const semFuncionario = novas.filter((m) => !m.funcionarioId);

    for (const lote of chunk(semFuncionario, LOTE)) {
      const placeholders = lote.map(() => '(?, ?, ?, ?, ?, NULL, \'pendente\')').join(', ');
      const params = lote.flatMap((m) => [relogioId, m.nsr, m.cpf ?? null, m.pis ?? null, m.dataHora]);
      await query(
        `INSERT IGNORE INTO relogio_marcacoes_importadas
           (relogio_id, nsr, cpf, pis, data_hora, funcionario_id, status)
         VALUES ${placeholders}`,
        params,
      );
    }

    for (const lote of chunk(comFuncionario, LOTE)) {
      const placeholders = lote.map(() => '(?, ?, ?, ?, \'rep\', 1)').join(', ');
      const params = lote.flatMap((m) => [m.funcionarioId, relogioId, m.nsr, m.dataHora]);
      await query(
        `INSERT IGNORE INTO marcacoes (funcionario_id, relogio_id, nsr, data_hora, tipo, original)
         VALUES ${placeholders}`,
        params,
      );
    }

    // Recupera o id da marcação por (funcionario_id, data_hora) — a chave de
    // deduplicação real (migration 026), não (relogio_id, nsr): cobre tanto
    // a que acabamos de inserir quanto uma já existente de outra origem
    // (ex.: batida manual ou do app no mesmo minuto).
    const marcacaoIdPorChave = new Map();
    for (const lote of chunk(comFuncionario, LOTE)) {
      const placeholders = lote.map(() => '(?, ?)').join(', ');
      const params = lote.flatMap((m) => [m.funcionarioId, m.dataHora]);
      const rows = await query(
        `SELECT id, funcionario_id, data_hora FROM marcacoes WHERE (funcionario_id, data_hora) IN (${placeholders})`,
        params,
      );
      for (const r of rows) marcacaoIdPorChave.set(chaveMarcacao(r.funcionario_id, r.data_hora), r.id);
    }

    for (const lote of chunk(comFuncionario, LOTE)) {
      const placeholders = lote.map(() => '(?, ?, ?, ?, ?, ?, \'vinculada\', ?, NOW())').join(', ');
      const params = lote.flatMap((m) => {
        const marcacaoId = marcacaoIdPorChave.get(chaveMarcacao(m.funcionarioId, m.dataHora)) ?? null;
        return [relogioId, m.nsr, m.cpf ?? null, m.pis ?? null, m.dataHora, m.funcionarioId, marcacaoId];
      });
      await query(
        `INSERT IGNORE INTO relogio_marcacoes_importadas
           (relogio_id, nsr, cpf, pis, data_hora, funcionario_id, status, marcacao_id, vinculado_em)
         VALUES ${placeholders}`,
        params,
      );
    }

    return {
      total_linhas: marcacoes.length,
      inserida: comFuncionario.length,
      pendente: semFuncionario.length,
      duplicada: duplicadas,
    };
  },


  /**
   * Registra uma marcação vista no relógio — vinculada a um funcionário ou
   * não. É a fonte da verdade de "o que este agente já viu deste relógio":
   * mesmo sem funcionário correspondente ainda, a marcação fica guardada
   * aqui (status 'pendente') em vez de simplesmente descartada. Quando
   * vinculada, também grava uma cópia em `marcacoes` (usada na folha e no
   * espelho de ponto).
   */
  async importar({ relogioId, nsr, cpf, pis, dataHora, funcionarioId }) {
    const status = funcionarioId ? 'vinculada' : 'pendente';

    const result = await query(
      `INSERT IGNORE INTO relogio_marcacoes_importadas
         (relogio_id, nsr, cpf, pis, data_hora, funcionario_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [relogioId, nsr, cpf ?? null, pis ?? null, dataHora, funcionarioId ?? null, status],
    );
    if (result.affectedRows === 0) {
      return 'duplicada';
    }

    if (!funcionarioId) {
      return 'pendente';
    }

    const { marcacaoId } = await MarcacaoRepository.insertFromRelogio({ funcionarioId, relogioId, nsr, dataHora });
    await query(
      'UPDATE relogio_marcacoes_importadas SET marcacao_id = ?, vinculado_em = NOW() WHERE id = ?',
      [marcacaoId, result.insertId],
    );
    return 'inserida';
  },

  /**
   * Maior NSR já visto deste relógio (vinculado ou não) — usado pelo
   * sistema de coleta local para saber a partir de onde pedir marcações
   * ao equipamento, evitando baixar de novo o histórico inteiro a cada
   * ciclo.
   */
  async ultimoNsrPorRelogio(relogioId) {
    const rows = await query(
      'SELECT MAX(nsr) AS ultimo_nsr FROM relogio_marcacoes_importadas WHERE relogio_id = ?',
      [relogioId],
    );
    return rows[0]?.ultimo_nsr ?? 0;
  },

  /**
   * Vincula automaticamente marcações pendentes desta empresa a um
   * funcionário recém-cadastrado, por CPF ou PIS. Chamado ao criar um
   * funcionário — resolve o caso comum sozinho; o que sobrar (CPF
   * digitado diferente no relógio, por exemplo) fica para a tela manual.
   */
  async vincularPendentes(empresaId, funcionarioId, { cpf, pis }) {
    if (!cpf && !pis) return 0;

    const condicoes = [];
    const params = [];
    if (cpf) {
      condicoes.push('rmi.cpf = ?');
      params.push(cpf);
    }
    if (pis) {
      condicoes.push('rmi.pis = ?');
      params.push(pis);
    }

    const pendentes = await query(
      `SELECT rmi.id, rmi.relogio_id, rmi.nsr, rmi.data_hora
       FROM relogio_marcacoes_importadas rmi
       JOIN relogios_ponto r ON r.id = rmi.relogio_id
       WHERE r.empresa_id = ? AND rmi.status = 'pendente' AND (${condicoes.join(' OR ')})`,
      [empresaId, ...params],
    );

    for (const p of pendentes) {
      await this.vincular(p.id, funcionarioId);
    }
    return pendentes.length;
  },

  /**
   * Lista marcações pendentes (sem funcionário vinculado) desta empresa,
   * para a tela de reconciliação manual.
   */
  async listarPendentes(empresaId, { relogioId, search } = {}) {
    const condicoes = ['r.empresa_id = ?', "rmi.status = 'pendente'"];
    const params = [empresaId];
    if (relogioId) {
      condicoes.push('rmi.relogio_id = ?');
      params.push(relogioId);
    }
    if (search) {
      condicoes.push('(rmi.cpf LIKE ? OR rmi.pis LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }

    return query(
      `SELECT rmi.id, rmi.relogio_id, r.descricao AS relogio_descricao, rmi.nsr,
              rmi.cpf, rmi.pis, rmi.data_hora, rmi.criado_em
       FROM relogio_marcacoes_importadas rmi
       JOIN relogios_ponto r ON r.id = rmi.relogio_id
       WHERE ${condicoes.join(' AND ')}
       ORDER BY rmi.data_hora DESC
       LIMIT 500`,
      params,
    );
  },

  /** Vincula manualmente uma marcação pendente a um funcionário. */
  async vincular(id, funcionarioId) {
    const [pendente] = await query(
      `SELECT id, relogio_id, nsr, data_hora FROM relogio_marcacoes_importadas WHERE id = ? AND status = 'pendente'`,
      [id],
    );
    if (!pendente) return false;

    const { marcacaoId } = await MarcacaoRepository.insertFromRelogio({
      funcionarioId,
      relogioId: pendente.relogio_id,
      nsr: pendente.nsr,
      dataHora: pendente.data_hora,
    });

    await query(
      `UPDATE relogio_marcacoes_importadas
       SET funcionario_id = ?, status = 'vinculada', marcacao_id = ?, vinculado_em = NOW()
       WHERE id = ?`,
      [funcionarioId, marcacaoId, id],
    );
    return true;
  },
};
