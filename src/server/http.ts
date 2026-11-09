import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { Config } from './config.ts';
import type { DB } from './db.ts';
import type { UsuarioSessao } from './auth.ts';
import { NOME_COOKIE, obterSessao, tokenCsrf } from './auth.ts';
import { atualizarStatusAutomatico } from './autoStatus.ts';

export class HttpError extends Error {
  status: number;
  codigo: string;
  extra: Record<string, unknown>;
  constructor(status: number, codigo: string, mensagem: string, extra: Record<string, unknown> = {}) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
    this.extra = extra;
  }
}

/** Resposta com status/cabeçalhos customizados (por padrão, os handlers retornam JSON 200). */
export class Resposta {
  status: number;
  corpo: unknown;
  tipo: string;
  cabecalhos: Record<string, string>;
  constructor(status: number, corpo: unknown, tipo = 'application/json; charset=utf-8', cabecalhos: Record<string, string> = {}) {
    this.status = status;
    this.corpo = corpo;
    this.tipo = tipo;
    this.cabecalhos = cabecalhos;
  }
}

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  query: URLSearchParams;
  params: Record<string, string>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
  user: UsuarioSessao | null;
  tokenHash: string | null;
  tokenBruto: string | null;
  db: DB;
  config: Config;
  ip: string;
  cookies: string[];
}

/**
 * Níveis de acesso, verificados SEMPRE no servidor antes do handler:
 *  - publico: sem autenticação (somente login);
 *  - autenticado: qualquer usuário ativo (somente leitura, exceto rotas de "autoatendimento");
 *  - admin: somente administradores (todas as mutações e leituras administrativas).
 */
export type Acesso = 'publico' | 'autenticado' | 'admin';

export interface Rota {
  metodo: string;
  caminho: string;
  regex: RegExp;
  chaves: string[];
  acesso: Acesso;
  autoatendimento: boolean;
  handler: (ctx: Ctx) => unknown | Promise<unknown>;
}

export class Roteador {
  rotas: Rota[] = [];

  adicionar(
    metodo: string,
    caminho: string,
    acesso: Acesso,
    handler: Rota['handler'],
    opcoes: { autoatendimento?: boolean } = {},
  ): void {
    const autoatendimento = opcoes.autoatendimento ?? false;
    // Garantia estrutural: nenhuma mutação pode ser aberta a usuários somente-leitura por engano.
    if (metodo !== 'GET' && acesso === 'autenticado' && !autoatendimento) {
      throw new Error(`Rota ${metodo} ${caminho}: mutações exigem acesso 'admin' (ou autoatendimento explícito).`);
    }
    const chaves: string[] = [];
    const padrao = caminho.replace(/:([a-z_]+)/gi, (_m, nome: string) => {
      chaves.push(nome);
      return nome === 'id' ? '(\\d+)' : '([^/]+)';
    });
    this.rotas.push({ metodo, caminho, regex: new RegExp(`^${padrao}$`), chaves, acesso, autoatendimento, handler });
  }
  get(c: string, a: Acesso, h: Rota['handler']): void { this.adicionar('GET', c, a, h); }
  post(c: string, a: Acesso, h: Rota['handler'], o?: { autoatendimento?: boolean }): void { this.adicionar('POST', c, a, h, o); }
  put(c: string, a: Acesso, h: Rota['handler']): void { this.adicionar('PUT', c, a, h); }

  procurar(metodo: string, caminho: string): { rota: Rota; params: Record<string, string> } | 'metodo' | null {
    let caminhoExiste = false;
    for (const rota of this.rotas) {
      const m = rota.regex.exec(caminho);
      if (!m) continue;
      caminhoExiste = true;
      if (rota.metodo !== metodo) continue;
      const params: Record<string, string> = {};
      rota.chaves.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]!); });
      return { rota, params };
    }
    return caminhoExiste ? 'metodo' : null;
  }
}

const CABECALHOS_SEGURANCA: Record<string, string> = {
  'Content-Security-Policy':
    // style-src precisa de 'unsafe-inline': a linha do tempo (Gantt) posiciona barras dinamicamente
    // via atributo style="..." calculado em JavaScript (left/width em %, grid-row/grid-column).
    // Isso não abre brecha de XSS: CSS puro não executa código; script-src continua restrito a 'self'.
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
};

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function lerCookies(cabecalho: string | undefined): Record<string, string> {
  const saida: Record<string, string> = {};
  for (const par of (cabecalho ?? '').split(';')) {
    const i = par.indexOf('=');
    if (i > 0) saida[par.slice(0, i).trim()] = decodeURIComponent(par.slice(i + 1).trim());
  }
  return saida;
}

async function lerCorpo(req: IncomingMessage, limite = 1_000_000): Promise<unknown> {
  const partes: Buffer[] = [];
  let total = 0;
  for await (const parte of req) {
    total += (parte as Buffer).length;
    if (total > limite) throw new HttpError(413, 'corpo_grande', 'Requisição grande demais.');
    partes.push(parte as Buffer);
  }
  if (total === 0) return {};
  if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'tipo_invalido', 'Envie o corpo como application/json.');
  }
  try {
    return JSON.parse(Buffer.concat(partes).toString('utf8'));
  } catch {
    throw new HttpError(400, 'json_invalido', 'Corpo da requisição inválido.');
  }
}

