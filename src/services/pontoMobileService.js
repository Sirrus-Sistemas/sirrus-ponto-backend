/**
 * Integração com o Sirrus Ponto Mobile.
 *
 * Cada filial (CNPJ próprio) é tratada como uma "empresa" na API mobile.
 *
 * Vars de ambiente necessárias:
 *   PONTOMOBILE_URL    — base URL da API PHP (ex.: http://192.168.1.10)
 *   PONTOMOBILE_CPF    — CPF do usuário admin na API mobile
 *   PONTOMOBILE_SENHA  — senha do usuário admin
 */

import { query } from '../config/database.js';
import { PONTO_DUPLICATA_JANELA_SEG } from '../config/constants.js';
import crypto from 'crypto';

const BASE_URL = (process.env.PONTOMOBILE_URL || '').replace(/\/$/, '');

// ── Token cache (memória; reinicia junto com o processo) ─────────────────────
let _token = null;
let _tokenExpiry = 0;

async function _request(method, path, body = null, retries = 3) {
  if (!BASE_URL) throw new Error('PONTOMOBILE_URL não configurada.');
  const token = await _getToken();
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}/api/v1${path}`, opts);
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (res.status === 429 && retries > 0) {
    const retryAfter = Number(res.headers.get('Retry-After') || 0) || 60;
    await new Promise((r) => setTimeout(r, retryAfter * 1000));
    return _request(method, path, body, retries - 1);
  }
  if (!res.ok) throw new Error(`Mobile API ${res.status}: ${json?.message ?? text}`);
  return json;
}

async function _getToken() {
  if (_token && Date.now() < _tokenExpiry) return _token;
  if (!process.env.PONTOMOBILE_CPF || !process.env.PONTOMOBILE_SENHA) {
    throw new Error('PONTOMOBILE_CPF / PONTOMOBILE_SENHA não configurados.');
  }
  const res = await fetch(`${BASE_URL}/api/v1/app/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      username: process.env.PONTOMOBILE_CPF,
      password: process.env.PONTOMOBILE_SENHA,
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Login mobile falhou: ${json?.message ?? res.status}`);
  _token = json.access_token;
  _tokenExpiry = Date.now() + 50 * 60 * 1000; // 50 min
  return _token;
}

/**
 * Tenta descobrir o funcionario_id mobile de um CPF fazendo login como ele.
 * A API mobile retorna o array de funcionários vinculados ao usuário no login.
 * Retorna null se não conseguir encontrar.
 */
async function _resolverMobileIdPorCpf(cpf, senhasTentativa) {
  for (const senha of senhasTentativa) {
    try {
      const res = await fetch(`${BASE_URL}/api/v1/app/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ username: cpf, password: senha }),
      });
      if (!res.ok) continue;
      const json = await res.json();
      const funcs = json.funcionarios ?? [];
      if (funcs.length > 0) return funcs[0].id;
    } catch {}
  }
  return null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Converte "UTC-05:00" → -5, "UTC-03:30" → -3.5. Padrão: -3. */
function fusoHorarioToNumber(fusoHorario) {
  const m = String(fusoHorario || '').match(/UTC([+-])(\d{2}):(\d{2})/);
  if (!m) return -3;
  const sign = m[1] === '+' ? 1 : -1;
  return sign * (Number(m[2]) + Number(m[3]) / 60);
}

/**
 * Converte marcacao_at da API mobile para UTC.
 * Aceita três formatos:
 *   "2026-05-09 19:00:00"          → sem fuso, aplica offset do campo fuso
 *   "2026-05-09T19:00:00-03:00"    → já tem fuso embutido, converte direto
 *   "2026-05-09T19:00:00Z"         → já em UTC
 */
function marcacaoAtToUtc(marcacaoAt, fuso) {
  if (!marcacaoAt) throw new Error('marcacao_at ausente');
  const normalized = String(marcacaoAt).replace(' ', 'T');

  // Se já tem fuso embutido (+HH:MM, -HH:MM ou Z), parseia direto
  if (/([+-]\d{2}:\d{2}|Z)$/.test(normalized)) {
    const ms = new Date(normalized).getTime();
    if (isNaN(ms)) throw new Error(`Data inválida: ${marcacaoAt}`);
    return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
  }

  // Sem fuso: trata como horário local e converte usando o campo fuso
  const localMs = new Date(`${normalized}Z`).getTime();
  if (isNaN(localMs)) throw new Error(`Data inválida: ${marcacaoAt}`);
  const fusoMs = Number(fuso ?? -3) * 3600000;
  return new Date(localMs - fusoMs).toISOString().replace('T', ' ').slice(0, 19);
}

