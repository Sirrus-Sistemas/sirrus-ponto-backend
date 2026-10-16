import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { query } from '../config/database.js';
import { UsuarioRepository } from '../repositories/usuarioRepository.js';
import { onlyCpfDigits } from '../utils/cpf.js';

/**
 * Senha que é o CPF ou um pedaço dele (ex.: os 6 primeiros dígitos, padrão do
 * import da planilha) — quem sabe o CPF entra na conta.
 */
export function senhaDerivadaDoCpf(senha, cpf) {
  const cpfDigits = onlyCpfDigits(cpf);
  const s = String(senha ?? '');
  if (cpfDigits.length !== 11 || !/^[\d.\-\s]+$/.test(s)) return false;
  const senhaDigits = s.replace(/\D/g, '');
  return senhaDigits.length >= 4 && cpfDigits.includes(senhaDigits);
}

const SENHAS_COMUNS = new Set([
  'senha', 'senha1', 'senha12', 'senha123', 'senha1234', 'password', 'qwerty', 'qwerty123',
  'abc123', 'abc1234', 'mudar123', 'mudar@123', 'admin', 'admin123', 'sirrus', 'sirrus123',
]);

/**
 * Senha que qualquer um adivinha: derivada do CPF, um caractere repetido
 * (111111), sequência (123456, 654321, abcdef) ou da lista das mais comuns.
 * Retorna o motivo (para mostrar ao usuário) ou null se a senha serve.
 */
export function motivoSenhaFraca(senha, cpf) {
  const s = String(senha ?? '');
  if (s.length < 6) return 'A senha deve ter pelo menos 6 caracteres.';
  if (senhaDerivadaDoCpf(s, cpf)) return 'A senha não pode ser o CPF nem parte dele.';
  const lower = s.toLowerCase();
  if (/^(.)\1+$/.test(lower)) return 'A senha não pode ser um mesmo caractere repetido.';
  const codes = [...lower].map((ch) => ch.charCodeAt(0));
  const passo = codes[1] - codes[0];
  if (Math.abs(passo) === 1 && codes.every((c, i) => i === 0 || c - codes[i - 1] === passo)) {
    return 'A senha não pode ser uma sequência (ex.: 123456, abcdef).';
  }
  if (SENHAS_COMUNS.has(lower)) return 'Essa senha é muito comum. Escolha outra.';
  return null;
}

