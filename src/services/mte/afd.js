// AFD do REP-P (Portaria 671) — batidas feitas pelo aplicativo Ponto Mobile e
// pela web, que são o REP-P deste sistema. O AFD dos relógios (REP-C) é o do
// próprio equipamento; batidas lançadas manualmente não entram no AFD (estão
// no AEJ/AFDT, com origem "I").
//
// Registros: 1 (cabeçalho, com CRC-16), 7 (marcação REP-P, com hash SHA-256
// encadeado) e 9 (trailer).

import crypto from 'crypto';
import { query } from '../../config/database.js';
import { fusoHorarioToTzOffset } from '../espelhoPontoService.js';
import {
  DESENVOLVEDOR, NUMERO_REP_P, alfa, crc16, dataHora671, num, offsetCompacto, offsetMs,
} from './comum.js';

/**
 * @param {{ empresaId, filial: { id, tz }, empregador, inicio, fim, geradoEm }} p
 */
export async function gerarAFDRepP({ empresaId, filial, empregador, inicio, fim, geradoEm }) {
  // Todas as batidas do REP-P da filial desde a primeira: o NSR e o hash de
  // cada registro dependem dos anteriores, então o encadeamento é sempre
  // calculado do começo (ordem de gravação) e só o período pedido sai no arquivo.
  const rows = await query(
    `SELECT m.id, m.data_hora, m.created_at, m.mobile_ref_id,
            f.cpf, mu.fuso_horario AS fuso_funcionario
       FROM marcacoes m
       JOIN funcionarios f ON f.id = m.funcionario_id
       LEFT JOIN municipios mu ON mu.CODMUNICIPIO = f.municipio_id
      WHERE f.empresa_id = ? AND f.filial_id = ? AND m.tipo = 'online'
        AND m.data_hora < DATE_ADD(?, INTERVAL 2 DAY)
      ORDER BY m.id`,
    [empresaId, filial.id, fim],
  );

  const linhas = [];
  // Cabeçalho (tipo 1) — mesmo layout do legado, com o nº do REP-P (INPI) e o
  // CNPJ do desenvolvedor no lugar dos placeholders.
  const header = '000000000' + '1'
    + empregador.tipo
    + num(empregador.documento, 14)
    + num('', 14)                                // CNO / CAEPF (não cadastrado)
    + alfa(empregador.razao, 150)
    + NUMERO_REP_P
    + inicio + fim
    + dataHora671(geradoEm, filial.tz)
    + '003'                                      // versão do leiaute
    + DESENVOLVEDOR.tipoIdentificacao
    + num(DESENVOLVEDOR.cnpj, 14)
    + alfa('', 30);                              // modelo: só para REP-C
  linhas.push(header + crc16(header));

  let hashAnterior = '';
  let nsr = 0;
  let qtd7 = 0;
  for (const r of rows) {
    nsr += 1;
    const tz = fusoHorarioToTzOffset(r.fuso_funcionario) || filial.tz;
    const marcacao = new Date(`${String(r.data_hora instanceof Date ? r.data_hora.toISOString() : r.data_hora).replace(' ', 'T').slice(0, 19)}Z`);
    const base = num(nsr, 9) + '7'
      + dataHora671(marcacao, tz)
      + num(r.cpf, 12)
      + dataHora671(new Date(r.created_at), tz)
      + (r.mobile_ref_id ? '01' : '02')          // coletor: 01 app mobile, 02 navegador
      + '0';                                     // 0 = online
    // Hash SHA-256 do registro encadeado ao hash do registro anterior.
    const hash = crypto.createHash('sha256').update(base + hashAnterior, 'latin1').digest('hex');
    hashAnterior = hash;

    // Só sai no arquivo o que é do período (data local da marcação).
    const dataLocal = new Date(marcacao.getTime() + offsetMs(tz)).toISOString().slice(0, 10);
    if (dataLocal < inicio || dataLocal > fim) continue;
    qtd7 += 1;
    linhas.push(base + hash);
  }

  // Trailer: quantidades dos registros 2 a 7 (só o 7 é usado pelo REP-P).
  linhas.push('999999999' + num(0, 9) + num(0, 9) + num(0, 9) + num(0, 9) + num(0, 9) + num(qtd7, 9) + '9');
  return { linhas, quantidade: qtd7, offset: offsetCompacto(filial.tz) };
}
