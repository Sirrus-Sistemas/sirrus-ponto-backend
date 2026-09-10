import { query } from '../config/database.js';
import { FuncionarioRepository } from '../repositories/funcionarioRepository.js';
import { UsuarioRepository } from '../repositories/usuarioRepository.js';
import { RelogioSyncRepository } from '../repositories/relogioSyncRepository.js';
import { RelogioMarcacaoRepository } from '../repositories/relogioMarcacaoRepository.js';
import { AuthService } from '../services/authService.js';
import { onlyCpfDigits } from '../utils/cpf.js';
import { criarModeloXlsx, lerLinhasXlsx, textoDaCelula, dataDaCelula } from '../utils/xlsxImport.js';

const COLUNAS = [
  { titulo: 'Nome*', largura: 30, textoLivre: true },
  { titulo: 'Email*', largura: 30, textoLivre: true },
  { titulo: 'CPF*', largura: 16, textoLivre: true },
  { titulo: 'Data de Admissão* (DD/MM/AAAA)', largura: 22, textoLivre: true },
  { titulo: 'Cargo', largura: 20, textoLivre: true },
  { titulo: 'Matrícula', largura: 16, textoLivre: true },
  { titulo: 'PIS', largura: 16, textoLivre: true },
  { titulo: 'Telefone', largura: 18, textoLivre: true },
  { titulo: 'Lotação (nome)', largura: 25, textoLivre: true },
  { titulo: 'Tabela de Horários (nome)', largura: 25, textoLivre: true },
  { titulo: 'Perfil (admin/gestor/funcionario)', largura: 22, textoLivre: true },
];

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES_VALIDOS = ['admin', 'gestor', 'funcionario'];

/**
 * Modelo de import de funcionários. Sem coluna de senha — o sistema gera
 * uma senha inicial a partir dos 6 primeiros dígitos do CPF de cada um.
 * Filial, departamento, gestor e endereço/município ficam de fora —
 * ajuste manual depois em Funcionários para quem precisar.
 */
export async function gerarModeloFuncionarios() {
  return criarModeloXlsx({
    titulo: 'Funcionários',
    instrucao:
      'Preencha um funcionário por linha, a partir da linha 3. Não altere a linha 2 (cabeçalho). ' +
      'Lotação e Tabela de Horários devem ter o mesmo nome já cadastrado nos passos anteriores do import. ' +
      'A senha inicial de acesso é gerada automaticamente a partir dos 6 primeiros dígitos do CPF — ' +
      'não há coluna de senha nesta planilha.',
    colunas: COLUNAS,
  });
}