// ── Sincronização de Filial (= "empresa" no mobile) ──────────────────────────

export async function syncFilial(filialId) {
  const [fil] = await query(
    `SELECT fi.id, fi.nome, fi.cnpj, fi.pontomobile_id,
            e.razao_social AS empresa_razao_social
       FROM filiais fi
       JOIN empresas e ON fi.empresa_id = e.id
      WHERE fi.id = ? LIMIT 1`,
    [filialId],
  );
  if (!fil) throw new Error('Filial não encontrada.');

  const body = {
    cnpj: String(fil.cnpj || '').replace(/\D/g, ''),
    nome_fantasia: fil.nome || '',
    razao_social: fil.nome || fil.empresa_razao_social || '',
  };

  let mobileId = fil.pontomobile_id;
  if (mobileId) {
    await _request('PUT', `/admin/empresas/${mobileId}`, body);
  } else {
    const res = await _request('POST', '/admin/empresas', body);
    mobileId = res.id;
    await query('UPDATE filiais SET pontomobile_id = ? WHERE id = ?', [mobileId, filialId]);
  }
  return mobileId;
}

// ── Sincronização de Lotação ─────────────────────────────────────────────────

export async function syncLotacao(lotacaoId, mobileEmpresaId) {
  const [lot] = await query(
    'SELECT id, nome, pontomobile_id FROM lotacoes WHERE id = ? LIMIT 1',
    [lotacaoId],
  );
  if (!lot) throw new Error('Lotação não encontrada.');

  let mobileId = lot.pontomobile_id;
  if (mobileId) {
    await _request('PUT', `/admin/lotacoes/${mobileId}`, { nome: lot.nome, empresa_id: mobileEmpresaId });
  } else {
    const res = await _request('POST', '/admin/lotacoes', { nome: lot.nome, empresa_id: mobileEmpresaId });
    mobileId = res.id;
    await query('UPDATE lotacoes SET pontomobile_id = ? WHERE id = ?', [mobileId, lotacaoId]);
  }
  return mobileId;
}

// ── Sincronização de Funcionário ─────────────────────────────────────────────

export async function syncFuncionario(funcionarioId, { mobileEmpresaId: cachedEmpresaId, mobileLotacaoId: cachedLotacaoId } = {}) {
  const [func] = await query(
    `SELECT f.id, f.nome, f.cpf, f.email, f.ativo, f.lotacao_id,
            f.pontomobile_id, f.filial_id, f.senha_mobile
       FROM funcionarios f WHERE f.id = ? LIMIT 1`,
    [funcionarioId],
  );
  if (!func) throw new Error('Funcionário não encontrado.');
  if (!func.filial_id) throw new Error('Funcionário sem filial não pode ser sincronizado com o mobile.');

  // 1. Usa cache do lote se disponível, senão sincroniza agora
  const mobileEmpresaId = cachedEmpresaId ?? await syncFilial(func.filial_id);

  // 2. Usa cache do lote se disponível, senão sincroniza agora
  let mobileLotacaoId = cachedLotacaoId ?? null;
  if (mobileLotacaoId === null && func.lotacao_id) {
    mobileLotacaoId = await syncLotacao(func.lotacao_id, mobileEmpresaId);
  }

  // 3. Monta payload
  const cpfClean = String(func.cpf || '').replace(/\D/g, '');
  const senhaMobile = func.senha_mobile || cpfClean;
  const body = {
    nome: func.nome,
    cpf: cpfClean,
    empresa_id: mobileEmpresaId,
    email: func.email || `${cpfClean}@pontomobile.local`,
    senha: senhaMobile,
    ativo: func.ativo === 1,
    admin: 'N',
    ...(mobileLotacaoId != null ? { lotacao_id: mobileLotacaoId } : {}),
  };

  let mobileId = func.pontomobile_id;
  if (mobileId) {
    await _request('PUT', `/admin/users_funcionarios/new/${mobileId}`, body);
  } else {
    try {
      const res = await _request('POST', '/admin/users_funcionarios', body);
      mobileId = res.id;
    } catch (err) {
      // CPF já existe no mobile — descobre o ID fazendo login como o funcionário
      const isDuplicate = err.message.includes('422') || err.message.toLowerCase().includes('duplicate');
      if (!isDuplicate) throw err;

      const senhas = [...new Set([senhaMobile, cpfClean.substring(0, 6), cpfClean])];
      mobileId = await _resolverMobileIdPorCpf(cpfClean, senhas);
      if (!mobileId) throw new Error(`Funcionário já existe no mobile mas não foi possível descobrir o ID. CPF: ${cpfClean}`);

      // Atualiza dados no mobile agora que temos o ID
      await _request('PUT', `/admin/users_funcionarios/new/${mobileId}`, body);
    }
    await query('UPDATE funcionarios SET pontomobile_id = ? WHERE id = ?', [mobileId, funcionarioId]);
  }
  return mobileId;
}

