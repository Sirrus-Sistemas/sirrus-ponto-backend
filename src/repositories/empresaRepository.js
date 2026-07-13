import { query } from '../config/database.js';

export const EmpresaRepository = {
  async findById(id) {
    const rows = await query(
      `SELECT e.id, e.razao_social, e.nome_fantasia, e.cnpj, e.endereco, e.cidade, e.uf,
              e.municipio_id, e.max_filiais, e.max_funcionarios,
              m.NOMEMUNICIPIO AS municipio_nome,
              m.ESTADO        AS municipio_estado,
              m.fuso_horario  AS municipio_fuso_horario
         FROM empresas e
         LEFT JOIN municipios m ON e.municipio_id = m.CODMUNICIPIO
        WHERE e.id = ?
        LIMIT 1`,
      [id],
    );
    return rows[0] || null;
  },

  async updateMunicipio(empresaId, municipioId) {
    await query(
      'UPDATE empresas SET municipio_id = ? WHERE id = ?',
      [municipioId ?? null, empresaId],
    );
  },

  async findFilialById(id) {
    const rows = await query(
      `SELECT fi.id, fi.empresa_id, fi.nome, fi.cnpj, fi.pontomobile_id,
              e.razao_social AS empresa_razao_social
         FROM filiais fi
         JOIN empresas e ON fi.empresa_id = e.id
        WHERE fi.id = ?
        LIMIT 1`,
      [id],
    );
    return rows[0] || null;
  },

  async findFiliaisByEmpresa(empresaId) {
    return query(
      `SELECT id, nome, cnpj, pontomobile_id, ativa
         FROM filiais
        WHERE empresa_id = ?
        ORDER BY nome ASC`,
      [empresaId],
    );
  },
};