export async function importarFuncionarios(buffer, empresaId) {
  const linhas = await lerLinhasXlsx(buffer);
  if (linhas.length === 0) {
    return { erros: [{ linha: 3, campo: 'Nome', mensagem: 'A planilha não tem nenhuma linha preenchida.' }] };
  }

  const [lotacoes, turnos, cpfsExistentes, limiteRow] = await Promise.all([
    query('SELECT id, nome FROM lotacoes WHERE empresa_id = ?', [empresaId]),
    query('SELECT id, nome FROM turnos WHERE empresa_id = ?', [empresaId]),
    query('SELECT cpf FROM funcionarios WHERE cpf IS NOT NULL'),
    query(
      `SELECT e.max_funcionarios, COUNT(f.id) AS total_ativos
         FROM empresas e
         LEFT JOIN funcionarios f ON f.empresa_id = e.id AND f.ativo = 1
        WHERE e.id = ?
        GROUP BY e.id`,
      [empresaId],
    ),
  ]);

  const lotacaoPorNome = new Map(lotacoes.map((l) => [l.nome.trim().toLowerCase(), l.id]));
  const turnoPorNome = new Map(turnos.map((t) => [t.nome.trim().toLowerCase(), t.id]));
  const cpfsNoBanco = new Set(cpfsExistentes.map((r) => r.cpf));

  const erros = [];
  const cpfsNoArquivo = new Set();
  const emailsNoArquivo = new Set();
  const validas = [];

  for (const { numeroLinha, celulas } of linhas) {
    const nome = textoDaCelula(celulas[0]);
    const email = textoDaCelula(celulas[1]);
    const cpf = onlyCpfDigits(textoDaCelula(celulas[2]));
    const dataAdmissao = dataDaCelula(celulas[3]);
    const cargo = textoDaCelula(celulas[4]);
    const matricula = textoDaCelula(celulas[5]);
    const pis = textoDaCelula(celulas[6]);
    const telefone = textoDaCelula(celulas[7]);
    const lotacaoNome = textoDaCelula(celulas[8]);
    const turnoNome = textoDaCelula(celulas[9]);
    const role = textoDaCelula(celulas[10]).toLowerCase();

    let temErro = false;
    const erro = (campo, mensagem) => { erros.push({ linha: numeroLinha, campo, mensagem }); temErro = true; };

    if (nome.length < 3) erro('Nome', 'Informe um nome com pelo menos 3 caracteres.');
    if (!EMAIL_REGEX.test(email)) erro('Email', 'Informe um email válido.');
    if (cpf.length !== 11) erro('CPF', 'Informe os 11 dígitos do CPF.');
    else if (cpfsNoBanco.has(cpf)) erro('CPF', 'Este CPF já está cadastrado no sistema.');
    else if (cpfsNoArquivo.has(cpf)) erro('CPF', 'CPF repetido nesta planilha.');
    if (email && emailsNoArquivo.has(email.toLowerCase())) erro('Email', 'Email repetido nesta planilha.');
    if (!dataAdmissao) erro('Data de Admissão', 'Use o formato DD/MM/AAAA.');
    if (role !== '' && !ROLES_VALIDOS.includes(role)) erro('Perfil', 'Deve ser admin, gestor ou funcionario.');

    let lotacaoId = null;
    if (lotacaoNome !== '') {
      lotacaoId = lotacaoPorNome.get(lotacaoNome.toLowerCase()) ?? null;
      if (lotacaoId === null) erro('Lotação', `Nenhuma lotação chamada "${lotacaoNome}" foi encontrada.`);
    }

    let turnoId = null;
    if (turnoNome !== '') {
      turnoId = turnoPorNome.get(turnoNome.toLowerCase()) ?? null;
      if (turnoId === null) erro('Tabela de Horários', `Nenhuma tabela de horários chamada "${turnoNome}" foi encontrada.`);
    }

    if (temErro) continue;

    cpfsNoArquivo.add(cpf);
    emailsNoArquivo.add(email.toLowerCase());
    validas.push({
      nome, email, cpf, data_admissao: dataAdmissao,
      cargo: cargo || null, matricula: matricula || null, pis: pis || null, telefone: telefone || null,
      lotacao_id: lotacaoId, turno_id: turnoId, role: role || 'funcionario',
      senha: cpf.slice(0, 6),
    });
  }

  if (validas.length > 0 && limiteRow && limiteRow.max_funcionarios != null) {
    const totalAposImport = limiteRow.total_ativos + validas.length;
    if (totalAposImport > limiteRow.max_funcionarios) {
      return {
        erros: [{
          linha: 3,
          campo: 'Planilha',
          mensagem: `Esta empresa tem limite de ${limiteRow.max_funcionarios} funcionário(s) ativo(s); ` +
            `a planilha tentaria cadastrar ${validas.length}. Entre em contato com o suporte Sirrus para ampliar o plano.`,
        }],
      };
    }
  }

  if (erros.length > 0) return { erros };

  const criados = [];
  for (const f of validas) {
    const senhaHash = await AuthService.hashPassword(f.senha);
    const data = {
      empresa_id: empresaId,
      nome: f.nome,
      email: f.email,
      cpf: f.cpf,
      data_admissao: f.data_admissao,
      cargo: f.cargo,
      matricula: f.matricula,
      pis: f.pis,
      telefone: f.telefone,
      lotacao_id: f.lotacao_id,
      turno_id: f.turno_id,
      role: f.role,
      senha_hash: senhaHash,
      senha_mobile: f.senha,
    };

    const id = await FuncionarioRepository.create(data);
    await UsuarioRepository.insertForFuncionario(id, f.cpf, senhaHash);

    RelogioSyncRepository.enqueueForAllRelogios(empresaId, id, 'inserir').catch(() => {});
    RelogioMarcacaoRepository.vincularPendentes(empresaId, id, { cpf: f.cpf, pis: f.pis }).catch(() => {});

    criados.push({ nome: f.nome, email: f.email, cpf: f.cpf, senha_inicial: f.senha });
  }

  return { importados: criados.length, funcionarios: criados };
}
