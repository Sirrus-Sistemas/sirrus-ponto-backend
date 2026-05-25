import { query, transaction } from '../config/database.js';

export const FuncionarioRepository = {
  /**
   * Busca funcionário por email (login).
   */
  async findByEmail(email) {
    const rows = await query(
      `SELECT f.*, d.nome AS departamento_nome, t.nome AS turno_nome
       FROM funcionarios f
       LEFT JOIN departamentos d ON f.departamento_id = d.id
       LEFT JOIN turnos t ON f.turno_id = t.id
       WHERE f.email = ? AND f.ativo = 1
       LIMIT 1`,
      [email]
    );
    return rows[0] || null;
  },

  /**
   * Busca funcionário ativo por email (comparação case-insensitive).
   */
  async findByEmailIgnoreCase(email) {
    const rows = await query(
      `SELECT f.*, d.nome AS departamento_nome, t.nome AS turno_nome
       FROM funcionarios f
       LEFT JOIN departamentos d ON f.departamento_id = d.id
       LEFT JOIN turnos t ON f.turno_id = t.id
       WHERE LOWER(TRIM(f.email)) = LOWER(TRIM(?)) AND f.ativo = 1
       LIMIT 1`,
      [email]
    );
    return rows[0] || null;
  },

  /**
   * Login por CPF (apenas dígitos, 11 posições). Compara CPF normalizado no banco.
   */
  async findByCpfDigits(cpf11) {
    const rows = await query(
      `SELECT f.*, d.nome AS departamento_nome, t.nome AS turno_nome, fi.nome AS filial_nome
       FROM funcionarios f
       LEFT JOIN departamentos d ON f.departamento_id = d.id
       LEFT JOIN turnos t ON f.turno_id = t.id
       LEFT JOIN filiais fi ON f.filial_id = fi.id
       WHERE REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(f.cpf, ''), '.', ''), '-', ''), '/', ''), ' ', '') = ?
         AND f.ativo = 1
       LIMIT 1`,
      [cpf11]
    );
    return rows[0] || null;
  },

  /**
   * Turno + carga horária diária (para espelho / previsto).
   */
  async findTurnoJornada(funcionarioId) {
    const rows = await query(
      `SELECT t.id AS turno_id,
              t.nome AS turno_nome,
              t.carga_horaria_diaria AS carga,
              t.batidas_esperadas_dia AS batidas_esperadas_dia,
              COALESCE(t.tolerancia_atraso_min, 0) AS tolerancia_atraso_min,
              COALESCE(t.tolerancia_extra_min,  0) AS tolerancia_extra_min
         FROM funcionarios f
         LEFT JOIN turnos t ON t.id = f.turno_id
        WHERE f.id = ?
        LIMIT 1`,
      [funcionarioId],
    );
    return rows[0] || null;
  },

  /**
   * Busca funcionário por ID.
   */
  async findById(id) {
    const rows = await query(
      `SELECT f.id, f.empresa_id, f.filial_id, f.departamento_id, f.turno_id, f.lotacao_id, f.gestor_id,
              f.nome, f.cpf, f.email, f.telefone, f.foto_path,
              f.cargo, f.matricula, f.data_admissao, f.data_demissao, f.pis,
              f.cep, f.logradouro, f.numero, f.complemento, f.bairro, f.cidade, f.estado,
              f.municipio_id,
              f.role, f.ativo, f.usa_escala, f.usa_mobile, f.pontomobile_id,
              f.central_ativa, f.permitir_geo, f.permitir_foto, f.permitir_ajuste_ponto,
              f.created_at, f.updated_at,
              fi.nome AS filial_nome,
              d.nome AS departamento_nome,
              t.nome AS turno_nome,
              CASE WHEN t.id IS NULL THEN NULL ELSE COALESCE(t.batidas_esperadas_dia, 8) END AS turno_batidas_esperadas_dia,
              t.entrada AS turno_entrada,
              t.saida AS turno_saida,
              t.saida_intervalo AS turno_saida_intervalo,
              t.retorno_intervalo AS turno_retorno_intervalo,
              l.nome AS lotacao_nome,
              g.nome AS gestor_nome,
              m.fuso_horario
       FROM funcionarios f
       LEFT JOIN filiais fi ON f.filial_id = fi.id
       LEFT JOIN departamentos d ON f.departamento_id = d.id
       LEFT JOIN turnos t ON f.turno_id = t.id
       LEFT JOIN lotacoes l ON f.lotacao_id = l.id
       LEFT JOIN funcionarios g ON f.gestor_id = g.id
       LEFT JOIN municipios m ON f.municipio_id = m.CODMUNICIPIO
       WHERE f.id = ?
       LIMIT 1`,
      [id]
    );
    return rows[0] || null;
  },

  /**
   * Lista funcionários com filtros e paginação.
   */
  async findAll(empresaId, { filialId, departamentoId, lotacaoId, ativo, search, limit, offset }) {
    let sql = `
      SELECT f.id, f.nome, f.email, f.cpf, f.cargo, f.matricula, f.role, f.ativo, f.usa_escala,
             f.filial_id, f.lotacao_id, f.data_admissao, f.foto_path,
             fi.nome AS filial_nome,
             d.nome AS departamento_nome,
             t.nome AS turno_nome,
             l.nome AS lotacao_nome,
             CONCAT(t.entrada, '-', t.saida) AS horario
      FROM funcionarios f
      LEFT JOIN filiais fi ON f.filial_id = fi.id
      LEFT JOIN departamentos d ON f.departamento_id = d.id
      LEFT JOIN turnos t ON f.turno_id = t.id
      LEFT JOIN lotacoes l ON f.lotacao_id = l.id
      WHERE f.empresa_id = ?
    `;
    const params = [empresaId];

    if (filialId) {
      sql += ' AND f.filial_id = ?';
      params.push(filialId);
    }
    if (departamentoId) {
      sql += ' AND f.departamento_id = ?';
      params.push(departamentoId);
    }
    if (lotacaoId) {
      sql += ' AND f.lotacao_id = ?';
      params.push(lotacaoId);
    }
    if (ativo !== undefined) {
      sql += ' AND f.ativo = ?';
      params.push(ativo);
    }
    if (search) {
      const term = `%${search}%`;
      const cpfDigits = search.replace(/\D/g, '');
      const cpfTerm = cpfDigits.length > 0 ? `%${cpfDigits}%` : term;
      sql += ' AND (f.nome LIKE ? OR f.email LIKE ? OR f.matricula LIKE ? OR f.cpf LIKE ?)';
      params.push(term, term, term, cpfTerm);
    }

    // Count total — usa [\s\S]+? para cruzar quebras de linha
    const countSql = sql.replace(/SELECT[\s\S]+?FROM\s/i, 'SELECT COUNT(*) AS total FROM ');
    const [countResult] = await query(countSql, params);
    const total = countResult.total;

    // Resultado paginado (LIMIT/OFFSET interpolados pois mysql2 execute() rejeita inteiros bound)
    const safeLimit = parseInt(limit, 10);
    const safeOffset = parseInt(offset, 10);
    sql += ` ORDER BY f.nome ASC LIMIT ${safeLimit} OFFSET ${safeOffset}`;

    const rows = await query(sql, params);

    return { rows, total };
  },

  /**
   * Cria um novo funcionário.
   */
  async create(data) {
    const result = await query(
      `INSERT INTO funcionarios
       (empresa_id, filial_id, departamento_id, turno_id, lotacao_id, gestor_id,
        nome, cpf, email, telefone, cargo, matricula,
        data_admissao, pis, senha_hash, role,
        cep, logradouro, numero, complemento, bairro, cidade, estado, municipio_id,
        usa_mobile)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.empresa_id, data.filial_id || null, data.departamento_id || null,
        data.turno_id || null, data.lotacao_id || null, data.gestor_id || null,
        data.nome, data.cpf || null, data.email, data.telefone || null,
        data.cargo || null, data.matricula || null,
        data.data_admissao, data.pis || null, data.senha_hash, data.role || 'funcionario',
        data.cep || null, data.logradouro || null, data.numero || null,
        data.complemento || null, data.bairro || null, data.cidade || null, data.estado || null,
        data.municipio_id || null,
        data.usa_mobile ?? 0,
      ]
    );
    return result.insertId;
  },

  /**
   * Atualiza dados de um funcionário.
   */
  async update(id, data) {
    const fields = [];
    const values = [];

    const allowed = [
      'filial_id', 'departamento_id', 'turno_id', 'lotacao_id', 'gestor_id', 'nome', 'cpf',
      'email', 'telefone', 'foto_path', 'cargo', 'matricula',
      'data_admissao', 'data_demissao', 'pis', 'role', 'ativo', 'usa_escala',
      'central_ativa', 'permitir_geo', 'permitir_foto', 'permitir_ajuste_ponto',
      'cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'estado', 'municipio_id',
      'usa_mobile',
    ];

    for (const key of allowed) {
      if (data[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(data[key]);
      }
    }

    if (fields.length === 0) return false;

    values.push(id);
    await query(`UPDATE funcionarios SET ${fields.join(', ')} WHERE id = ?`, values);
    return true;
  },

  /**
   * Lista funcionários subordinados a um gestor.
   */
  async findByGestor(gestorId, empresaId) {
    return query(
      `SELECT f.id, f.nome, f.email, f.cargo, d.nome AS departamento_nome
       FROM funcionarios f
       LEFT JOIN departamentos d ON f.departamento_id = d.id
       WHERE f.gestor_id = ? AND f.empresa_id = ? AND f.ativo = 1
       ORDER BY f.nome`,
      [gestorId, empresaId]
    );
  },
};