// ── Sincronização em lote de funcionários ────────────────────────────────────

export async function syncAllFuncionarios(empresaId, filialId = null) {
  let sql = 'SELECT id, filial_id, lotacao_id FROM funcionarios WHERE empresa_id = ? AND ativo = 1';
  const params = [empresaId];
  if (filialId) {
    sql += ' AND filial_id = ?';
    params.push(filialId);
  }
  const funcs = await query(sql, params);

  // Pré-sincroniza filiais em paralelo
  const filialIds = [...new Set(funcs.map((f) => f.filial_id).filter(Boolean))];
  const filialCache = new Map();
  await Promise.allSettled(
    filialIds.map(async (fid) => {
      try { filialCache.set(fid, await syncFilial(fid)); } catch { /* será reportado por funcionário */ }
    })
  );

  // Pré-sincroniza lotações em paralelo
  const lotacaoIds = [...new Set(funcs.map((f) => f.lotacao_id).filter(Boolean))];
  const lotacaoCache = new Map();
  await Promise.allSettled(
    lotacaoIds.map(async (lid) => {
      const mobileEmpresaId = filialCache.get(funcs.find((f) => f.lotacao_id === lid)?.filial_id);
      if (mobileEmpresaId) {
        try { lotacaoCache.set(lid, await syncLotacao(lid, mobileEmpresaId)); } catch { /* idem */ }
      }
    })
  );

  // Sincroniza funcionários em paralelo (lotes de 10 para não sobrecarregar a API mobile)
  let sincronizados = 0;
  const erros = [];
  const CONCURRENCY = 10;

  for (let i = 0; i < funcs.length; i += CONCURRENCY) {
    const lote = funcs.slice(i, i + CONCURRENCY);
    const resultados = await Promise.allSettled(lote.map((f) => syncFuncionario(f.id, {
      mobileEmpresaId: filialCache.get(f.filial_id),
      mobileLotacaoId: f.lotacao_id ? lotacaoCache.get(f.lotacao_id) : null,
    })));
    for (let j = 0; j < lote.length; j++) {
      if (resultados[j].status === 'fulfilled') sincronizados++;
      else erros.push({ funcionario_id: lote[j].id, error: resultados[j].reason?.message });
    }
  }

  return { sincronizados, erros };
}

// ── Helpers: Detecção e bloqueio de duplicatas ────────────────────────────────

/**
 * Detecta grupos de 2+ batidas próximas (mesma funcionário, até PONTO_DUPLICATA_JANELA_SEG)
 * Retorna Map { grupo_id → [item1, item2, ...] }
 */
