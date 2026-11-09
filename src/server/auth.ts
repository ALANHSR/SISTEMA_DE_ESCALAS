import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { DB } from './db.ts';
import { executar, obter } from './db.ts';

export type Perfil = 'administrador' | 'usuario';
export interface UsuarioSessao { id: number; nome: string; email: string; perfil: Perfil; deveTrocarSenha: boolean }

export const NOME_COOKIE = 'escalas_sid';

const N = 16384;
const R = 8;
const P = 1;
const TAMANHO_CHAVE = 64;

export function hashSenha(senha: string): string {
  const sal = randomBytes(16);
  const hash = scryptSync(senha, sal, TAMANHO_CHAVE, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${sal.toString('base64')}$${hash.toString('base64')}`;
}

export function verificarSenha(senha: string, armazenado: string): boolean {
  const partes = armazenado.split('$');
  if (partes.length !== 6 || partes[0] !== 'scrypt') return false;
  const esperado = Buffer.from(partes[5]!, 'base64');
  const calculado = scryptSync(senha, Buffer.from(partes[4]!, 'base64'), esperado.length, {
    N: Number(partes[1]), r: Number(partes[2]), p: Number(partes[3]),
  });
  return timingSafeEqual(calculado, esperado);
}

// Usado quando o e-mail não existe, para que o tempo de resposta não revele quais e-mails são válidos.
const HASH_FALSO = hashSenha('valor-descartavel-para-equalizar-o-tempo');
export function verificarSenhaFalsa(senha: string): void {
  verificarSenha(senha, HASH_FALSO);
}

/** Política de senha: 8 a 128 caracteres, com ao menos uma letra e um número. */
export function problemaNaSenha(senha: unknown): string | null {
  if (typeof senha !== 'string') return 'Senha: informe um texto.';
  if (senha.length < 8) return 'Senha: mínimo de 8 caracteres.';
  if (senha.length > 128) return 'Senha: máximo de 128 caracteres.';
  if (!/[A-Za-z]/.test(senha) || !/\d/.test(senha)) return 'Senha: use letras e números.';
  return null;
}

const hashDoToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export function criarSessao(db: DB, usuarioId: number, ttlHoras: number): string {
  const token = randomBytes(32).toString('base64url');
  const agora = Date.now();
  executar(
    db,
    'INSERT INTO sessoes (token_hash, usuario_id, criado_em, expira_em) VALUES (?, ?, ?, ?)',
    hashDoToken(token), usuarioId, new Date(agora).toISOString(), new Date(agora + ttlHoras * 3_600_000).toISOString(),
  );
  return token;
}

export function obterSessao(db: DB, token: string): { usuario: UsuarioSessao; tokenHash: string } | null {
  const hash = hashDoToken(token);
  const l = obter(
    db,
    `SELECT u.id, u.nome, u.email, u.perfil, u.deve_trocar_senha FROM sessoes s
       JOIN usuarios u ON u.id = s.usuario_id
      WHERE s.token_hash = ? AND s.expira_em > ? AND u.status = 'ativo'`,
    hash, new Date().toISOString(),
  );
  if (!l) return null;
  return { usuario: { id: l.id, nome: l.nome, email: l.email, perfil: l.perfil, deveTrocarSenha: l.deve_trocar_senha === 1 }, tokenHash: hash };
}

export function encerrarSessao(db: DB, token: string): void {
  executar(db, 'DELETE FROM sessoes WHERE token_hash = ?', hashDoToken(token));
}

export function encerrarSessoesDoUsuario(db: DB, usuarioId: number): void {
  executar(db, 'DELETE FROM sessoes WHERE usuario_id = ?', usuarioId);
}

export function limparSessoesExpiradas(db: DB): void {
  executar(db, 'DELETE FROM sessoes WHERE expira_em <= ?', new Date().toISOString());
}

export function tokenCsrf(segredo: string, tokenHash: string): string {
  return createHmac('sha256', segredo).update(`csrf:${tokenHash}`).digest('base64url');
}

/** CSRF a partir do token bruto do cookie (usado logo após criar a sessão). */
export function csrfDoTokenBruto(segredo: string, tokenBruto: string): string {
  return tokenCsrf(segredo, hashDoToken(tokenBruto));
}

/** Limita tentativas de login por chave (e-mail + IP) numa janela de tempo. Em memória. */
export class LimitadorDeLogin {
  private falhas = new Map<string, { n: number; ate: number }>();
  private max: number;
  private janelaMs: number;
  constructor(max: number, janelaMinutos: number) {
    this.max = max;
    this.janelaMs = janelaMinutos * 60_000;
  }
  bloqueado(chave: string): boolean {
    const f = this.falhas.get(chave);
    if (!f) return false;
    if (f.ate <= Date.now()) { this.falhas.delete(chave); return false; }
    return f.n >= this.max;
  }
  registrarFalha(chave: string): void {
    const f = this.falhas.get(chave);
    if (!f || f.ate <= Date.now()) this.falhas.set(chave, { n: 1, ate: Date.now() + this.janelaMs });
    else f.n += 1;
  }
  limpar(chave: string): void {
    this.falhas.delete(chave);
  }
}
