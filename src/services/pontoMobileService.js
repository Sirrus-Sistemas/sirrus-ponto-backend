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

// ── Importar Marcações ───────────────────────────────────────────────────────

export async function pullMarcacoes(filialId, dataInicio, dataFim, lotacaoId = null) {
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

  // Auto-sincroniza funcionários da filial (e lotação, se filtrada) que ainda não têm pontomobile_id
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

  // Mapa mobileFuncionarioId → { id, fusoHorario } (filtra apenas funcionários da filial)
  const mobileIds = [...new Set(items.map((i) => Number(i.funcionario_id)).filter(Boolean))];
  const funcMap = new Map();
  if (mobileIds.length) {
    const placeholders = mobileIds.map(() => '?').join(',');
    const funcs = await query(
      `SELECT f.id, f.pontomobile_id, m.fuso_horario
         FROM funcionarios f
         LEFT JOIN municipios m ON m.CODMUNICIPIO = f.municipio_id
        WHERE f.filial_id = ?${lotacaoId ? ' AND f.lotacao_id = ?' : ''} AND f.pontomobile_id IN (${placeholders})`,
      lotacaoId ? [filialId, lotacaoId, ...mobileIds] : [filialId, ...mobileIds],
    );
    for (const f of funcs) funcMap.set(Number(f.pontomobile_id), { id: f.id, fusoHorario: f.fuso_horario });
  }

  let importados = 0;
  let ignorados = 0;
  const erros = [];

  for (const item of items) {
    try {
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

      const result = await query(
        `INSERT IGNORE INTO marcacoes
           (funcionario_id, data_hora, tipo, motivo_edicao, original, mobile_ref_id)
         VALUES (?, ?, ?, ?, 0, ?)`,
        [localFuncId, dataHoraUtc, tipo, item.observacao || null, mobileRefId],
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

  return { importados, ignorados, erros };
}

// ── Status da configuração ───────────────────────────────────────────────────

export function isMobileConfigured() {
  return !!(BASE_URL && process.env.PONTOMOBILE_CPF && process.env.PONTOMOBILE_SENHA);
}