function detectarGruposDuplicatas(items, funcMap) {
  const grupos = new Map(); // grupo_id → [item1, item2, ...]
  const processados = new Set();

  for (let i = 0; i < items.length; i++) {
    if (processados.has(i)) continue;

    const item = items[i];
    const funcEntry = funcMap.get(Number(item.funcionario_id));
    if (!funcEntry) continue;

    const grupo = [item];
    const ts1 = new Date(item.marcacao_at).getTime();

    for (let j = i + 1; j < items.length; j++) {
      if (processados.has(j)) continue;
      const item2 = items[j];
      const funcEntry2 = funcMap.get(Number(item2.funcionario_id));
      if (!funcEntry2 || funcEntry2.id !== funcEntry.id) continue;

      const ts2 = new Date(item2.marcacao_at).getTime();
      const diffSeg = Math.abs(ts1 - ts2) / 1000;

      if (diffSeg <= PONTO_DUPLICATA_JANELA_SEG) {
        grupo.push(item2);
        processados.add(j);
      }
    }

    if (grupo.length >= 2) {
      // Gera grupo_id: hash do funcionário + primeiro timestamp do grupo
      const grupoId = crypto
        .createHash('md5')
        .update(`${funcEntry.id}-${Math.min(...grupo.map((i) => new Date(i.marcacao_at).getTime()))}`)
        .digest('hex')
        .substring(0, 12);
      grupos.set(grupoId, grupo);
      processados.add(i);
    }
  }

  return grupos;
}

/**
 * Bloqueia um grupo de duplicatas em marcacoes_bloqueadas
 */