export const AuthService = {
  /**
   * Autentica somente por CPF (11 dígitos) e senha, via tabela `usuarios`.
   */
  async login(cpf, password) {
    const digits = onlyCpfDigits(cpf);
    if (digits.length !== 11) {
      const err = new Error('CPF inválido');
      err.statusCode = 400;
      throw err;
    }

    const row = await UsuarioRepository.findAuthByCpfDigits(digits);
    if (!row) {
      throw Object.assign(new Error('CPF ou senha inválidos'), { statusCode: 401 });
    }

    const senhaCorreta = await bcrypt.compare(password, row.usuario_senha_hash);
    if (!senhaCorreta) {
      throw Object.assign(new Error('CPF ou senha inválidos'), { statusCode: 401 });
    }

    delete row.usuario_senha_hash;

    // Troca obrigatória só para senhas NOVAS definidas por outra pessoa
    // (cadastro, import, redefinição pelo admin — ver trocar_senha). Contas
    // que já existiam não são marcadas aqui no login, mesmo com a senha
    // padrão do CPF: forçar a troca para todo mundo de uma vez geraria uma
    // onda de chamados no suporte.
    const trocarSenha = Boolean(row.trocar_senha);

    return {
      id: row.id,
      empresa_id: row.empresa_id,
      filial_id: row.filial_id ?? null,
      nome: row.nome,
      email: row.email,
      role: row.role,
      departamento_nome: row.departamento_nome,
      turno_nome: row.turno_nome,
      filial_nome: row.filial_nome ?? null,
      trocar_senha: trocarSenha,
    };
  },

  /**
   * Salva um refresh token no banco.
   */
  async saveRefreshToken(funcionarioId, token, { deviceInfo, ipAddress, expiresAt }) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    await query(
      `INSERT INTO refresh_tokens (funcionario_id, token_hash, device_info, ip_address, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
      [funcionarioId, tokenHash, deviceInfo || null, ipAddress || null, expiresAt]
    );
  },

  /**
   * Valida e consome um refresh token.
   */
  async verifyRefreshToken(token) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const rows = await query(
      `SELECT rt.*, f.email, f.role, f.empresa_id, f.filial_id, f.nome, f.ativo,
              u.ativo AS usuario_ativo, u.trocar_senha
       FROM refresh_tokens rt
       JOIN funcionarios f ON rt.funcionario_id = f.id
       JOIN usuarios u ON u.funcionario_id = f.id
       WHERE rt.token_hash = ? AND rt.revoked = 0 AND rt.expires_at > NOW()
       LIMIT 1`,
      [tokenHash]
    );

    if (rows.length === 0) {
      throw Object.assign(new Error('Refresh token inválido ou expirado'), { statusCode: 401 });
    }

    const row = rows[0];

    if (!row.ativo || !row.usuario_ativo) {
      throw Object.assign(new Error('Usuário inativo'), { statusCode: 403 });
    }

    // Revoga o token usado (rotação de refresh token)
    await query('UPDATE refresh_tokens SET revoked = 1 WHERE id = ?', [row.id]);

    return {
      id: row.funcionario_id,
      empresa_id: row.empresa_id,
      filial_id: row.filial_id ?? null,
      nome: row.nome,
      email: row.email,
      role: row.role,
      trocar_senha: Boolean(row.trocar_senha),
    };
  },

  /**
   * Revoga todos os refresh tokens de um usuário (logout total).
   */
  async revokeAllTokens(funcionarioId) {
    await query(
      'UPDATE refresh_tokens SET revoked = 1 WHERE funcionario_id = ?',
      [funcionarioId]
    );
  },

  /**
   * Altera a senha de um funcionário.
   */
  async changePassword(funcionarioId, currentPassword, newPassword) {
    const rows = await query(
      'SELECT senha_hash, cpf FROM usuarios WHERE funcionario_id = ? AND ativo = 1',
      [funcionarioId]
    );

    if (rows.length === 0) {
      throw Object.assign(new Error('Usuário não encontrado'), { statusCode: 404 });
    }

    const senhaCorreta = await bcrypt.compare(currentPassword, rows[0].senha_hash);
    if (!senhaCorreta) {
      throw Object.assign(new Error('Senha atual incorreta'), { statusCode: 400 });
    }
    if (newPassword === currentPassword) {
      throw Object.assign(new Error('A nova senha precisa ser diferente da atual'), { statusCode: 400 });
    }
    const motivoNova = motivoSenhaFraca(newPassword, rows[0].cpf);
    if (motivoNova) {
      throw Object.assign(new Error(motivoNova), { statusCode: 400 });
    }

    const novaHash = await bcrypt.hash(newPassword, 10);
    await UsuarioRepository.updateSenhaHash(funcionarioId, novaHash);
    await query('UPDATE funcionarios SET senha_hash = ? WHERE id = ?', [novaHash, funcionarioId]);

    // Revoga todos os refresh tokens (força re-login)
    await this.revokeAllTokens(funcionarioId);
  },

  /**
   * Solicita recuperação de senha por CPF (somente dígitos).
   * Se o CPF não existir em `usuarios`, retorna o mesmo sucesso genérico (evita enumeração).
   */
  async requestPasswordReset(cpf) {
    const digits = onlyCpfDigits(cpf);
    if (digits.length !== 11) {
      return { ok: true, resetLink: null };
    }

    const funcionarioId = await UsuarioRepository.findFuncionarioIdByCpfDigits(digits);
    if (!funcionarioId) {
      return { ok: true, resetLink: null };
    }

    await query('DELETE FROM password_reset_tokens WHERE funcionario_id = ? AND used_at IS NULL', [
      funcionarioId,
    ]);

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await query(
      `INSERT INTO password_reset_tokens (funcionario_id, token_hash, expires_at)
       VALUES (?, ?, ?)`,
      [funcionarioId, tokenHash, expiresAt]
    );

    const base = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
    const path = process.env.PASSWORD_RESET_PATH || '/redefinir-senha';
    const pathNorm = path.startsWith('/') ? path : `/${path}`;
    const resetLink = `${base}${pathNorm}?token=${rawToken}`;

    return { ok: true, resetLink };
  },

  /**
   * Redefine senha usando token de recuperação (único uso).
   */
  async resetPasswordWithToken(tokenPlain, newPassword) {
    if (!tokenPlain || String(tokenPlain).length < 10) {
      const err = new Error('Token inválido ou expirado');
      err.statusCode = 400;
      throw err;
    }

    const tokenHash = crypto.createHash('sha256').update(String(tokenPlain).trim()).digest('hex');

    const rows = await query(
      `SELECT id, funcionario_id FROM password_reset_tokens
       WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW()
       LIMIT 1`,
      [tokenHash]
    );

    if (rows.length === 0) {
      const err = new Error('Token inválido ou expirado');
      err.statusCode = 400;
      throw err;
    }

    const row = rows[0];
    const [usuario] = await query('SELECT cpf FROM usuarios WHERE funcionario_id = ?', [row.funcionario_id]);
    const motivo = motivoSenhaFraca(newPassword, usuario?.cpf);
    if (motivo) {
      throw Object.assign(new Error(motivo), { statusCode: 400 });
    }
    const novaHash = await bcrypt.hash(newPassword, 10);

    await UsuarioRepository.updateSenhaHash(row.funcionario_id, novaHash);
    await query('UPDATE funcionarios SET senha_hash = ? WHERE id = ?', [novaHash, row.funcionario_id]);
    await query('UPDATE password_reset_tokens SET used_at = NOW() WHERE id = ?', [row.id]);
    await this.revokeAllTokens(row.funcionario_id);
  },

  /**
   * Hasheia uma senha (para criação de funcionário).
   */
  async hashPassword(password) {
    return bcrypt.hash(password, 10);
  },
};
