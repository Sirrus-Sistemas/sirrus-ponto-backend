/** CPF: mantém somente 11 dígitos. */
export function onlyCpfDigits(value) {
  return String(value ?? '').replace(/\D/g, '').slice(0, 11);
}
