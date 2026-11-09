import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { Config } from './config.ts';
import type { DB } from './db.ts';
import { Roteador, criarManipulador } from './http.ts';
import { registrarAuth } from './routes/auth.ts';
import { registrarCadastros } from './routes/cadastros.ts';
import { registrarAgenda } from './routes/agenda.ts';
import { registrarConsultas } from './routes/consultas.ts';
import { registrarImportacao } from './routes/importacao.ts';
import { registrarHoras } from './routes/horas.ts';

export function criarApp(o: { db: DB; config: Config }): { servidor: Server; roteador: Roteador } {
  const roteador = new Roteador();
  registrarAuth(roteador);
  registrarCadastros(roteador);
  registrarAgenda(roteador);
  registrarConsultas(roteador);
  registrarImportacao(roteador);
  registrarHoras(roteador);
  const servidor = createServer(criarManipulador({ roteador, db: o.db, config: o.config }));
  return { servidor, roteador };
}
