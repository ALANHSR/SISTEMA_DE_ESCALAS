import type { DB, Linha } from './db.ts';
import { executar, listar } from './db.ts';
import type { UsuarioSessao } from './auth.ts';

export function registrarAuditoria(
  db: DB,
  a: { entidade: string; registroId: number | null; acao: string; usuario: UsuarioSessao | null; detalhes?: unknown },
): void {
  executar(
    db,
    `INSERT INTO auditoria (entidade, registro_id, acao, usuario_id, usuario_nome, detalhes, criado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    a.entidade, a.registroId, a.acao, a.usuario?.id ?? null, a.usuario?.nome ?? null,
    a.detalhes === undefined ? null : JSON.stringify(a.detalhes), new Date().toISOString(),
  );
}

function comparavel(v: unknown): string {
  if (Array.isArray(v)) return JSON.stringify([...v].sort());
  return JSON.stringify(v ?? null);
}

/** Campos que mudaram entre dois registros: { campo: { de, para } }. */
export function diferencas(
  antes: Linha | null,
  depois: Linha,
  campos: string[],
): Record<string, { de: unknown; para: unknown }> {
  const saida: Record<string, { de: unknown; para: unknown }> = {};
  for (const c of campos) {
    if (comparavel(antes?.[c]) !== comparavel(depois[c])) saida[c] = { de: antes?.[c] ?? null, para: depois[c] ?? null };
  }
  return saida;
}

export function historico(db: DB, entidade: string, registroId: number, limite = 50): Linha[] {
  return listar(
    db,
    `SELECT id, acao, usuario_nome, detalhes, criado_em FROM auditoria
      WHERE entidade = ? AND registro_id = ? ORDER BY id DESC LIMIT ?`,
    entidade, registroId, limite,
  ).map((l) => ({ ...l, detalhes: l.detalhes ? JSON.parse(String(l.detalhes)) : null }));
}
