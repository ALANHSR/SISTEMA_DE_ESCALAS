import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type DB = DatabaseSync;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Linha = Record<string, any>;

export function abrirBanco(caminho: string): DB {
  if (caminho !== ':memory:') mkdirSync(dirname(caminho), { recursive: true });
  const db = new DatabaseSync(caminho);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  return db;
}

function normalizar(params: unknown[]): never[] {
  return params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p)) as never[];
}

export function executar(db: DB, sql: string, ...params: unknown[]): { alteracoes: number; id: number } {
  const r = db.prepare(sql).run(...normalizar(params));
  return { alteracoes: Number(r.changes), id: Number(r.lastInsertRowid) };
}

export function obter<T extends Linha = Linha>(db: DB, sql: string, ...params: unknown[]): T | undefined {
  return db.prepare(sql).get(...normalizar(params)) as T | undefined;
}

export function listar<T extends Linha = Linha>(db: DB, sql: string, ...params: unknown[]): T[] {
  return db.prepare(sql).all(...normalizar(params)) as T[];
}

/** Executa `fn` em uma transação. Qualquer exceção desfaz todas as alterações. */
export function transacao<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const resultado = fn();
    db.exec('COMMIT');
    return resultado;
  } catch (erro) {
    db.exec('ROLLBACK');
    throw erro;
  }
}

/** Placeholders "?, ?, ?" para cláusulas IN. */
export function marcadores(n: number): string {
  return Array.from({ length: n }, () => '?').join(', ');
}
