/**
 * Script de limpeza de duplicatas em marcacoes
 *
 * Para cada grupo (funcionario_id, data_hora) com mais de um registro,
 * mantém o mais qualificado e apaga os demais:
 *
 *   Prioridade para MANTER:
 *     1. original = 0 (batida editada/lançada manualmente — tem motivo)
 *     2. Menor id (o mais antigo, portanto o primeiro a ser inserido)
 *
 * Como usar:
 *   node --env-file=.env src/migrations/limpar_duplicatas_marcacoes.js
 *
 * Adicione --confirmar para executar de fato. Sem essa flag, o script
 * apenas exibe o que faria (dry-run).
 */

import mysql from 'mysql2/promise';

const DRY_RUN = !process.argv.includes('--confirmar');

async function main() {
  const conn = await mysql.createConnection({
    host:     process.env.DB_HOST     || '127.0.0.1',
    port:     Number(process.env.DB_PORT) || 3306,
    user:     process.env.DB_USER     || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME     || 'ponto_web',
    charset:  'utf8mb4',
  });

  console.log('🔌 Conectado ao banco\n');

  if (DRY_RUN) {
    console.log('⚠️  MODO DRY-RUN — nada será apagado.');
    console.log('   Para executar de verdade: adicione --confirmar\n');
  }

  // ── 1. Busca todos os grupos duplicados ───────────────────────────────────
  const [grupos] = await conn.query(`
    SELECT
      funcionario_id,
      data_hora,
      COUNT(*)                                                      AS total,
      MIN(id)                                                       AS id_menor,
      MIN(CASE WHEN original = 0 THEN id END)                      AS id_editado,
      GROUP_CONCAT(id ORDER BY id SEPARATOR ', ')                   AS todos_ids
    FROM marcacoes
    GROUP BY funcionario_id, data_hora
    HAVING COUNT(*) > 1
    ORDER BY funcionario_id, data_hora
  `);

  if (grupos.length === 0) {
    console.log('✅ Nenhuma duplicata encontrada. Banco já está limpo.\n');
    await conn.end();
    return;
  }

  console.log(`🔍 ${grupos.length} grupo(s) de duplicata encontrado(s):\n`);
  console.log(
    '  Funcionário  | Data/Hora            | Qtd | IDs              | Manter'
  );
  console.log(
    '  -------------|----------------------|-----|------------------|-------'
  );

  const idsParaApagar = [];

  for (const g of grupos) {
    // ID a manter: editado tem prioridade, senão o mais antigo
    const idManter = g.id_editado ?? g.id_menor;

    // Todos os IDs do grupo menos o que vamos manter
    const todosIds = String(g.todos_ids).split(', ').map(Number);
    const apagar   = todosIds.filter((id) => id !== idManter);
    idsParaApagar.push(...apagar);

    const dataHora = String(g.data_hora).slice(0, 19);
    console.log(
      `  ${String(g.funcionario_id).padEnd(13)}| ${dataHora.padEnd(20)} | ${String(g.total).padEnd(3)} | ${String(g.todos_ids).padEnd(16)} | ${idManter}`
    );
  }

  console.log(`\n📋 Total de registros a apagar: ${idsParaApagar.length}`);

  if (DRY_RUN) {
    console.log('\n   (dry-run) Nada foi alterado.');
    console.log(
      '   Execute com --confirmar para apagar:\n' +
      '   node --env-file=.env src/migrations/limpar_duplicatas_marcacoes.js --confirmar\n'
    );
    await conn.end();
    return;
  }

  // ── 2. Apaga em lotes de 500 para não travar a tabela ────────────────────
  const LOTE = 500;
  let apagados = 0;

  for (let i = 0; i < idsParaApagar.length; i += LOTE) {
    const lote = idsParaApagar.slice(i, i + LOTE);
    const [res] = await conn.query(
      `DELETE FROM marcacoes WHERE id IN (${lote.map(() => '?').join(',')})`,
      lote,
    );
    apagados += res.affectedRows;
    process.stdout.write(`\r🗑️  Apagando... ${apagados}/${idsParaApagar.length}`);
  }

  console.log(`\n✅ ${apagados} registro(s) duplicado(s) removido(s).`);
  console.log('   Agora você pode rodar: npm run migrate\n');

  await conn.end();
}

main().catch((err) => {
  console.error('\n❌ Erro:', err.message);
  process.exit(1);
});
