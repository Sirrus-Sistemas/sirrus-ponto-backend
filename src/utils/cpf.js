/** CPF: mantém somente 11 dígitos. */
export function onlyCpfDigits(value) {
  return String(value ?? '').replace(/\D/g, '').slice(0, 11);
}

/** CPF com dígitos verificadores corretos (recusa sequências como 111.111.111-11). */
export function cpfValido(value) {
  const c = String(value ?? '').replace(/\D/g, '');
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  for (const t of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < t; i++) soma += Number(c[i]) * (t + 1 - i);
    if ((soma * 10) % 11 % 10 !== Number(c[t])) return false;
  }
  return true;
}

/**
 * Campo PIS do funcionário: aceita um PIS/PASEP/NIT válido OU o próprio CPF —
 * pela Portaria 671 o REP identifica o trabalhador pelo CPF, e a maioria dos
 * cadastros guarda o CPF aqui. Zeros à esquerda são aceitos (o relógio usa 12
 * dígitos, ex.: 014946580499).
 */
export function pisValido(value, cpf) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length < 11 || digits.length > 12) return false;
  const p = digits.replace(/^0+(?=\d{11}$)/, '');
  if (p.length !== 11) return false;
  if (cpf && p === onlyCpfDigits(cpf)) return cpfValido(p);
  if (/^(\d)\1{10}$/.test(p)) return false;
  const pesos = [3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let soma = 0;
  for (let i = 0; i < 10; i++) soma += Number(p[i]) * pesos[i];
  const dv = 11 - (soma % 11);
  return (dv >= 10 ? 0 : dv) === Number(p[10]);
}

/**
 * Chave para casar CPF/PIS vindos do relógio com o cadastro: só dígitos e sem
 * zeros à esquerda — o relógio manda o PIS com 12 dígitos ("016442933505"),
 * o cadastro pode ter 11, máscara ("0164.429.335-05") ou até o CPF no campo
 * PIS (Portaria 671). Vazio/sem dígito → ''.
 */
export function chaveDocumento(value) {
  return String(value ?? '').replace(/\D/g, '').replace(/^0+/, '');
}

/** Mesma chave de chaveDocumento, em SQL (MySQL 8), para a coluna informada. */
export function sqlChaveDocumento(coluna) {
  return `TRIM(LEADING '0' FROM REGEXP_REPLACE(COALESCE(${coluna}, ''), '[^0-9]', ''))`;
}

/** Documento que não é CPF/PIS (ex.: "A02003287047" — registro tipo 5 do AFD lido como batida). */
export function documentoInvalido(value) {
  return value != null && String(value).trim() !== '' && !/^[\d.\-\s/]+$/.test(String(value).trim());
}
