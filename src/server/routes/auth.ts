import type { Roteador } from '../http.ts';
import { HttpError } from '../http.ts';
import {
  LimitadorDeLogin, NOME_COOKIE, criarSessao, csrfDoTokenBruto, encerrarSessao, encerrarSessoesDoUsuario, hashSenha,
  limparSessoesExpiradas, problemaNaSenha, tokenCsrf, verificarSenha, verificarSenhaFalsa,
} from '../auth.ts';
import { executar, obter } from '../db.ts';
import { registrarAuditoria } from '../auditoria.ts';

function cookieDeSessao(token: string, maxAgeSeg: number, seguro: boolean): string {
  return `${NOME_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeg}${seguro ? '; Secure' : ''}`;
}

export function registrarAuth(roteador: Roteador): void {
  let limitador: LimitadorDeLogin | null = null;

  roteador.post('/api/auth/login', 'publico', (ctx) => {
    limitador ??= new LimitadorDeLogin(ctx.config.loginMaxTentativas, ctx.config.loginJanelaMinutos);
    const email = typeof ctx.body?.email === 'string' ? ctx.body.email.trim().toLowerCase() : '';
    const senha = typeof ctx.body?.senha === 'string' ? ctx.body.senha : '';
    if (!email || !senha) throw new HttpError(422, 'validacao', 'Informe e-mail e senha.', { campos: { ...(!email && { email: 'E-mail: campo obrigatório.' }), ...(!senha && { senha: 'Senha: campo obrigatório.' }) } });

    const chave = `${ctx.ip}|${email}`;
    if (limitador.bloqueado(chave)) {
      throw new HttpError(429, 'muitas_tentativas', 'Muitas tentativas de acesso. Aguarde alguns minutos e tente novamente.');
    }

    const u = obter(ctx.db, 'SELECT * FROM usuarios WHERE email = ?', email);
    let ok = false;
    if (u) ok = verificarSenha(senha, String(u.senha_hash)) && u.status === 'ativo';
    else verificarSenhaFalsa(senha);

    if (!u || !ok) {
      limitador.registrarFalha(chave);
      // Mensagem única: não revela se o e-mail existe, se a conta está inativa ou se a senha errou.
      throw new HttpError(401, 'credenciais_invalidas', 'E-mail ou senha incorretos.');
    }

    limitador.limpar(chave);
    limparSessoesExpiradas(ctx.db);
    const token = criarSessao(ctx.db, u.id, ctx.config.sessaoTtlHoras);
    executar(ctx.db, 'UPDATE usuarios SET ultimo_acesso = ? WHERE id = ?', new Date().toISOString(), u.id);
    const usuario = { id: u.id, nome: u.nome, email: u.email, perfil: u.perfil, deveTrocarSenha: u.deve_trocar_senha === 1 };
    registrarAuditoria(ctx.db, { entidade: 'usuarios', registroId: u.id, acao: 'login', usuario });
    ctx.cookies.push(cookieDeSessao(token, ctx.config.sessaoTtlHoras * 3600, ctx.config.cookieSeguro));

    return { usuario, csrf_token: csrfDoTokenBruto(ctx.config.segredoSessao, token), redirecionar: u.perfil === 'administrador' ? '#/dashboard' : '#/linha-do-tempo' };
  });

  roteador.get('/api/auth/me', 'autenticado', (ctx) => ({
    usuario: ctx.user,
    csrf_token: tokenCsrf(ctx.config.segredoSessao, ctx.tokenHash!),
  }));

  roteador.post('/api/auth/logout', 'autenticado', (ctx) => {
    if (ctx.tokenBruto) encerrarSessao(ctx.db, ctx.tokenBruto);
    ctx.cookies.push(cookieDeSessao('', 0, ctx.config.cookieSeguro));
    return { ok: true };
  }, { autoatendimento: true });

  roteador.post('/api/auth/senha', 'autenticado', (ctx) => {
    const atual = typeof ctx.body?.senha_atual === 'string' ? ctx.body.senha_atual : '';
    const nova = ctx.body?.senha_nova;
    const u = obter(ctx.db, 'SELECT * FROM usuarios WHERE id = ?', ctx.user!.id)!;
    if (!verificarSenha(atual, String(u.senha_hash))) {
      throw new HttpError(422, 'validacao', 'Corrija os campos destacados.', { campos: { senha_atual: 'Senha atual: incorreta.' } });
    }
    const problema = problemaNaSenha(nova);
    if (problema) throw new HttpError(422, 'validacao', 'Corrija os campos destacados.', { campos: { senha_nova: problema } });
    // Trocar a própria senha também encerra a exigência de troca (ex.: após o primeiro acesso
    // com uma senha inicial compartilhada).
    executar(ctx.db, 'UPDATE usuarios SET senha_hash = ?, deve_trocar_senha = 0, atualizado_em = ?, atualizado_por = ? WHERE id = ?',
      hashSenha(nova as string), new Date().toISOString(), ctx.user!.id, ctx.user!.id);
    // Encerra as demais sessões e mantém a atual.
    encerrarSessoesDoUsuario(ctx.db, ctx.user!.id);
    const token = criarSessao(ctx.db, ctx.user!.id, ctx.config.sessaoTtlHoras);
    ctx.cookies.push(cookieDeSessao(token, ctx.config.sessaoTtlHoras * 3600, ctx.config.cookieSeguro));
    registrarAuditoria(ctx.db, { entidade: 'usuarios', registroId: ctx.user!.id, acao: 'alterou_senha', usuario: ctx.user });
    return { ok: true, csrf_token: csrfDoTokenBruto(ctx.config.segredoSessao, token) };
  }, { autoatendimento: true });
}
