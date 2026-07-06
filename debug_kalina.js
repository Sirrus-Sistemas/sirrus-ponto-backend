import { EspelhoPontoService } from './src/services/espelhoPontoService.js';

async function debugKalina() {
  try {
    console.log('Debugando Kalina da Silva Ferreira (ID 109) - 17/06/2026\n');

    const espelho = await EspelhoPontoService.buildEspelho(109, 1, 2026, 6);

    const dia17 = espelho.dias.find(d => d.data === '2026-06-17');

    if (dia17) {
      console.log(`Status: ${dia17.status}`);
      console.log(`Modifiers: ${JSON.stringify(dia17.modifiers)}`);
      console.log(`Trabalho em dia? ${dia17.dia_trabalho}`);
      console.log(`\nBatidas: ${dia17.marcacoes.length}`);
      dia17.marcacoes.forEach((m, idx) => {
        const d = new Date(m.data_hora);
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        console.log(`  [${idx + 1}] ${hh}:${mm} - ${m.tipo_label}`);
      });

      console.log(`\nBatidas esperadas: ${dia17.batidas_esperadas}`);
      console.log(`Minutos trabalhados: ${dia17.minutos_trabalhados}`);
      console.log(`Minutos previstos: ${dia17.minutos_previstos}`);
      console.log(`Incompleto? ${dia17.incompleto}`);

      console.log(`\n📋 Análise:`);
      if (dia17.marcacoes.length % 2 === 0) {
        console.log(`✓ Número par de batidas (${dia17.marcacoes.length})`);
      } else {
        console.log(`⚠️ Número ímpar de batidas (${dia17.marcacoes.length})`);
      }

      if (dia17.batidas_esperadas && dia17.marcacoes.length % dia17.batidas_esperadas !== 0) {
        console.log(`⚠️ Não é múltiplo de batidas esperadas (${dia17.batidas_esperadas})`);
      }

    } else {
      console.log('Dia 17/06 não encontrado');
    }

    process.exit(0);
  } catch (err) {
    console.error('Erro:', err.message);
    process.exit(1);
  }
}

debugKalina();
