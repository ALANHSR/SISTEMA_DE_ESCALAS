import test from 'node:test';
import assert from 'node:assert/strict';
import { Cliente, SENHA_ADMIN, SENHA_USUARIO, clienteAdmin, clienteUsuario, subirAmbiente } from './apoio.ts';
import { hashSenha, problemaNaSenha, verificarSenha } from '../src/server/auth.ts';
import { fileURLToPath } from 'node:url';

test('senha: hash scrypt verifica corretamente e não guarda texto claro', () => {
  const h = hashSenha('Segredo-123');
  assert.match(h, /^scrypt\$/);
  assert.ok(!h.includes('Segredo-123'));
  assert.equal(verificarSenha('Segredo-123', h), true);
  assert.equal(verificarSenha('outra-senha1', h), false);
});

test('política de senha exige tamanho, letra e número', () => {
  assert.ok(problemaNaSenha('curta1'));
  assert.ok(problemaNaSenha('somenteletras'));
  assert.ok(problemaNaSenha('12345678'));
  assert.equal(problemaNaSenha('Valida-123'), null);
});

test('login: sucesso define cookie HttpOnly e redireciona conforme o perfil', async () => {
  const amb = await subirAmbiente();
  try {
    const c = new Cliente(amb.base);
    const r = await c.entrar('admin@teste.local', SENHA_ADMIN);
    assert.equal(r.status, 200);
    assert.equal(r.json.redirecionar, '#/dashboard');
    assert.match(r.res.headers.get('set-cookie') ?? '', /HttpOnly/);
    assert.match(r.res.headers.get('set-cookie') ?? '', /SameSite=Lax/);
    const u = new Cliente(amb.base);
    const ru = await u.entrar('usuario@teste.local', SENHA_USUARIO);
    assert.equal(ru.json.redirecionar, '#/linha-do-tempo');
    assert.equal(ru.json.usuario.perfil, 'usuario');
  } finally { await amb.encerrar(); }
});

test('login: erro é genérico e não distingue e-mail inexistente de senha errada', async () => {
  const amb = await subirAmbiente();
  try {
    const c = new Cliente(amb.base);
    const a = await c.entrar('admin@teste.local', 'senha-errada-1');
    const b = await c.entrar('naoexiste@teste.local', 'senha-errada-1');
    assert.equal(a.status, 401);
    assert.equal(b.status, 401);
    assert.deepEqual(a.json, b.json);
    assert.ok(!JSON.stringify(a.json).includes('hash'));
  } finally { await amb.encerrar(); }
});

test('login: bloqueia após tentativas excessivas', async () => {
  const amb = await subirAmbiente({ loginMaxTentativas: 3 });
  try {
    const c = new Cliente(amb.base);
    for (let i = 0; i < 3; i++) assert.equal((await c.entrar('admin@teste.local', 'errada-123')).status, 401);
    const bloqueado = await c.entrar('admin@teste.local', SENHA_ADMIN);
    assert.equal(bloqueado.status, 429);
  } finally { await amb.encerrar(); }
});

test('usuário inativo não consegue entrar nem manter sessão', async () => {
  const amb = await subirAmbiente();
  try {
    const c = await clienteUsuario(amb);
    assert.equal((await c.get('/api/auth/me')).status, 200);
    amb.db.exec("UPDATE usuarios SET status = 'inativo' WHERE email = 'usuario@teste.local'");
    assert.equal((await c.get('/api/auth/me')).status, 401);
    assert.equal((await new Cliente(amb.base).entrar('usuario@teste.local', SENHA_USUARIO)).status, 401);
  } finally { await amb.encerrar(); }
});

test('rotas protegidas exigem sessão e mutações exigem token CSRF', async () => {
  const amb = await subirAmbiente();
  try {
    assert.equal((await new Cliente(amb.base).get('/api/auth/me')).status, 401);
    const c = await clienteAdmin(amb);
    const semCsrf = await c.req('POST', '/api/auth/senha', { senha_atual: SENHA_ADMIN, senha_nova: 'Nova-Senha-456' }, { 'x-csrf-token': 'invalido' });
    assert.equal(semCsrf.status, 403);
    assert.equal(semCsrf.json.erro.codigo, 'csrf_invalido');
    const origemErrada = await c.req('POST', '/api/auth/logout', {}, { origin: 'http://malicioso.example' });
    assert.equal(origemErrada.status, 403);
  } finally { await amb.encerrar(); }
});

