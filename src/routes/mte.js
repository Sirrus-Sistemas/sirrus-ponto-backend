import { readFileSync } from 'fs';
import { authenticate, authorize, empresaScope } from '../middlewares/auth.js';
import { auditar } from '../services/auditService.js';
import { assinarPkcs7, isMobileConfigured } from '../services/pontoMobileService.js';
import { gerarAFDRepP } from '../services/mte/afd.js';
import { carregarContexto, carregarFilial } from '../services/mte/dados.js';
import { gerarACJEF, gerarAEJ, gerarAFDT } from '../services/mte/geradores.js';
import { montarArquivo } from '../services/mte/comum.js';

const VERSAO = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url))).version;
const ARQUIVOS = ['afd', 'afdt', 'acjef', 'aej'];
const DATA = /^\d{4}-\d{2}-\d{2}$/;

// Arquivos do Ministério do Trabalho: AFD (REP-P, Portaria 671), AFDT e ACJEF
// (Portaria 1510) e AEJ (Portaria 671). Download do .txt ou, com assinar=1,
// do .p7s assinado (PKCS#7 com o certificado da Sirrus).
export default async function mteRoutes(fastify) {
  fastify.addHook('preHandler', authenticate);
  fastify.addHook('preHandler', empresaScope);

  fastify.get('/mte/:arquivo', { preHandler: [authorize('admin', 'gestor')] }, async (request, reply) => {
    const arquivo = String(request.params.arquivo).toLowerCase();
    const { filial_id, lotacao_id, inicio, fim, assinar } = request.query;

    if (!ARQUIVOS.includes(arquivo)) return reply.code(404).send({ message: 'Arquivo desconhecido.' });
    if (!filial_id) return reply.code(400).send({ message: 'Selecione a filial.' });
    if (!DATA.test(inicio || '') || !DATA.test(fim || '') || inicio > fim) {
      return reply.code(400).send({ message: 'Informe um período válido.' });
    }
    if ((Date.parse(fim) - Date.parse(inicio)) / 86400000 > 366) {
      return reply.code(400).send({ message: 'Período máximo de 1 ano.' });
    }

    const empresaId = request.empresaId;
    const filialId = Number(filial_id);
    let linhas;
    let avisos = [];
    if (arquivo === 'afd') {
      // AFD é do REP (por filial) — não filtra por lotação.
      const base = await carregarFilial(empresaId, filialId);
      if (!base) return reply.code(404).send({ message: 'Filial não encontrada.' });
      const r = await gerarAFDRepP({ empresaId, ...base, inicio, fim, geradoEm: new Date() });
      linhas = r.linhas;
      if (r.quantidade === 0) avisos.push('Nenhuma batida do aplicativo/web no período.');
    } else {
      const ctx = await carregarContexto({
        empresaId, filialId, lotacaoId: lotacao_id ? Number(lotacao_id) : null, inicio, fim, versaoPrograma: VERSAO,
      });
      if (!ctx) return reply.code(404).send({ message: 'Filial não encontrada.' });
      if (ctx.funcionarios.length === 0) return reply.code(404).send({ message: 'Nenhum funcionário no período.' });
      if (arquivo === 'afdt') linhas = gerarAFDT(ctx);
      else if (arquivo === 'acjef') linhas = gerarACJEF(ctx);
      else {
        const r = gerarAEJ(ctx);
        linhas = r.linhas;
        if (r.semCpf.length) avisos.push(`Sem CPF (fora do AEJ): ${r.semCpf.join(', ')}`);
      }
    }

    const conteudo = montarArquivo(linhas);
    let nome = `${arquivo.toUpperCase()}_${inicio}_${fim}.txt`;
    let corpo = conteudo;
    if (assinar === '1') {
      if (!isMobileConfigured()) return reply.code(422).send({ message: 'Assinatura indisponível: integração com o Ponto Mobile não configurada.' });
      corpo = await assinarPkcs7(conteudo, nome);
      nome += '.p7s';
    }

    auditar({
      acao: 'EXPORT',
      tabela: 'arquivos_mte',
      registro_id: `${arquivo}-${filialId}-${inicio}-${fim}`,
      dados_anteriores: null,
      dados_novos: { arquivo, filial_id: filialId, lotacao_id: lotacao_id || null, inicio, fim, assinado: assinar === '1', linhas: linhas.length },
      usuario_id: request.user.id,
      empresa_id: empresaId,
      ip: request.ip,
    });

    if (avisos.length) reply.header('X-Avisos', encodeURIComponent(avisos.join(' | ')));
    return reply
      .header('Content-Type', assinar === '1' ? 'application/pkcs7-mime' : 'text/plain; charset=ISO-8859-1')
      .header('Content-Disposition', `attachment; filename="${nome}"`)
      .header('Access-Control-Expose-Headers', 'Content-Disposition, X-Avisos')
      .send(corpo);
  });
}
