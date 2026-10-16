// Casamento entre batidas reais e horários previstos da jornada — usado pela
// justificativa automática (preencher só o que falta). Mesma lógica em
// src/pages/FichaDePonto/batidaDataHora.ts no frontend.

const toMin = (hhmm) => {
  const [h, m] = String(hhmm).slice(0, 5).split(':').map(Number);
  return h * 60 + (m || 0);
};

/**
 * Minutos desde a meia-noite do dia de referência para uma sequência de
 * horários da jornada ("HH:MM", em ordem). Quando um horário é menor que o
 * anterior, a jornada passou da meia-noite: soma 24h dali em diante
 * (22:00, 02:00 → 1320, 1560).
 */
export function minutosDaJornada(horarios) {
  let dias = 0;
  let anterior = null;
  return horarios.map((h) => {
    const min = toMin(h);
    if (anterior !== null && min < anterior) dias += 1;
    anterior = min;
    return dias * 1440 + min;
  });
}

/**
 * Índices dos horários previstos que NÃO têm batida real correspondente.
 *
 * Cada batida real (em ordem) é casada com um previsto (em ordem), escolhendo
 * a combinação de menor distância total — então 08:00, 14:00, 18:00 contra
 * 08:00/12:00/14:00/18:00 deixa de fora o 12:00, não o 18:00. Antes a
 * justificativa pulava os N primeiros previstos (N = nº de batidas) e
 * preenchia o último: faltando o almoço, lançava um segundo 18:00.
 *
 * @param {number[]} previstos  minutos (ver minutosDaJornada), em ordem
 * @param {number[]} existentes minutos das batidas reais, em ordem
 */
export function previstosSemBatida(previstos, existentes) {
  const n = previstos.length;
  const m = existentes.length;
  if (m >= n) return [];

  // custo[i][j]: menor distância casando as j primeiras batidas com os i
  // primeiros previstos (previstos podem sobrar; batidas não).
  const INF = Number.POSITIVE_INFINITY;
  const custo = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(INF));
  custo[0][0] = 0;
  for (let i = 1; i <= n; i++) {
    custo[i][0] = 0;
    for (let j = 1; j <= Math.min(i, m); j++) {
      const sobra = custo[i - 1][j];
      const casa = custo[i - 1][j - 1] + Math.abs(previstos[i - 1] - existentes[j - 1]);
      custo[i][j] = Math.min(sobra, casa);
    }
  }

  const faltantes = [];
  let j = m;
  for (let i = n; i >= 1; i--) {
    const casa = j > 0 ? custo[i - 1][j - 1] + Math.abs(previstos[i - 1] - existentes[j - 1]) : INF;
    if (j > 0 && custo[i][j] === casa) {
      j -= 1;
    } else {
      faltantes.push(i - 1);
    }
  }
  return faltantes.reverse();
}