function enviar(res: ServerResponse, r: Resposta, cookies: string[], extra: Record<string, string> = {}): void {
  const corpo = r.tipo.startsWith('application/json') ? JSON.stringify(r.corpo) : (r.corpo as string | Buffer);
  const cabecalhos: Record<string, string | string[]> = {
    ...CABECALHOS_SEGURANCA, ...extra, ...r.cabecalhos, 'Content-Type': r.tipo,
  };
  if (cookies.length) cabecalhos['Set-Cookie'] = cookies;
  res.writeHead(r.status, cabecalhos);
  res.end(corpo);
}

export function erroJson(e: HttpError): Resposta {
  return new Resposta(e.status, { erro: { codigo: e.codigo, mensagem: e.message, ...e.extra } });
}

async function servirEstatico(req: IncomingMessage, res: ServerResponse, caminho: string, pasta: string): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    enviar(res, new Resposta(405, 'Método não permitido', 'text/plain; charset=utf-8'), []);
    return;
  }
  const base = resolve(pasta);
  let alvo = resolve(join(base, normalize(decodeURIComponent(caminho))));
  if (alvo !== base && !alvo.startsWith(base + sep)) {
    enviar(res, new Resposta(403, 'Acesso negado', 'text/plain; charset=utf-8'), []);
    return;
  }
  try {
    if ((await stat(alvo)).isDirectory()) alvo = join(alvo, 'index.html');
    await stat(alvo);
  } catch {
    // Rotas do aplicativo usam hash (#/...), então qualquer caminho sem extensão cai no index.
    if (extname(caminho)) {
      enviar(res, new Resposta(404, 'Não encontrado', 'text/plain; charset=utf-8'), []);
      return;
    }
    alvo = join(base, 'index.html');
  }
  const conteudo = await readFile(alvo);
  enviar(res, new Resposta(200, req.method === 'HEAD' ? '' : conteudo, MIME[extname(alvo)] ?? 'application/octet-stream'), [], {
    'Cache-Control': 'no-cache',
  });
}

export function criarManipulador(o: { roteador: Roteador; db: DB; config: Config }) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const metodo = (req.method ?? 'GET').toUpperCase();

    if (!url.pathname.startsWith('/api/')) {
      try {
        await servirEstatico(req, res, url.pathname, o.config.diretorioPublico);
      } catch {
        enviar(res, new Resposta(400, 'Requisição inválida', 'text/plain; charset=utf-8'), []);
      }
      return;
    }

    const cookiesResposta: string[] = [];
    const semCache = { 'Cache-Control': 'no-store' };
    try {
      // Pontos 2 e 4 do segundo pedido de ajustes: projeto/escala vencidos mudam de situação
      // sozinhos. Roda aqui (throttled internamente) por não haver um cron neste ambiente.
      atualizarStatusAutomatico(o.db);
      const achado = o.roteador.procurar(metodo, url.pathname);
      if (achado === null) throw new HttpError(404, 'nao_encontrado', 'Recurso não encontrado.');
      if (achado === 'metodo') throw new HttpError(405, 'metodo_nao_permitido', 'Método não permitido.');
      const { rota, params } = achado;

      const mutacao = metodo !== 'GET' && metodo !== 'HEAD';
      if (mutacao) {
        // Defesa em profundidade contra CSRF: a origem, quando informada, precisa ser a do próprio servidor.
        const origem = req.headers.origin;
        if (origem && new URL(origem).host !== req.headers.host) {
          throw new HttpError(403, 'origem_invalida', 'Origem da requisição não permitida.');
        }
      }

      const cookies = lerCookies(req.headers.cookie);
      const tokenBruto = cookies[NOME_COOKIE] ?? null;
      const sessao = tokenBruto ? obterSessao(o.db, tokenBruto) : null;

      if (rota.acesso !== 'publico') {
        if (!sessao) throw new HttpError(401, 'nao_autenticado', 'Sua sessão expirou. Entre novamente.');
        // Com senha pendente de troca, nada além de /api/auth/* é liberado — mesmo para admins.
        // Verificado aqui, no servidor, e não apenas escondendo telas no cliente.
        if (sessao.usuario.deveTrocarSenha && !url.pathname.startsWith('/api/auth/')) {
          throw new HttpError(403, 'deve_trocar_senha', 'É necessário definir uma nova senha antes de continuar.');
        }
        if (rota.acesso === 'admin' && sessao.usuario.perfil !== 'administrador') {
          throw new HttpError(403, 'sem_permissao', 'Você não tem permissão para realizar esta ação.');
        }
        if (mutacao && req.headers['x-csrf-token'] !== tokenCsrf(o.config.segredoSessao, sessao.tokenHash)) {
          throw new HttpError(403, 'csrf_invalido', 'Token de segurança inválido. Recarregue a página.');
        }
      }

      const ctx: Ctx = {
        req, res, url, query: url.searchParams, params,
        body: mutacao ? await lerCorpo(req) : {},
        user: sessao?.usuario ?? null,
        tokenHash: sessao?.tokenHash ?? null,
        tokenBruto,
        db: o.db, config: o.config,
        ip: req.socket.remoteAddress ?? 'desconhecido',
        cookies: cookiesResposta,
      };

      const resultado = await rota.handler(ctx);
      const resposta = resultado instanceof Resposta ? resultado : new Resposta(200, resultado ?? {});
      enviar(res, resposta, cookiesResposta, semCache);
    } catch (erro) {
      if (erro instanceof HttpError) {
        enviar(res, erroJson(erro), cookiesResposta, semCache);
      } else {
        console.error('[erro interno]', erro);
        enviar(res, new Resposta(500, { erro: { codigo: 'erro_interno', mensagem: 'Ocorreu um erro inesperado. Tente novamente.' } }), cookiesResposta, semCache);
      }
    }
  };
}
