import { EspelhoPontoService } from './src/services/espelhoPontoService.js';

async function testarTodos() {
  const testes = [
    { id: 121, nome: 'Mariana Alves Silva', data: '2026-06-17' },
    { id: 109, nome: 'Kalina da Silva Ferreira', data: '2026-06-17' },
    { id: 189, nome: 'Kelly Schimith Santos', data: '2026-06-17' },
    { id: 81, nome: 'Ana Luiza Frota Oliveira', data: '2026-06-01' },
  ];

  for (const teste of testes) {
    const dia = parseInt(teste.data.slice(8, 10));
    const mes = parseInt(teste.data.slice(5, 7));
    const ano = parseInt(teste.data.slice(0, 4));

    const espelho = await EspelhoPontoService.buildEspelho(teste.id, 1, ano, mes);
    const diaEspelho = espelho.dias.find(d => d.data === teste.data);

    if (diaEspelho) {
      console.log(`\n✓ ${teste.nome} (${teste.data})`);
      console.log(`  Status: ${diaEspelho.status}`);
      console.log(`  Modifiers: ${JSON.stringify(diaEspelho.modifiers)}`);
      console.log(`  Batidas: ${diaEspelho.marcacoes.length}`);
      console.log(`  → Deve ser: ${diaEspelho.modifiers.includes('incompleto') ? 'INCONSISTENTE ❌' : 'NORMAL ✅'}`);
    }
  }

  process.exit(0);
}

testarTodos().catch(console.error);