async function bloquearGrupoDuplicatas(empresaId, grupo, grupoId, motivo) {
  let bloqueadas = 0;
  for (const item of grupo) {
    try {
      await query(
        `INSERT INTO marcacoes_bloqueadas
           (empresa_id, funcionario_id, data_hora, tipo, mobile_ref_id, grupo_id, motivo_bloqueio)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          empresaId,
          Number(item.funcionario_id),
          item.marcacao_at,
          item.origem === 'REP' ? 'rep' : 'online',
          Number(item.id),
          grupoId,
          motivo,
        ],
      );
      bloqueadas++;
    } catch (err) {
      console.error(`[bloquearGrupoDuplicatas] Erro ao bloquear item ${item.id}:`, err.message);
    }
  }
  return bloqueadas;
}

// ── Importar Marcações ───────────────────────────────────────────────────────

export async function pullMarcacoes(filialId, dataInicio, dataFim, lotacaoId = null, funcionarioId = null) {
  const [fil] = await query(
    'SELECT id, empresa_id, pontomobile_id FROM filiais WHERE id = ? LIMIT 1',
    [filialId],
  );
  if (!fil?.pontomobile_id) throw new Error('Filial não sincronizada com o mobile. Sincronize a filial primeiro.');

  const mobileEmpresaId = fil.pontomobile_id;

  // A API mobile trata data_fim como exclusiva; somamos 1 dia para torná-la inclusiva.
  const dataFimInclusiva = new Date(new Date(dataFim).getTime() + 86400000)
    .toISOString()
    .slice(0, 10);

  const data = await _request(
    'GET',
    `/admin/empresas/${mobileEmpresaId}/marcacoes/between/${dataInicio}/${dataFimInclusiva}`,
  );

  const items = Array.isArray(data) ? data : (data?.data ?? []);

  // Auto-sincroniza funcionários sem pontomobile_id
  if (funcionarioId) {
    const [naoSync] = await query(
      'SELECT id FROM funcionarios WHERE id = ? AND filial_id = ? AND ativo = 1 AND pontomobile_id IS NULL LIMIT 1',
      [funcionarioId, filialId],
    );
    if (naoSync) await syncFuncionario(funcionarioId).catch(() => {});
  } else {
    const naoSincronizados = await query(
      `SELECT id FROM funcionarios WHERE filial_id = ? AND ativo = 1 AND pontomobile_id IS NULL${lotacaoId ? ' AND lotacao_id = ?' : ''}`,
      lotacaoId ? [filialId, lotacaoId] : [filialId],
    );
    if (naoSincronizados.length > 0) {
      const CONCURRENCY = 10;
      for (let i = 0; i < naoSincronizados.length; i += CONCURRENCY) {
        const lote = naoSincronizados.slice(i, i + CONCURRENCY);
        await Promise.allSettled(lote.map((f) => syncFuncionario(f.id)));
      }
    }
  }

  // Mapa mobileFuncionarioId → { id, fusoHorario } (filtra por filial, lotação e/ou funcionário específico)
  const mobileIds = [...new Set(items.map((i) => Number(i.funcionario_id)).filter(Boolean))];
  const funcMap = new Map();
  if (mobileIds.length) {
    const placeholders = mobileIds.map(() => '?').join(',');
    const conditions = [
      'f.filial_id = ?',
      lotacaoId ? 'f.lotacao_id = ?' : null,
      funcionarioId ? 'f.id = ?' : null,
      `f.pontomobile_id IN (${placeholders})`,
    ].filter(Boolean).join(' AND ');
    const params = [
      filialId,
      ...(lotacaoId ? [lotacaoId] : []),
      ...(funcionarioId ? [funcionarioId] : []),
      ...mobileIds,
    ];
    const funcs = await query(
      `SELECT f.id, f.pontomobile_id, m.fuso_horario
         FROM funcionarios f
         LEFT JOIN municipios m ON m.CODMUNICIPIO = f.municipio_id
        WHERE ${conditions}`,
      params,
    );
    for (const f of funcs) funcMap.set(Number(f.pontomobile_id), { id: f.id, fusoHorario: f.fuso_horario });
  }

  // Busca dias bloqueados para todos os funcionários locais no período.
  // Usa a mesma janela noturna de 5h do sistema: o dia de referência de uma batida
  // é DATE(data_hora_utc - 5h), então consultamos com uma margem de 1 dia extra.
  const localFuncIds = [...funcMap.values()].map((f) => f.id);
  const bloqueados = new Set(); // "funcionario_id-YYYY-MM-DD"
  if (localFuncIds.length > 0) {
    const ph = localFuncIds.map(() => '?').join(',');
    const diasBloq = await query(
      `SELECT funcionario_id, DATE_FORMAT(data, '%Y-%m-%d') AS data
         FROM marcacoes_dia_bloqueado
        WHERE funcionario_id IN (${ph})
          AND data BETWEEN DATE_SUB(?, INTERVAL 1 DAY) AND DATE_ADD(?, INTERVAL 1 DAY)`,
      [...localFuncIds, dataInicio, dataFimInclusiva],
    );
    for (const d of diasBloq) bloqueados.add(`${d.funcionario_id}-${d.data}`);
  }

  // Detecta grupos de duplicatas antes de processar
  const gruposDuplicatas = detectarGruposDuplicatas(items, funcMap);
  const itensEmGrupo = new Set();
  for (const grupo of gruposDuplicatas.values()) {
    for (const item of grupo) {
      itensEmGrupo.add(Number(item.id));
    }
  }

  let importados = 0;
  let ignorados = 0;
  let bloqueados_count = 0;
  let duplicatas_bloqueadas = 0;
  const erros = [];

  // Bloqueia todos os grupos de duplicatas
  for (const [grupoId, grupo] of gruposDuplicatas) {
    const horariosStr = grupo
      .map((i) => {
        const d = new Date(i.marcacao_at);
        return d.toTimeString().substring(0, 8);
      })
      .join(', ');
    const motivo = `Grupo de duplicatas: ${horariosStr}`;
    const nBloqueadas = await bloquearGrupoDuplicatas(fil.empresa_id, grupo, grupoId, motivo);
    duplicatas_bloqueadas += nBloqueadas;
  }

  for (const item of items) {
    try {
      // Ignora items que foram bloqueados como parte de um grupo
      if (itensEmGrupo.has(Number(item.id))) continue;

      const mobileRefId = Number(item.id);
      const mobileFuncId = Number(item.funcionario_id);
      const funcEntry = funcMap.get(mobileFuncId);

      if (!funcEntry) {
        ignorados++;
        continue;
      }

      const localFuncId = funcEntry.id;
      // Usa fuso da API mobile se disponível; caso contrário usa o fuso configurado no município do funcionário
      const fusoEfetivo = item.fuso != null ? item.fuso : fusoHorarioToNumber(funcEntry.fusoHorario);
      const dataHoraUtc = marcacaoAtToUtc(item.marcacao_at, fusoEfetivo);
      const tipo = item.origem === 'REP' ? 'rep' : 'online';

      // Verifica se o dia de referência desta batida está bloqueado.
      // diaRef = DATE(T_local - 5h), mesma fórmula do SQL da ficha:
      //   DATE(CONVERT_TZ(DATE_SUB(data_hora, INTERVAL 5 HOUR), '+00:00', tzOffset))
      // Usa o fuso do funcionário (municipio), NÃO item.fuso da API mobile,
      // para garantir coerência com o que a ficha exibe.
      const utcMs = new Date(dataHoraUtc.replace(' ', 'T') + 'Z').getTime();
      const fusoNum = fusoHorarioToNumber(funcEntry.fusoHorario); // ex.: -3 para UTC-3
      const localMs = utcMs + fusoNum * 3600000;                  // UTC → horário local
      const diaRef = new Date(localMs - 5 * 3600000).toISOString().slice(0, 10);
      if (bloqueados.has(`${localFuncId}-${diaRef}`)) {
        bloqueados_count++;
        continue;
      }

      // Deduplicata por mobile_ref_id (UNIQUE INDEX) e também por (funcionario_id, data_hora):
      // evita re-importar batidas cujo registro original foi deletado e substituído por
      // correção manual (que fica com mobile_ref_id = NULL e não seria bloqueada pelo índice).
      const result = await query(
        `INSERT IGNORE INTO marcacoes
           (funcionario_id, data_hora, tipo, motivo_edicao, original, mobile_ref_id)
         SELECT ?, ?, ?, ?, 0, ?
         FROM DUAL
         WHERE NOT EXISTS (
           SELECT 1 FROM marcacoes WHERE funcionario_id = ? AND data_hora = ?
         )`,
        [localFuncId, dataHoraUtc, tipo, item.observacao || null, mobileRefId, localFuncId, dataHoraUtc],
      );
      if (result.affectedRows > 0) importados++;
      else ignorados++;
    } catch (e) {
      erros.push({ id: item.id, error: e.message });
    }
  }

  if (erros.length > 0) {
    console.error(`[pullMarcacoes] ${erros.length} erro(s). Primeiro:`, erros[0]);
  }

  return { importados, ignorados, bloqueados: bloqueados_count, duplicatas_bloqueadas, erros };
}

// ── Gestão de batidas bloqueadas ──────────────────────────────────────────────

export async function listarBloqueadas(empresaId, funcionarioId = null) {
  let sql = `
    SELECT
      b.id, b.funcionario_id, b.data_hora, b.tipo, b.mobile_ref_id,
      b.grupo_id, b.motivo_bloqueio, b.desbloqueado_por, b.desbloqueado_em,
      f.nome AS funcionario_nome
    FROM marcacoes_bloqueadas b
    JOIN funcionarios f ON f.id = b.funcionario_id
    WHERE b.empresa_id = ? AND b.desbloqueado_em IS NULL
  `;
  const params = [empresaId];

  if (funcionarioId) {
    sql += ' AND b.funcionario_id = ?';
    params.push(funcionarioId);
  }

  sql += ' ORDER BY b.grupo_id DESC, b.data_hora ASC';
  return query(sql, params);
}

export async function desbloquearBloqueada(id, usuarioId) {
  const [bloqueada] = await query(
    'SELECT * FROM marcacoes_bloqueadas WHERE id = ?',
    [id],
  );
  if (!bloqueada) throw new Error('Batida bloqueada não encontrada');

  // Move para marcacoes
  await query(
    `INSERT INTO marcacoes (funcionario_id, data_hora, tipo, motivo_edicao, original, mobile_ref_id)
     VALUES (?, ?, ?, ?, 0, ?)`,
    [bloqueada.funcionario_id, bloqueada.data_hora, bloqueada.tipo, null, bloqueada.mobile_ref_id],
  );

  // Marca como desbloqueada
  await query(
    'UPDATE marcacoes_bloqueadas SET desbloqueado_por = ?, desbloqueado_em = NOW() WHERE id = ?',
    [usuarioId, id],
  );

  return { bloqueada, movida: true };
}

// ── Status da configuração ───────────────────────────────────────────────────

export function isMobileConfigured() {
  return !!(BASE_URL && process.env.PONTOMOBILE_CPF && process.env.PONTOMOBILE_SENHA);
}
