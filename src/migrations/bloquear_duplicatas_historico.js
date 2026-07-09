/**
 * Script: bloquear_duplicatas_historico.js
 *
 * Detecta e bloqueia grupos de batidas duplicadas no histórico (abril–julho 2026).
 * Grupos são: 2+ batidas do mesmo funcionário em até 60 segundos.
 *
 * Modo dry-run (padrão): exibe tabela com grupos detectados
 * Modo --confirmar: move grupos para marcacoes_bloqueadas, deleta de marcacoes
 *
 * Uso: node bloquear_duplicatas_historico.js [--confirmar]
 */

import { query } from '../config/database.js';
import { PONTO_DUPLICATA_JANELA_SEG } from '../config/constants.js';
import crypto from 'crypto';

const DRY_RUN = !process.argv.includes('--confirmar');

async function main() {
  console.log(`[${DRY_RUN ? 'DRY-RUN' : 'CONFIRMADO'}] Detectando duplicatas históricas...`);

  const marcacoes = await query(`
    SELECT
      id, funcionario_id, data_hora, tipo, mobile_ref_id
    FROM marcacoes
    WHERE mobile_ref_id IS NOT NULL
      AND data_hora BETWEEN '2026-04-01 00:00:00' AND '2026-07-31 23:59:59'
    ORDER BY funcionario_id, data_hora
  `);

  if (marcacoes.length === 0) {
    console.log('Nenhuma batida com mobile_ref_id encontrada no período.');
    return;
  }

  // Agrupa por funcionário
  const porFunc = new Map();
  for (const m of marcacoes) {
    const fId = m.funcionario_id;
    if (!porFunc.has(fId)) porFunc.set(fId, []);
    porFunc.get(fId).push(m);
  }

  // Detecta grupos de duplicatas para cada funcionário
  const grupos = [];
  for (const [funcId, batidas] of porFunc) {
    for (let i = 0; i < batidas.length; i++) {
      const b1 = batidas[i];
      const dataStr = new Date(b1.data_hora).toISOString().slice(0, 19);
      const ts1 = new Date(b1.data_hora).getTime();
      const grupo = [b1];

      for (let j = i + 1; j < batidas.length; j++) {
        const b2 = batidas[j];
        const ts2 = new Date(b2.data_hora).getTime();
        const diffSeg = Math.abs(ts2 - ts1) / 1000;

        if (diffSeg > PONTO_DUPLICATA_JANELA_SEG) break;
        grupo.push(b2);
      }

      if (grupo.length >= 2) {
        const grupoId = crypto
          .createHash('md5')
          .update(`${funcId}-${ts1}`)
          .digest('hex')
          .substring(0, 12);
        grupos.push({
          grupoId,
          funcionario_id: funcId,
          batidas: grupo,
          mês: dataStr.substring(0, 7),
          horariosStr: grupo.map((b) => new Date(b.data_hora).toISOString().slice(11, 19)).join(', '),
        });
        i += grupo.length - 1;
      }
    }
  }

  if (grupos.length === 0) {
    console.log('Nenhum grupo de duplicatas detectado.');
    return;
  }

  // Agrupa por mês para exibição
  const porMês = new Map();
  for (const g of grupos) {
    const m = g.mês;
    if (!porMês.has(m)) porMês.set(m, []);
    porMês.get(m).push(g);
  }

  // Exibe tabela
  console.log('\n═════════════════════════════════════════════════════════════════');
  console.log('GRUPOS DE DUPLICATAS DETECTADOS');
  console.log('═════════════════════════════════════════════════════════════════\n');

  for (const [mês, gruposDoMês] of [...porMês].sort()) {
    const jáFechado = mês < '2026-06';
    const aviso = jáFechado ? ' ⚠️  FOLHA JÁ FECHADA' : '';
    console.log(`${mês}${aviso}: ${gruposDoMês.length} grupo(s)`);
    for (const g of gruposDoMês) {
      console.log(`  - Grupo ${g.grupoId}: ${g.horariosStr}`);
    }
  }

  console.log(`\nTotal: ${grupos.length} grupo(s) | ${grupos.reduce((sum, g) => sum + g.batidas.length, 0)} batida(s)\n`);

  if (DRY_RUN) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('MODO DRY-RUN: Nenhuma alteração foi feita.');
    console.log('Para confirmar e bloquear, execute: node bloquear_duplicatas_historico.js --confirmar');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    return;
  }

  // Modo confirmar: bloqueia e deleta
  console.log('CONFIRMADO: Bloqueando e movendo para quarentena...\n');

  let bloqueadas = 0;
  let deletadas = 0;

  for (const g of grupos) {
    for (const b of g.batidas) {
      const motivo = `Duplicata histórica: ${g.horariosStr}`;
      try {
        // Buscar empresa_id do funcionário
        const [func] = await query('SELECT empresa_id FROM funcionarios WHERE id = ?', [b.funcionario_id]);
        const empresaId = func?.empresa_id || 1;

        await query(
          `INSERT INTO marcacoes_bloqueadas
             (empresa_id, funcionario_id, data_hora, tipo, mobile_ref_id, grupo_id, motivo_bloqueio)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [empresaId, b.funcionario_id, b.data_hora, b.tipo, b.mobile_ref_id, g.grupoId, motivo],
        );
        bloqueadas++;

        await query('DELETE FROM marcacoes WHERE id = ?', [b.id]);
        deletadas++;
      } catch (err) {
        console.error(`Erro ao processar batida ${b.id}:`, err.message);
      }
    }
  }

  console.log(`✓ ${bloqueadas} batida(s) bloqueada(s)`);
  console.log(`✓ ${deletadas} batida(s) deletada(s) de marcacoes\n`);

  console.log('Histórico de duplicatas bloqueado com sucesso!');
  console.log('Admin pode revisar via painel lateral da Ficha de Ponto.');
}

main().catch((err) => {
  console.error('Erro:', err.message);
  process.exit(1);
});