test('logout invalida a sessão no servidor', async () => {
  const amb = await subirAmbiente();
  try {
    const c = await clienteAdmin(amb);
    const cookieAntigo = c.cookie;
    assert.equal((await c.post('/api/auth/logout')).status, 200);
    const reuso = new Cliente(amb.base);
    reuso.cookie = cookieAntigo;
    assert.equal((await reuso.get('/api/auth/me')).status, 401);
  } finally { await amb.encerrar(); }
});

test('troca de senha valida a senha atual, aplica a política e encerra outras sessões', async () => {
  const amb = await subirAmbiente();
  try {
    const c = await clienteAdmin(amb);
    const outra = await clienteAdmin(amb);
    assert.equal((await c.post('/api/auth/senha', { senha_atual: 'errada-123', senha_nova: 'Nova-Senha-456' })).status, 422);
    assert.equal((await c.post('/api/auth/senha', { senha_atual: SENHA_ADMIN, senha_nova: 'fraca' })).status, 422);
    const ok = await c.post('/api/auth/senha', { senha_atual: SENHA_ADMIN, senha_nova: 'Nova-Senha-456' });
    assert.equal(ok.status, 200);
    assert.equal((await outra.get('/api/auth/me')).status, 401);
    assert.equal((await new Cliente(amb.base).entrar('admin@teste.local', 'Nova-Senha-456')).status, 200);
  } finally { await amb.encerrar(); }
});

test('senha pendente de troca: bloqueia tudo exceto /api/auth/*, até a pessoa trocar a senha', async () => {
  const amb = await subirAmbiente();
  try {
    amb.db.exec("UPDATE usuarios SET deve_trocar_senha = 1 WHERE email = 'admin@teste.local'");
    const c = new Cliente(amb.base);
    const login = await c.entrar('admin@teste.local', SENHA_ADMIN);
    assert.equal(login.status, 200);
    assert.equal(login.json.usuario.deveTrocarSenha, true);

    // /api/auth/* continua liberado (precisa para trocar a senha e para saber quem está logado).
    assert.equal((await c.get('/api/auth/me')).status, 200);
    assert.equal((await c.get('/api/auth/me')).json.usuario.deveTrocarSenha, true);

    // Qualquer outra rota é bloqueada no servidor, mesmo para administrador.
    const bloqueada = await c.get('/api/profissionais');
    assert.equal(bloqueada.status, 403);
    assert.equal(bloqueada.json.erro.codigo, 'deve_trocar_senha');
    assert.equal((await c.post('/api/profissionais', { nome_completo: 'X', uf: 'SP' })).status, 403);

    // Trocar a senha encerra a exigência.
    const troca = await c.post('/api/auth/senha', { senha_atual: SENHA_ADMIN, senha_nova: 'Nova-Senha-789' });
    assert.equal(troca.status, 200);
    assert.equal((await c.get('/api/profissionais')).status, 200, 'liberado após trocar a senha');
    const relogar = await new Cliente(amb.base).entrar('admin@teste.local', 'Nova-Senha-789');
    assert.equal(relogar.json.usuario.deveTrocarSenha, false);
  } finally { await amb.encerrar(); }
});

test('estáticos: cabeçalhos de segurança e proteção contra path traversal', async () => {
  const amb = await subirAmbiente({ diretorioPublico: fileURLToPath(new URL('../public', import.meta.url)) });
  try {
    const r = await fetch(amb.base + '/');
    assert.match(r.headers.get('content-security-policy') ?? '', /default-src 'none'/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    const t = await fetch(amb.base + '/..%2f..%2fpackage.json');
    assert.ok([403, 404].includes(t.status));
  } finally { await amb.encerrar(); }
});
