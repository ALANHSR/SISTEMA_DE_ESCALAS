import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DB } from './db.ts';
import { abrirBanco, executar, listar, transacao } from './db.ts';
import { carregarConfig } from './config.ts';

const PASTA = fileURLToPath(new URL('../../migrations', import.meta.url));

/** Aplica, em ordem, as migrations SQL ainda não registradas. Retorna os nomes aplicados. */
export function migrar(db: DB, pasta: string = PASTA): string[] {
  db.exec('CREATE TABLE IF NOT EXISTS _migrations (nome TEXT PRIMARY KEY, aplicada_em TEXT NOT NULL)');
  const feitas = new Set(listar(db, 'SELECT nome FROM _migrations').map((l) => String(l.nome)));
  const arquivos = readdirSync(pasta).filter((f) => f.endsWith('.sql')).sort();
  const aplicadas: string[] = [];
  for (const arquivo of arquivos) {
    if (feitas.has(arquivo)) continue;
    const sql = readFileSync(resolve(pasta, arquivo), 'utf8');
    transacao(db, () => {
      db.exec(sql);
      executar(db, 'INSERT INTO _migrations (nome, aplicada_em) VALUES (?, ?)', arquivo, new Date().toISOString());
    });
    aplicadas.push(arquivo);
  }
  return aplicadas;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = carregarConfig();
  const db = abrirBanco(config.caminhoBanco);
  const aplicadas = migrar(db);
  console.log(aplicadas.length ? `Migrations aplicadas: ${aplicadas.join(', ')}` : 'Banco já está atualizado.');
}
