import { query } from '../config/database.js';

export async function auditar({ acao, tabela, registro_id, dados_anteriores, dados_novos, usuario_id, empresa_id, ip }) {
  try {
    await query(
      `INSERT INTO audit_log
         (usuario_id, empresa_id, acao, tabela, registro_id, dados_anteriores, dados_novos, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        usuario_id ?? null,
        empresa_id ?? null,
        acao,
        tabela,
        registro_id,
        dados_anteriores != null ? JSON.stringify(dados_anteriores) : null,
        dados_novos      != null ? JSON.stringify(dados_novos)      : null,
        ip ?? null,
      ],
    );
  } catch (err) {
    // Audit failure must never abort the main operation
    console.error('[audit] falha ao registrar:', err.message);
  }
}
