import { authenticate, authorize, empresaScope } from '../middlewares/auth.js';
import { query, transaction } from '../config/database.js';
import { successResponse } from '../utils/helpers.js';
import { EmpresaRepository } from '../repositories/empresaRepository.js';

function calcCargaMinutos(entrada, saida_intervalo, retorno_intervalo, saida) {
  if (!entrada || !saida) return 0;
  const toMin = (t) => {
    const p = String(t).split(':');
    return parseInt(p[0], 10) * 60 + parseInt(p[1], 10);
  };
  if (saida_intervalo && retorno_intervalo) {
    return Math.max(0, (toMin(saida_intervalo) - toMin(entrada)) + (toMin(saida) - toMin(retorno_intervalo)));
  }
  return Math.max(0, toMin(saida) - toMin(entrada));
}

function normalizarBatidasEsperadas(val) {
  const n = parseInt(val, 10);
  if (!Number.isFinite(n) || n < 2 || n > 24 || n % 2 !== 0) return 8;
  return n;
}

export default async function cadastrosRoutes(fastify) {
  fastify.addHook('preHandler', authenticate);
  fastify.addHook('preHandler', empresaScope);

  // ═══════════════════════════════════════════════════════════════════
  // EMPRESA
  // ═══════════════════════════════════════════════════════════════════

  fastify.get('/empresa', {
    preHandler: [authorize('admin')],
  }, async (request) => {
    const empresa = await EmpresaRepository.findById(request.empresaId);
    return successResponse(empresa);
  });

  fastify.put('/empresa/municipio', {
    preHandler: [authorize('admin')],
    schema: {
      body: {
        type: 'object',
        properties: {
          municipio_id: { type: ['integer', 'null'] },
        },
      },
    },
  }, async (request) => {
    await EmpresaRepository.updateMunicipio(request.empresaId, request.body.municipio_id ?? null);
    return successResponse({}, 'Município da empresa atualizado');
  });

  fastify.put('/empresa/aprovacao-mobile', {
    preHandler: [authorize('admin')],
    schema: {
      body: {
        type: 'object',
        required: ['ativo'],
        properties: {
          ativo: { type: 'boolean' },
        },
      },
    },
  }, async (request) => {
    await EmpresaRepository.updateAprovacaoMobile(request.empresaId, request.body.ativo);
    return successResponse({}, 'Parâmetro de aprovação de batidas mobile atualizado');
  });

  // ═══════════════════════════════════════════════════════════════════
  // FILIAIS
  // ═══════════════════════════════════════════════════════════════════

  fastify.get('/filiais', async (request) => {
    const rows = await query(
      `SELECT fi.*, COUNT(f.id) AS total_funcionarios
       FROM filiais fi
       LEFT JOIN funcionarios f ON f.filial_id = fi.id AND f.ativo = 1
       WHERE fi.empresa_id = ?
       GROUP BY fi.id
       ORDER BY fi.nome`,
      [request.empresaId]
    );
    return successResponse(rows);
  });

  fastify.post('/filiais', {
    preHandler: [authorize('admin')],
    schema: {
      body: {
        type: 'object',
        required: ['nome'],
        properties: {
          nome:             { type: 'string', minLength: 2 },
          tipo_documento:   { type: 'string', enum: ['cnpj', 'cpf'] },
          cnpj:             { type: 'string' },
          endereco:         { type: 'string' },
          bairro:           { type: 'string' },
          cidade:           { type: 'string' },
          uf:               { type: 'string', maxLength: 2 },
          cep:              { type: 'string' },
          telefone:         { type: 'string' },
          email:            { type: 'string', format: 'email' },
          num_registradora: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { nome, tipo_documento, cnpj, endereco, bairro, cidade, uf, cep, telefone, email, num_registradora } = request.body;

    const [limiteRow] = await query(
      `SELECT e.max_filiais, COUNT(f.id) AS total_ativas
       FROM empresas e
       LEFT JOIN filiais f ON f.empresa_id = e.id AND f.ativa = 1
       WHERE e.id = ?
       GROUP BY e.id`,
      [request.empresaId],
    );
    if (limiteRow && limiteRow.total_ativas >= limiteRow.max_filiais) {
      return reply.code(422).send({
        message: `Limite de ${limiteRow.max_filiais} filial(is) atingido. Entre em contato com o suporte Sirrus para ampliar seu plano.`,
        code: 'LIMITE_FILIAIS',
      });
    }

    const result = await query(
      `INSERT INTO filiais (empresa_id, nome, tipo_documento, cnpj, endereco, bairro, cidade, uf, cep, telefone, email, num_registradora)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [request.empresaId, nome, tipo_documento || 'cnpj', cnpj || null, endereco || null,
       bairro || null, cidade || null, uf || null, cep || null, telefone || null, email || null, num_registradora || null]
    );
    return reply.code(201).send(successResponse({ id: result.insertId, nome }, 'Filial criada'));
  });

  fastify.put('/filiais/:id', {
    preHandler: [authorize('admin')],
  }, async (request, reply) => {
    const d = request.body;
    const allowed = ['nome', 'tipo_documento', 'cnpj', 'endereco', 'bairro', 'cidade', 'uf', 'cep', 'telefone', 'email', 'num_registradora', 'ativa'];
    const fields = [];
    const values = [];
    for (const key of allowed) {
      if (d[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(d[key]);
      }
    }
    if (fields.length === 0) {
      return reply.code(400).send({ error: 'Nenhum campo para atualizar' });
    }
    values.push(request.params.id, request.empresaId);
    await query(`UPDATE filiais SET ${fields.join(', ')} WHERE id = ? AND empresa_id = ?`, values);
    return successResponse(null, 'Filial atualizada');
  });

  // ═══════════════════════════════════════════════════════════════════
  // DEPARTAMENTOS
  // ═══════════════════════════════════════════════════════════════════

  fastify.get('/departamentos', async (request) => {
    const rows = await query(
      `SELECT d.*, COUNT(f.id) AS total_funcionarios
       FROM departamentos d
       LEFT JOIN funcionarios f ON f.departamento_id = d.id AND f.ativo = 1
       WHERE d.empresa_id = ? AND d.ativo = 1
       GROUP BY d.id
       ORDER BY d.nome`,
      [request.empresaId]
    );
    return successResponse(rows);
  });

  fastify.post('/departamentos', {
    preHandler: [authorize('admin')],
    schema: {
      body: {
        type: 'object',
        required: ['nome'],
        properties: {
          nome: { type: 'string', minLength: 2 },
          descricao: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { nome, descricao } = request.body;
    const result = await query(
      'INSERT INTO departamentos (empresa_id, nome, descricao) VALUES (?, ?, ?)',
      [request.empresaId, nome, descricao || null]
    );
    return reply.code(201).send(successResponse({ id: result.insertId, nome, descricao }, 'Departamento criado'));
  });

  fastify.put('/departamentos/:id', {
    preHandler: [authorize('admin')],
  }, async (request, reply) => {
    const { nome, descricao, ativo } = request.body;
    await query(
      'UPDATE departamentos SET nome = COALESCE(?, nome), descricao = COALESCE(?, descricao), ativo = COALESCE(?, ativo) WHERE id = ? AND empresa_id = ?',
      [nome, descricao, ativo, request.params.id, request.empresaId]
    );
    return successResponse(null, 'Departamento atualizado');
  });

  // ═══════════════════════════════════════════════════════════════════
  // TURNOS
  // ═══════════════════════════════════════════════════════════════════

  fastify.get('/turnos', async (request) => {
    const rows = await query(
      `SELECT t.*, COUNT(f.id) AS total_funcionarios
       FROM turnos t
       LEFT JOIN funcionarios f ON f.turno_id = t.id AND f.ativo = 1
       WHERE t.empresa_id = ? AND t.ativo = 1
       GROUP BY t.id
       ORDER BY t.entrada`,
      [request.empresaId]
    );
    return successResponse(rows);
  });

  fastify.post('/turnos', {
    preHandler: [authorize('admin')],
    schema: {
      body: {
        type: 'object',
        required: ['nome', 'entrada', 'saida_intervalo', 'retorno_intervalo', 'saida'],
        properties: {
          nome: { type: 'string', minLength: 2 },
          entrada: { type: 'string', pattern: '^\\d{2}:\\d{2}$' },
          saida_intervalo: { type: 'string', pattern: '^\\d{2}:\\d{2}$' },
          retorno_intervalo: { type: 'string', pattern: '^\\d{2}:\\d{2}$' },
          saida: { type: 'string', pattern: '^\\d{2}:\\d{2}$' },
          tolerancia_atraso_min: { type: 'integer', minimum: 0 },
          tolerancia_extra_min: { type: 'integer', minimum: 0 },
          intervalo_minimo_min: { type: 'integer', minimum: 0 },
          tipo: { type: 'string', enum: ['fixo', 'flexivel', 'escala'] },
          batidas_esperadas_dia: { type: 'integer', minimum: 2, maximum: 24 },
          batida_times_json: { type: ['string', 'null'] },
        },
      },
    },
  }, async (request, reply) => {
    const d = request.body;
    const batidas = normalizarBatidasEsperadas(d.batidas_esperadas_dia);
    const result = await query(
      `INSERT INTO turnos
       (empresa_id, nome, entrada, saida_intervalo, retorno_intervalo, saida,
        tolerancia_atraso_min, tolerancia_extra_min, intervalo_minimo_min, tipo, batidas_esperadas_dia,
        batida_times_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        request.empresaId, d.nome, d.entrada, d.saida_intervalo,
        d.retorno_intervalo, d.saida,
        d.tolerancia_atraso_min || 10, d.tolerancia_extra_min || 10,
        d.intervalo_minimo_min || 60, d.tipo || 'fixo', batidas,
        d.batida_times_json || null,
      ]
    );
    return reply.code(201).send(successResponse({ id: result.insertId, ...d }, 'Turno criado'));
  });

  fastify.put('/turnos/:id', {
    preHandler: [authorize('admin')],
  }, async (request, reply) => {
    const d = request.body;
    const fields = [];
    const values = [];

    const allowed = [
      'nome', 'entrada', 'saida_intervalo', 'retorno_intervalo', 'saida',
      'tolerancia_atraso_min', 'tolerancia_extra_min', 'intervalo_minimo_min',
      'tipo', 'ativo', 'batidas_esperadas_dia', 'batida_times_json',
    ];

    for (const key of allowed) {
      if (d[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(key === 'batidas_esperadas_dia' ? normalizarBatidasEsperadas(d[key]) : d[key]);
      }
    }

    if (fields.length === 0) {
      return reply.code(400).send({ error: 'Nenhum campo para atualizar' });
    }

    values.push(request.params.id, request.empresaId);
    await query(`UPDATE turnos SET ${fields.join(', ')} WHERE id = ? AND empresa_id = ?`, values);

    return successResponse(null, 'Turno atualizado');
  });

  // ── Horários por dia da semana ──────────────────────────────────────

  fastify.get('/turnos/:id/horarios', {
    preHandler: [authorize('admin')],
  }, async (request, reply) => {
    const turnoId = parseInt(request.params.id, 10);
    const [turno] = await query('SELECT id FROM turnos WHERE id = ? AND empresa_id = ?', [turnoId, request.empresaId]);
    if (!turno) return reply.code(404).send({ error: 'Turno não encontrado' });

    const rows = await query(
      `SELECT dia_semana, trabalha, entrada, saida_intervalo, retorno_intervalo, saida, carga_minutos
         FROM turno_horarios WHERE turno_id = ? ORDER BY dia_semana`,
      [turnoId],
    );
    return successResponse(rows);
  });

  fastify.put('/turnos/:id/horarios', {
    preHandler: [authorize('admin')],
    schema: {
      body: {
        type: 'array',
        items: {
          type: 'object',
          required: ['dia_semana', 'trabalha'],
          properties: {
            dia_semana:        { type: 'integer', minimum: 0, maximum: 6 },
            trabalha:          { type: 'integer', minimum: 0, maximum: 1 },
            entrada:           { type: ['string', 'null'] },
            saida_intervalo:   { type: ['string', 'null'] },
            retorno_intervalo: { type: ['string', 'null'] },
            saida:             { type: ['string', 'null'] },
            carga_minutos:     { type: 'integer', minimum: 0 },
          },
        },
      },
    },
  }, async (request, reply) => {
    const turnoId = parseInt(request.params.id, 10);
    const [turno] = await query('SELECT id FROM turnos WHERE id = ? AND empresa_id = ?', [turnoId, request.empresaId]);
    if (!turno) return reply.code(404).send({ error: 'Turno não encontrado' });

    const dias = request.body;

    await transaction(async (conn) => {
      await conn.execute('DELETE FROM turno_horarios WHERE turno_id = ?', [turnoId]);
      for (const d of dias) {
        const carga = d.trabalha ? calcCargaMinutos(d.entrada, d.saida_intervalo, d.retorno_intervalo, d.saida) : 0;
        await conn.execute(
          `INSERT INTO turno_horarios (turno_id, dia_semana, trabalha, entrada, saida_intervalo, retorno_intervalo, saida, carga_minutos)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            turnoId, d.dia_semana, d.trabalha ? 1 : 0,
            d.trabalha ? (d.entrada || null) : null,
            d.trabalha ? (d.saida_intervalo || null) : null,
            d.trabalha ? (d.retorno_intervalo || null) : null,
            d.trabalha ? (d.saida || null) : null,
            carga,
          ],
        );
      }
    });

    return successResponse(null, 'Horários por dia salvos');
  });

  // ═══════════════════════════════════════════════════════════════════
  // LOTAÇÕES
  // ═══════════════════════════════════════════════════════════════════

  fastify.get('/lotacoes', async (request) => {
    const rows = await query(
      `SELECT l.*, COUNT(f.id) AS total_funcionarios
       FROM lotacoes l
       LEFT JOIN funcionarios f ON f.lotacao_id = l.id AND f.ativo = 1
       WHERE l.empresa_id = ? AND l.ativo = 1
       GROUP BY l.id
       ORDER BY l.nome`,
      [request.empresaId]
    );
    return successResponse(rows);
  });

  fastify.post('/lotacoes', {
    preHandler: [authorize('admin')],
    schema: {
      body: {
        type: 'object',
        required: ['nome'],
        properties: {
          nome: { type: 'string', minLength: 2 },
          tipo_extra: { type: 'string', enum: ['50_clt', '60', '80', '100'] },
          calcular_extras_escalonado: { type: 'integer', minimum: 0, maximum: 1 },
          domingo_tipo: { type: 'string', enum: ['nao_calcular', '50pct', '100pct_extra', '100pct_total'] },
          feriado_tipo: { type: 'string', enum: ['nao_calcular', '50pct', '100pct_extra', '100pct_total'] },
          somar_esq_horas_trabalhadas: { type: 'integer', minimum: 0, maximum: 1 },
          converter_falta_banco_horas: { type: 'integer', minimum: 0, maximum: 1 },
          lancar_100pct_banco_horas: { type: 'integer', minimum: 0, maximum: 1 },
          converter_falta_folha_ponto: { type: 'integer', minimum: 0, maximum: 1 },
          nao_gerar_debitos_meia_falta: { type: 'integer', minimum: 0, maximum: 1 },
          banco_horas_somente_dom_feriado: { type: 'integer', minimum: 0, maximum: 1 },
          dividir_extras_50_100: { type: 'integer', minimum: 0, maximum: 1 },
          calcular_60pct_sabados: { type: 'integer', minimum: 0, maximum: 1 },
          sabado_somente_extras: { type: 'integer', minimum: 0, maximum: 1 },
          juntar_100pct_sabado_normal: { type: 'integer', minimum: 0, maximum: 1 },
          atribuir_100pct_terceiro_domingo: { type: 'integer', minimum: 0, maximum: 1 },
          lancar_debitos_domingo_50pct: { type: 'integer', minimum: 0, maximum: 1 },
          tabela_zerada_e_folga: { type: 'integer', minimum: 0, maximum: 1 },
          calcula_pares_sequenciais_noturno: { type: 'integer', minimum: 0, maximum: 1 },
          hora_inicio_100pct:           { anyOf: [{ type: 'null' }, { type: 'string', pattern: '^\\d{2}:\\d{2}$' }] },
          hora_inicio_adicional_noturno: { anyOf: [{ type: 'null' }, { type: 'string', pattern: '^\\d{2}:\\d{2}$' }] },
        },
      },
    },
  }, async (request, reply) => {
    const d = request.body;
    const result = await query(
      `INSERT INTO lotacoes
       (empresa_id, nome, tipo_extra, calcular_extras_escalonado,
        domingo_tipo, feriado_tipo,
        somar_esq_horas_trabalhadas, converter_falta_banco_horas, lancar_100pct_banco_horas,
        converter_falta_folha_ponto, nao_gerar_debitos_meia_falta, banco_horas_somente_dom_feriado,
        dividir_extras_50_100, calcular_60pct_sabados, sabado_somente_extras,
        juntar_100pct_sabado_normal, atribuir_100pct_terceiro_domingo,
        lancar_debitos_domingo_50pct, tabela_zerada_e_folga,
        calcula_pares_sequenciais_noturno,
        hora_inicio_100pct, hora_inicio_adicional_noturno)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        request.empresaId,
        d.nome,
        d.tipo_extra ?? '50_clt',
        d.calcular_extras_escalonado ?? 0,
        d.domingo_tipo ?? '100pct_extra',
        d.feriado_tipo ?? '100pct_total',
        d.somar_esq_horas_trabalhadas ?? 0,
        d.converter_falta_banco_horas ?? 0,
        d.lancar_100pct_banco_horas ?? 0,
        d.converter_falta_folha_ponto ?? 0,
        d.nao_gerar_debitos_meia_falta ?? 0,
        d.banco_horas_somente_dom_feriado ?? 0,
        d.dividir_extras_50_100 ?? 0,
        d.calcular_60pct_sabados ?? 0,
        d.sabado_somente_extras ?? 0,
        d.juntar_100pct_sabado_normal ?? 0,
        d.atribuir_100pct_terceiro_domingo ?? 0,
        d.lancar_debitos_domingo_50pct ?? 0,
        d.tabela_zerada_e_folga ?? 0,
        d.calcula_pares_sequenciais_noturno ?? 0,
        d.hora_inicio_100pct ?? null,
        d.hora_inicio_adicional_noturno ?? '22:00',
      ]
    );
    return reply.code(201).send(successResponse({ id: result.insertId, ...d }, 'Lotação criada'));
  });

  fastify.put('/lotacoes/:id', {
    preHandler: [authorize('admin')],
  }, async (request, reply) => {
    const d = request.body;
    const allowed = [
      'nome', 'tipo_extra', 'calcular_extras_escalonado',
      'domingo_tipo', 'feriado_tipo',
      'somar_esq_horas_trabalhadas', 'converter_falta_banco_horas', 'lancar_100pct_banco_horas',
      'converter_falta_folha_ponto', 'nao_gerar_debitos_meia_falta', 'banco_horas_somente_dom_feriado',
      'dividir_extras_50_100', 'calcular_60pct_sabados', 'sabado_somente_extras',
      'juntar_100pct_sabado_normal', 'atribuir_100pct_terceiro_domingo',
      'lancar_debitos_domingo_50pct', 'tabela_zerada_e_folga',
      'calcula_pares_sequenciais_noturno',
      'hora_inicio_100pct', 'hora_inicio_adicional_noturno', 'ativo',
    ];
    const fields = [];
    const values = [];
    for (const key of allowed) {
      if (d[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(d[key]);
      }
    }
    if (fields.length === 0) {
      return reply.code(400).send({ error: 'Nenhum campo para atualizar' });
    }
    values.push(request.params.id, request.empresaId);
    await query(`UPDATE lotacoes SET ${fields.join(', ')} WHERE id = ? AND empresa_id = ?`, values);
    return successResponse(null, 'Lotação atualizada');
  });

  // ═══════════════════════════════════════════════════════════════════
  // FERIADOS
  // ═══════════════════════════════════════════════════════════════════

  fastify.get('/feriados', async (request) => {
    const { ano, search, tipo, page, limit } = request.query;
    const year = ano || new Date().getFullYear();
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    let sql = `
      SELECT f.id, f.empresa_id,
             IF(f.recorrente = 1, DATE_FORMAT(f.data, '%m-%d'), DATE_FORMAT(f.data, '%Y-%m-%d')) AS data,
             f.descricao AS nome, f.tipo, f.uf, f.municipio_ibge,
             m.NOMEMUNICIPIO AS municipio_nome,
             f.recorrente, f.created_at
        FROM feriados f
        LEFT JOIN municipios m ON m.CODMUNICIPIO = f.municipio_ibge
       WHERE f.empresa_id = ?`;
    const params = [request.empresaId];

    if (year) { sql += ' AND (recorrente = 1 OR YEAR(data) = ?)'; params.push(year); }
    if (search) { sql += ' AND descricao LIKE ?'; params.push(`%${search}%`); }
    if (tipo) { sql += ' AND tipo = ?'; params.push(tipo); }

    const countSql = sql.replace(/SELECT[\s\S]+?FROM\s/i, 'SELECT COUNT(*) AS total FROM ');
    const [countRow] = await query(countSql, params);

    sql += ` ORDER BY data LIMIT ${limitNum} OFFSET ${offset}`;
    const rows = await query(sql, params);
    return successResponse({ rows, total: countRow.total });
  });

  fastify.get('/feriados/:id', {
    preHandler: [authorize('admin')],
  }, async (request, reply) => {
    const [row] = await query(
      `SELECT id, IF(recorrente = 1, DATE_FORMAT(data, '%m-%d'), DATE_FORMAT(data, '%Y-%m-%d')) AS data,
              descricao AS nome, tipo, uf, municipio_ibge, recorrente
         FROM feriados WHERE id = ? AND empresa_id = ?`,
      [request.params.id, request.empresaId]
    );
    if (!row) return reply.code(404).send({ error: 'Feriado não encontrado' });
    return successResponse(row);
  });

  fastify.post('/feriados', {
    preHandler: [authorize('admin')],
    schema: {
      body: {
        type: 'object',
        required: ['nome', 'data'],
        properties: {
          nome:       { type: 'string', minLength: 2, maxLength: 150 },
          data:       { type: 'string' },
          tipo:       { type: 'string', enum: ['nacional', 'estadual', 'municipal', 'empresa'] },
          recorrente: { type: ['boolean', 'integer'] },
          uf:         { type: ['string', 'null'], maxLength: 2 },
          municipio_ibge: { type: ['string', 'null'], maxLength: 7 },
          observacao: { type: ['string', 'null'] },
        },
      },
    },
  }, async (request, reply) => {
    const { nome, data, tipo, recorrente, uf, municipio_ibge } = request.body;
    const isRecorrente = recorrente ? 1 : 0;
    // Se recorrente, data vem como MM-DD; armazena com ano-base 2000
    const dataDb = isRecorrente && /^\d{2}-\d{2}$/.test(data) ? `2000-${data}` : data;
    const result = await query(
      'INSERT INTO feriados (empresa_id, data, descricao, tipo, recorrente, uf, municipio_ibge) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [request.empresaId, dataDb, nome.trim(), tipo || 'empresa', isRecorrente, uf || null, municipio_ibge || null]
    );
    return reply.code(201).send(successResponse({ id: result.insertId }, 'Feriado criado'));
  });

  fastify.put('/feriados/:id', {
    preHandler: [authorize('admin')],
  }, async (request, reply) => {
    const [existing] = await query(
      'SELECT id FROM feriados WHERE id = ? AND empresa_id = ?',
      [request.params.id, request.empresaId]
    );
    if (!existing) return reply.code(404).send({ error: 'Feriado não encontrado' });

    const { nome, data, tipo, recorrente, uf, municipio_ibge } = request.body ?? {};
    const fields = [];
    const values = [];
    const isRecorrente = recorrente !== undefined ? (recorrente ? 1 : 0) : undefined;
    if (nome !== undefined)          { fields.push('descricao = ?');     values.push(nome.trim()); }
    if (data !== undefined) {
      const dataDb = isRecorrente && /^\d{2}-\d{2}$/.test(data) ? `2000-${data}` : data;
      fields.push('data = ?'); values.push(dataDb);
    }
    if (tipo !== undefined)          { fields.push('tipo = ?');          values.push(tipo); }
    if (isRecorrente !== undefined)  { fields.push('recorrente = ?');    values.push(isRecorrente); }
    if (uf !== undefined)            { fields.push('uf = ?');            values.push(uf || null); }
    if (municipio_ibge !== undefined){ fields.push('municipio_ibge = ?'); values.push(municipio_ibge || null); }

    if (fields.length === 0) return reply.code(400).send({ error: 'Nenhum campo para atualizar' });
    values.push(request.params.id);
    await query(`UPDATE feriados SET ${fields.join(', ')} WHERE id = ?`, values);
    return successResponse(null, 'Feriado atualizado');
  });

  fastify.delete('/feriados/:id', {
    preHandler: [authorize('admin')],
  }, async (request, reply) => {
    const [existing] = await query(
      'SELECT id FROM feriados WHERE id = ? AND empresa_id = ?',
      [request.params.id, request.empresaId]
    );
    if (!existing) return reply.code(404).send({ error: 'Feriado não encontrado' });
    await query('DELETE FROM feriados WHERE id = ?', [request.params.id]);
    return successResponse(null, 'Feriado excluído');
  });
}
