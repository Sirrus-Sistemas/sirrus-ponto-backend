/**
 * Converte valor vindo do MySQL (DATETIME em UTC na sessão +00:00) para ISO 8601 com sufixo Z.
 * Evita strings "YYYY-MM-DD HH:mm:ss" sem fuso, que o JSON repassa ao front e o navegador
 * interpreta como horário local — gerando diferença de 3h (ou mais) em relação ao relógio.
 */
export function toIsoDataHoraUtc(value) {
  if (value == null) return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const m = value.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
    if (m) {
      const ms = value.match(/\.(\d{1,3})/);
      const frac = ms ? `.${ms[1].padEnd(3, '0').slice(0, 3)}` : '.000';
      return `${m[1]}T${m[2]}${frac}Z`;
    }
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d.toISOString();
  }
  try {
    return new Date(value).toISOString();
  } catch {
    return value;
  }
}
