import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { abrirBanco, executar } from '../src/server/db.ts';
import type { DB } from '../src/server/db.ts';
import { migrar } from '../src/server/migrate.ts';
import { carregarConfig } from '../src/server/config.ts';
import type { Config } from '../src/server/config.ts';
import { criarApp } from '../src/server/app.ts';
import { hashSenha } from '../src/server/auth.ts';

export const SENHA_ADMIN = 'Admin-Teste-123';
export const SENHA_USUARIO = 'Usuario-Teste-123';

export interface Ambiente {
  db: DB;
  config: Config;
  servidor: Server;
  base: string;
  encerrar(): Promise<void>;
  roteador: ReturnType<typeof criarApp>['roteador'];
}

export async function subirAmbiente(sobrescritas: Partial<Config> = {}): Promise<Ambiente> {
  const config = carregarConfig({
    caminhoBanco: ':memory:', segredoSessao: 'segredo-de-teste-com-mais-de-32-caracteres!!',
    cookieSeguro: false, producao: false, loginMaxTentativas: 5, ...sobrescritas,
  });
  const db = abrirBanco(':memory:');
  migrar(db);
  const agora = new Date().toISOString();
  executar(db, `INSERT INTO usuarios (nome, email, senha_hash, perfil, status, criado_em, atualizado_em) VALUES (?, ?, ?, 'administrador', 'ativo', ?, ?)`, 'Ana Admin', 'admin@teste.local', hashSenha(SENHA_ADMIN), agora, agora);
  executar(db, `INSERT INTO usuarios (nome, email, senha_hash, perfil, status, criado_em, atualizado_em) VALUES (?, ?, ?, 'usuario', 'ativo', ?, ?)`, 'Ugo Usuário', 'usuario@teste.local', hashSenha(SENHA_USUARIO), agora, agora);
  const { servidor, roteador } = criarApp({ db, config });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  const { port } = servidor.address() as AddressInfo;
  return {
    db, config, servidor, roteador, base: `http://127.0.0.1:${port}`,
    encerrar: () => new Promise<void>((ok) => { servidor.close(() => { db.close(); ok(); }); servidor.closeAllConnections(); }),
  };
}

/** Cliente HTTP mínimo que mantém cookie de sessão e token CSRF. */
export class Cliente {
  base: string;
  cookie = '';
  csrf = '';
  constructor(base: string) { this.base = base; }

  async req(metodo: string, caminho: string, corpo?: unknown, extra: Record<string, string> = {}): Promise<{ status: number; json: any; res: Response }> {
    const cabecalhos: Record<string, string> = { ...extra };
    if (this.cookie) cabecalhos.cookie = this.cookie;
    if (metodo !== 'GET' && this.csrf && !('x-csrf-token' in extra)) cabecalhos['x-csrf-token'] = this.csrf;
    if (corpo !== undefined) cabecalhos['content-type'] = 'application/json';
    const res = await fetch(this.base + caminho, { method: metodo, headers: cabecalhos, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    const setCookie = res.headers.getSetCookie?.()[0];
    if (setCookie) this.cookie = setCookie.split(';')[0]!;
    const texto = await res.text();
    let json: any = null;
    try { json = texto ? JSON.parse(texto) : null; } catch { json = texto; }
    return { status: res.status, json, res };
  }
  get(c: string) { return this.req('GET', c); }
  post(c: string, b: unknown = {}) { return this.req('POST', c, b); }
  put(c: string, b: unknown) { return this.req('PUT', c, b); }

  async entrar(email: string, senha: string) {
    this.cookie = ''; this.csrf = '';
    const r = await this.req('POST', '/api/auth/login', { email, senha });
    if (r.status === 200) this.csrf = r.json.csrf_token;
    return r;
  }
}

export async function clienteAdmin(amb: Ambiente): Promise<Cliente> {
  const c = new Cliente(amb.base);
  const r = await c.entrar('admin@teste.local', SENHA_ADMIN);
  if (r.status !== 200) throw new Error('login admin falhou');
  return c;
}
export async function clienteUsuario(amb: Ambiente): Promise<Cliente> {
  const c = new Cliente(amb.base);
  const r = await c.entrar('usuario@teste.local', SENHA_USUARIO);
  if (r.status !== 200) throw new Error('login usuário falhou');
  return c;
}
