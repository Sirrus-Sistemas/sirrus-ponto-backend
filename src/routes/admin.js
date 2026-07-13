/**
 * Rotas super-admin — gerenciamento de empresas e usuários iniciais.
 * Protegidas pelo header X-Admin-Key (variável ADMIN_SECRET no .env).
 * Não usa JWT nem empresaScope — acesso irrestrito por empresa.
 */

import { query } from '../config/database.js';
import { AuthService } from '../services/authService.js';
import { UsuarioRepository } from '../repositories/usuarioRepository.js';
import { onlyCpfDigits } from '../utils/cpf.js';

function onlyCnpjDigits(v) {
  return (v ?? '').replace(/\D/g, '');
}

function adminKeyMiddleware(request, reply, done) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) {
    return reply.code(503).send({ message: 'ADMIN_SECRET não configurado no servidor.' });
  }
  const key = request.headers['x-admin-key'];
  if (!key || key !== secret) {
    return reply.code(401).send({ message: 'Chave de administrador inválida.' });
  }
  done();
}

export default async function adminRoutes(fastify) {
  fastify.addHook('preHandler', adminKeyMiddleware);

  // ── POST /admin/empresas ─────────────────────────────────────────────────
  // Cria uma nova empresa e o seu primeiro usuário admin.
  fastify.post('/admin/empresas', async (request, reply) => {
    const { razao_social, nome_fantasia, cnpj, email, telefone, cidade, uf, cep, endereco, timezone, admin,
            max_filiais, max_funcionarios } = request.body ?? {};

    if (!razao_social?.trim())  return reply.code(400).send({ message: 'Informe razao_social.' });
    if (!cnpj?.trim())          return reply.code(400).send({ message: 'Informe cnpj.' });
    if (!admin?.nome?.trim())   return reply.code(400).send({ message: 'Informe admin.nome.' });
    if (!admin?.cpf?.trim())    return reply.code(400).send({ message: 'Informe admin.cpf.' });
    if (!admin?.email?.trim())  return reply.code(400).send({ message: 'Informe admin.email.' });
    if (!admin?.password)       return reply.code(400).send({ message: 'Informe admin.password.' });
    if (admin.password.length < 6) return reply.code(400).send({ message: 'admin.password deve ter ao menos 6 caracteres.' });

    const maxF  = parseInt(max_filiais,      10);
    const maxFu = parseInt(max_funcionarios, 10);
    if (!Number.isFinite(maxF)  || maxF  < 1) return reply.code(400).send({ message: 'Informe max_filiais (inteiro >= 1).' });
    if (!Number.isFinite(maxFu) || maxFu < 1) return reply.code(400).send({ message: 'Informe max_funcionarios (inteiro >= 1).' });

    const cnpjDigits = onlyCnpjDigits(cnpj);
    if (cnpjDigits.length !== 14) return reply.code(400).send({ message: 'CNPJ inválido. Informe 14 dígitos.' });

    const cpfDigits = onlyCpfDigits(admin.cpf);
    if (cpfDigits.length !== 11) return reply.code(400).send({ message: 'admin.cpf inválido. Informe 11 dígitos.' });

    // Upsert: se o CNPJ já existe, atualiza os dados e retorna
    const [cnpjExiste] = await query('SELECT id FROM empresas WHERE cnpj = ? LIMIT 1', [cnpjDigits]);
    if (cnpjExiste) {
      await query(
        `UPDATE empresas
            SET razao_social = ?, nome_fantasia = ?, email = ?, telefone = ?,
                cidade = ?, uf = ?, cep = ?, endereco = ?, timezone = ?,
                max_filiais = ?, max_funcionarios = ?
          WHERE id = ?`,
        [
          razao_social.trim(), nome_fantasia?.trim() || null, email?.trim() || null,
          telefone?.trim() || null, cidade?.trim() || null, uf?.trim() || null,
          cep?.trim() || null, endereco?.trim() || null, timezone || 'America/Sao_Paulo',
          maxF, maxFu, cnpjExiste.id,
        ],
      );
      const empresa = (await query('SELECT * FROM empresas WHERE id = ?', [cnpjExiste.id]))[0];
      const admins  = await query(
        `SELECT id, nome, cpf, email, role, ativo, created_at
           FROM funcionarios WHERE empresa_id = ? AND role = 'admin' ORDER BY created_at`,
        [cnpjExiste.id],
      );
      return reply.code(200).send({
        success: true,
        message: 'Empresa já existia — dados e limites atualizados.',
        data: { empresa, admins },
      });
    }

    const [cpfExiste] = await query('SELECT id FROM funcionarios WHERE cpf = ? LIMIT 1', [cpfDigits]);
    if (cpfExiste) return reply.code(409).send({ message: 'CPF do usuário admin já cadastrado no sistema.' });

    // Cria empresa
    const empresaResult = await query(
      `INSERT INTO empresas
         (razao_social, nome_fantasia, cnpj, email, telefone, cidade, uf, cep, endereco, timezone, max_filiais, max_funcionarios)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        razao_social.trim(),
        nome_fantasia?.trim() || null,
        cnpjDigits,
        email?.trim()    || null,
        telefone?.trim() || null,
        cidade?.trim()   || null,
        uf?.trim()       || null,
        cep?.trim()      || null,
        endereco?.trim() || null,
        timezone         || 'America/Sao_Paulo',
        maxF,
        maxFu,
      ],
    );
    const empresaId = empresaResult.insertId;

    // Cria funcionário admin
    const senhaHash   = await AuthService.hashPassword(admin.password);
    const dataAdmissao = admin.data_admissao || new Date().toISOString().slice(0, 10);

    const funcResult = await query(
      `INSERT INTO funcionarios
         (empresa_id, nome, cpf, email, senha_hash, senha_mobile, role, data_admissao, ativo)
       VALUES (?, ?, ?, ?, ?, ?, 'admin', ?, 1)`,
      [empresaId, admin.nome.trim(), cpfDigits, admin.email.trim(), senhaHash, admin.password, dataAdmissao],
    );
    const funcionarioId = funcResult.insertId;

    // Cria entrada na tabela usuarios (para autenticação)
    await UsuarioRepository.insertForFuncionario(funcionarioId, cpfDigits, senhaHash);

    // Retorna dados criados (sem senha_hash)
    const empresa = (await query('SELECT * FROM empresas WHERE id = ?', [empresaId]))[0];
    const func    = (await query(
      'SELECT id, nome, cpf, email, role, ativo, data_admissao, created_at FROM funcionarios WHERE id = ?',
      [funcionarioId],
    ))[0];

    return reply.code(201).send({
      success: true,
      message: 'Empresa e usuário admin criados com sucesso.',
      data: { empresa, admin: func },
    });
  });

  // ── GET /admin/empresas ──────────────────────────────────────────────────
  // Sem query string: lista todas as empresas.
  // Com ?cnpj=...: retorna a empresa + admins (CNPJ com ou sem pontuação).
  fastify.get('/admin/empresas', async (request, reply) => {
    const cnpjRaw = request.query.cnpj;

    if (cnpjRaw) {
      const cnpjDigits = onlyCnpjDigits(cnpjRaw);
      if (!cnpjDigits) return reply.code(400).send({ message: 'CNPJ inválido.' });

      const empresa = (await query(
        'SELECT * FROM empresas WHERE cnpj = ? LIMIT 1',
        [cnpjDigits],
      ))[0];

      if (!empresa) {
        return reply.code(404).send({ message: `Empresa com CNPJ ${cnpjRaw} não encontrada.` });
      }

      const admins = await query(
        `SELECT id, nome, cpf, email, cargo, role, ativo, data_admissao, created_at
         FROM funcionarios
         WHERE empresa_id = ? AND role = 'admin'
         ORDER BY created_at`,
        [empresa.id],
      );

      const totalFuncionarios = (await query(
        'SELECT COUNT(*) AS total FROM funcionarios WHERE empresa_id = ? AND ativo = 1',
        [empresa.id],
      ))[0]?.total ?? 0;

      return { success: true, data: { empresa, admins, total_funcionarios_ativos: totalFuncionarios } };
    }

    // Lista geral
    const empresas = await query(
      `SELECT e.id, e.razao_social, e.nome_fantasia, e.cnpj, e.cidade, e.uf, e.ativa,
              e.max_filiais, e.max_funcionarios, e.created_at,
              COUNT(f.id) AS total_funcionarios_ativos
       FROM empresas e
       LEFT JOIN funcionarios f ON f.empresa_id = e.id AND f.ativo = 1
       GROUP BY e.id
       ORDER BY e.razao_social`,
    );
    return { success: true, data: empresas };
  });

  // ── PUT /admin/empresas/:id/limites ─────────────────────────────────────
  // Ajusta os limites de filiais e funcionários de uma empresa (upgrade/downgrade de plano).
  fastify.put('/admin/empresas/:id/limites', async (request, reply) => {
    const { max_filiais, max_funcionarios } = request.body ?? {};
    const maxF  = parseInt(max_filiais,      10);
    const maxFu = parseInt(max_funcionarios, 10);
    if (!Number.isFinite(maxF)  || maxF  < 1) return reply.code(400).send({ message: 'Informe max_filiais (inteiro >= 1).' });
    if (!Number.isFinite(maxFu) || maxFu < 1) return reply.code(400).send({ message: 'Informe max_funcionarios (inteiro >= 1).' });

    await query(
      'UPDATE empresas SET max_filiais = ?, max_funcionarios = ? WHERE id = ?',
      [maxF, maxFu, request.params.id],
    );
    return { success: true, message: `Limites atualizados: ${maxF} filial(is), ${maxFu} funcionário(s).` };
  });

  // ── PUT /admin/empresas/:id/ativar ───────────────────────────────────────
  // Ativa ou desativa uma empresa.
  fastify.put('/admin/empresas/:id/ativar', async (request, reply) => {
    const { ativa } = request.body ?? {};
    if (ativa === undefined) return reply.code(400).send({ message: 'Informe ativa (true/false).' });

    await query('UPDATE empresas SET ativa = ? WHERE id = ?', [ativa ? 1 : 0, request.params.id]);
    return { success: true, message: `Empresa ${ativa ? 'ativada' : 'desativada'} com sucesso.` };
  });
}
