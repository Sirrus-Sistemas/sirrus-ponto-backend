import { query } from '../config/database.js';

/**
 * Credenciais de acesso: CPF + senha (vinculado ao funcionário).
 */
export const UsuarioRepository = {
  /**
   * Busca login por CPF (11 dígitos), com dados do funcionário para o JWT.
   */
  async findAuthByCpfDigits(cpf11) {
    const rows = await query(
      `SELECT f.id, f.empresa_id, f.filial_id, f.nome, f.email, f.role, f.ativo,
              d.nome AS departamento_nome, t.nome AS turno_nome,
              fi.nome AS filial_nome,
              u.senha_hash AS usuario_senha_hash
       FROM usuarios u
       INNER JOIN funcionarios f ON u.funcionario_id = f.id
       LEFT JOIN departamentos d ON f.departamento_id = d.id
       LEFT JOIN turnos t ON f.turno_id = t.id
       LEFT JOIN filiais fi ON f.filial_id = fi.id
       WHERE u.cpf = ? AND u.ativo = 1 AND f.ativo = 1
       LIMIT 1`,
      [cpf11]
    );
    return rows[0] || null;
  },

  /**
   * ID do funcionário a partir do CPF (recuperação de senha, etc.).
   */
  async findFuncionarioIdByCpfDigits(cpf11) {
    const rows = await query(
      `SELECT f.id AS funcionario_id
       FROM usuarios u
       INNER JOIN funcionarios f ON u.funcionario_id = f.id
       WHERE u.cpf = ? AND u.ativo = 1 AND f.ativo = 1
       LIMIT 1`,
      [cpf11]
    );
    return rows[0]?.funcionario_id ?? null;
  },

  async updateSenhaHash(funcionarioId, senhaHash) {
    await query('UPDATE usuarios SET senha_hash = ? WHERE funcionario_id = ?', [
      senhaHash,
      funcionarioId,
    ]);
  },

  async updateCpf(funcionarioId, cpf11) {
    await query('UPDATE usuarios SET cpf = ? WHERE funcionario_id = ?', [cpf11, funcionarioId]);
  },

  async insertForFuncionario(funcionarioId, cpf11, senhaHash) {
    await query(
      `INSERT INTO usuarios (funcionario_id, cpf, senha_hash)
       VALUES (?, ?, ?)`,
      [funcionarioId, cpf11, senhaHash]
    );
  },
};
