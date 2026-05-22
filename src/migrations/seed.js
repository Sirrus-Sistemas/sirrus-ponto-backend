import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { getPool, closePool } from '../config/database.js';

async function seed() {
  const pool = getPool();
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    console.log('🌱 Iniciando seed de dados...\n');

    // ─── EMPRESA ──────────────────────────────────────
    const [empResult] = await conn.execute(
      `INSERT INTO empresas (razao_social, nome_fantasia, cnpj, cidade, uf, timezone)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE nome_fantasia = VALUES(nome_fantasia)`,
      ['Empresa Demo LTDA', 'Empresa Demo', '12.345.678/0001-90', 'Porto Velho', 'RO', 'America/Porto_Velho']
    );
    const empresaId = empResult.insertId || 1;
    console.log('   ✅ Empresa criada');

    // ─── DEPARTAMENTOS ────────────────────────────────
    const deptos = ['Administrativo', 'TI', 'Financeiro', 'Comercial', 'Marketing', 'RH', 'Operações'];
    const deptoIds = {};

    for (const nome of deptos) {
      await conn.execute(
        `INSERT INTO departamentos (empresa_id, nome)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE nome = VALUES(nome)`,
        [empresaId, nome]
      );
      const [dRows] = await conn.execute(
        'SELECT id FROM departamentos WHERE empresa_id = ? AND nome = ? LIMIT 1',
        [empresaId, nome]
      );
      deptoIds[nome] = dRows[0].id;
    }
    console.log('   ✅ Departamentos criados');

    // ─── TURNOS ───────────────────────────────────────
    const turnosData = [
      { nome: 'Comercial', entrada: '08:00', si: '12:00', ri: '13:00', saida: '17:00', batidas: 8 },
      { nome: 'TI', entrada: '09:00', si: '12:00', ri: '13:00', saida: '18:00', batidas: 6 },
      { nome: 'Madrugada', entrada: '22:00', si: '02:00', ri: '03:00', saida: '06:00', batidas: 4 },
    ];
    const turnoIds = {};

    for (const t of turnosData) {
      const [r] = await conn.execute(
        `INSERT INTO turnos (empresa_id, nome, entrada, saida_intervalo, retorno_intervalo, saida, batidas_esperadas_dia)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [empresaId, t.nome, t.entrada, t.si, t.ri, t.saida, t.batidas ?? 8]
      );
      turnoIds[t.nome] = r.insertId;
    }
    console.log('   ✅ Turnos criados');

    // ─── FUNCIONÁRIOS ─────────────────────────────────
    const senhaHash = await bcrypt.hash('123456', 10);

    const funcs = [
      { cpf: '52998224725', nome: 'Admin Sistema', email: 'admin@demo.com', cargo: 'Administrador', role: 'admin', depto: 'Administrativo', turno: 'Comercial' },
      { cpf: '39053344705', nome: 'Ana Carolina Silva', email: 'ana@demo.com', cargo: 'Analista de RH', role: 'gestor', depto: 'RH', turno: 'Comercial' },
      { cpf: '11144477735', nome: 'Bruno Oliveira Santos', email: 'bruno@demo.com', cargo: 'Desenvolvedor Full Stack', role: 'funcionario', depto: 'TI', turno: 'TI' },
      { cpf: '33612375844', nome: 'Carla Mendes Rocha', email: 'carla@demo.com', cargo: 'Analista Contábil', role: 'funcionario', depto: 'Financeiro', turno: 'Comercial' },
      { cpf: '74631468595', nome: 'Diego Ferreira Lima', email: 'diego@demo.com', cargo: 'Vendedor Externo', role: 'funcionario', depto: 'Comercial', turno: 'Comercial' },
      { cpf: '03774754682', nome: 'Elisa Rodrigues Alves', email: 'elisa@demo.com', cargo: 'Designer Gráfico', role: 'funcionario', depto: 'Marketing', turno: 'TI' },
      { cpf: '74687485971', nome: 'Fernando Costa Neto', email: 'fernando@demo.com', cargo: 'DevOps Engineer', role: 'funcionario', depto: 'TI', turno: 'TI' },
      { cpf: '86288366757', nome: 'Gabriela Souza Martins', email: 'gabriela@demo.com', cargo: 'Coord. de RH', role: 'gestor', depto: 'RH', turno: 'Comercial' },
    ];

    for (const f of funcs) {
      const [insFunc] = await conn.execute(
        `INSERT INTO funcionarios
         (empresa_id, departamento_id, turno_id, nome, cpf, email, cargo, role, senha_hash, data_admissao, matricula)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURDATE(), ?)`,
        [
          empresaId,
          deptoIds[f.depto],
          turnoIds[f.turno],
          f.nome,
          f.cpf,
          f.email,
          f.cargo,
          f.role,
          senhaHash,
          f.email.split('@')[0].toUpperCase(),
        ]
      );
      const fid = insFunc.insertId;
      await conn.execute(
        `INSERT INTO usuarios (funcionario_id, cpf, senha_hash) VALUES (?, ?, ?)`,
        [fid, f.cpf, senhaHash]
      );
    }
    console.log('   ✅ Funcionários criados');

    // ─── FERIADOS 2026 ────────────────────────────────
    const feriados = [
      { data: '2026-01-01', desc: 'Confraternização Universal', tipo: 'nacional' },
      { data: '2026-01-04', desc: 'Dia do Quadrangular (Feriado Municipal)', tipo: 'municipal' },
      { data: '2026-02-16', desc: 'Carnaval', tipo: 'nacional' },
      { data: '2026-02-17', desc: 'Carnaval', tipo: 'nacional' },
      { data: '2026-04-03', desc: 'Sexta-feira Santa', tipo: 'nacional' },
      { data: '2026-04-21', desc: 'Tiradentes', tipo: 'nacional' },
      { data: '2026-05-01', desc: 'Dia do Trabalho', tipo: 'nacional' },
      { data: '2026-06-04', desc: 'Corpus Christi', tipo: 'nacional' },
      { data: '2026-09-07', desc: 'Independência do Brasil', tipo: 'nacional' },
      { data: '2026-10-12', desc: 'Nossa Sra. Aparecida', tipo: 'nacional' },
      { data: '2026-11-02', desc: 'Finados', tipo: 'nacional' },
      { data: '2026-11-15', desc: 'Proclamação da República', tipo: 'nacional' },
      { data: '2026-12-25', desc: 'Natal', tipo: 'nacional' },
    ];

    for (const f of feriados) {
      await conn.execute(
        `INSERT INTO feriados (empresa_id, data, descricao, tipo)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE descricao = VALUES(descricao)`,
        [empresaId, f.data, f.desc, f.tipo]
      );
    }
    console.log('   ✅ Feriados 2026 criados');

    // ─── CONFIGURAÇÕES PADRÃO ─────────────────────────
    const configs = [
      { chave: 'exigir_foto_marcacao', valor: '1', desc: 'Exigir foto ao registrar ponto' },
      { chave: 'exigir_geolocalizacao', valor: '1', desc: 'Exigir geolocalização ao registrar ponto' },
      { chave: 'raio_perimetro_metros', valor: '200', desc: 'Raio permitido para marcação (metros)' },
      { chave: 'workflow_aprovacao', valor: 'gestor_rh', desc: 'Fluxo: gestor dá visto, RH aprova' },
      { chave: 'comprovante_email', valor: '1', desc: 'Enviar comprovante por email' },
      { chave: 'assinatura_eletronica', valor: '1', desc: 'Habilitar assinatura eletrônica do cartão ponto' },
    ];

    for (const c of configs) {
      await conn.execute(
        `INSERT INTO configuracoes (empresa_id, chave, valor, descricao)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE valor = VALUES(valor)`,
        [empresaId, c.chave, c.valor, c.desc]
      );
    }
    console.log('   ✅ Configurações padrão criadas');

    await conn.commit();
    console.log('\n🎉 Seed concluído com sucesso!\n');
    console.log('   🪪 Login (CPF admin): 529.982.247-25');
    console.log('   🔑 Senha padrão: 123456\n');
  } catch (err) {
    await conn.rollback();
    console.error('❌ Erro no seed:', err);
    throw err;
  } finally {
    conn.release();
    await closePool();
  }
}

seed().catch(() => process.exit(1));
