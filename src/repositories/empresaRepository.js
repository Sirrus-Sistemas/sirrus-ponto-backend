import { query } from '../config/database.js';

export const EmpresaRepository = {
  async findById(id) {
    const rows = await query(
      `SELECT id, razao_social, nome_fantasia, cnpj, endereco, cidade, uf
         FROM empresas
        WHERE id = ?
        LIMIT 1`,
      [id],
    );
    return rows[0] || null;
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
