import { query } from '../config/database.js';
import { MarcacaoRepository } from './marcacaoRepository.js';

export const RelogioMarcacaoRepository = {
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
