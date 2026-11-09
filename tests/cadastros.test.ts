import test from 'node:test';
import assert from 'node:assert/strict';
import { Cliente, clienteAdmin, clienteUsuario, subirAmbiente } from './apoio.ts';
import { _resetarThrottleParaTeste } from '../src/server/autoStatus.ts';

const prof = (extra: object = {}) => ({ nome_completo: 'Maria Souza', uf: 'SP', telefone: '11912345678', email: 'Maria@Exemplo.com', cargo: 'Técnica', ...extra });

test('profissionais: criar, consultar, editar e normalizar telefone/e-mail', async () => {
  const amb = await subirAmbiente();
  try {
    const a = await clienteAdmin(amb);
    const c = await a.post('/api/profissionais', prof());
    assert.equal(c.status, 201);
    assert.equal(c.json.dado.telefone, '(11) 91234-5678');
    assert.equal(c.json.dado.email, 'maria@exemplo.com');
    assert.equal(c.json.dado.status, 'ativo');
    assert.equal(c.json.dado.criado_por_nome, 'Ana Admin');
    const id = c.json.dado.id;
    const e = await a.put(`/api/profissionais/${id}`, prof({ cargo: 'Coordenadora' }));
    assert.equal(e.status, 200);
    assert.equal(e.json.dado.cargo, 'Coordenadora');
    const hist = e.json.dado.historico.map((h: any) => h.acao);
    assert.deepEqual(hist, ['atualizou', 'criou']);
    assert.deepEqual(e.json.dado.historico[0].detalhes.campos.cargo, { de: 'Técnica', para: 'Coordenadora' });
  } finally { await amb.encerrar(); }
});

test('validação no servidor devolve mensagens específicas por campo', async () => {
  const amb = await subirAmbiente();
  try {
    const a = await clienteAdmin(amb);
    const r = await a.post('/api/profissionais', { nome_completo: 'A', uf: 'XX', telefone: '123', email: 'invalido' });
    assert.equal(r.status, 422);
    const campos = r.json.erro.campos;
    assert.match(campos.nome_completo, /mínimo de 3/);
    assert.match(campos.uf, /estado válido/);
    assert.match(campos.telefone, /DDD/);
    assert.match(campos.email, /e-mail válido/);
    const vazio = await a.post('/api/profissionais', {});
    assert.match(vazio.json.erro.campos.nome_completo, /obrigatório/);
  } finally { await amb.encerrar(); }
});

test('mass assignment: campos fora do esquema são ignorados', async () => {
  const amb = await subirAmbiente();
  try {
    const a = await clienteAdmin(amb);
    const r = await a.post('/api/profissionais', prof({ id: 999, criado_por: 999, criado_em: '2000-01-01T00:00:00Z' }));
    assert.equal(r.status, 201);
    assert.notEqual(r.json.dado.id, 999);
    assert.notEqual(r.json.dado.criado_em, '2000-01-01T00:00:00Z');
  } finally { await amb.encerrar(); }
});

test('perfil usuário: cadastros são de uso exclusivo do administrador (leitura e mutação bloqueadas)', async () => {
  const amb = await subirAmbiente();
  try {
    const a = await clienteAdmin(amb);
    const p = await a.post('/api/profissionais', prof());
    const u = await clienteUsuario(amb);
    assert.equal((await u.get('/api/profissionais')).status, 403, 'usuário comum não lista cadastros');
    assert.equal((await u.get(`/api/profissionais/${p.json.dado.id}`)).status, 403, 'nem vê o detalhe de um cadastro');
    assert.equal((await u.post('/api/profissionais', prof())).status, 403);
    assert.equal((await u.put(`/api/profissionais/${p.json.dado.id}`, prof())).status, 403);
    assert.equal((await u.post(`/api/profissionais/${p.json.dado.id}/status`, { status: 'inativo' })).status, 403);
    assert.equal((await u.get('/api/profissionais/exportar')).status, 403);
    assert.equal((await u.get('/api/usuarios')).status, 403);
    assert.equal((await u.post('/api/usuarios', {})).status, 403);
    // nada mudou
    assert.equal((await a.get(`/api/profissionais/${p.json.dado.id}`)).json.dado.status, 'ativo');
  } finally { await amb.encerrar(); }
});

test('estrutura: toda rota de mutação é admin (exceto login/logout/senha)', async () => {
  const amb = await subirAmbiente();
  try {
    const excecoes = new Set(['/api/auth/login', '/api/auth/logout', '/api/auth/senha']);
    const mutacoes = amb.roteador.rotas.filter((r) => r.metodo !== 'GET' && !excecoes.has(r.caminho));
    assert.ok(mutacoes.length >= 15, 'esperava várias rotas de mutação');
    for (const r of mutacoes) assert.equal(r.acesso, 'admin', `${r.metodo} ${r.caminho} deveria ser admin`);
    // Chamada real de cada mutação como usuário comum: sempre 403, mesmo com corpo inválido.
    const u = await clienteUsuario(amb);
    for (const r of mutacoes) {
      const caminho = r.caminho.replace(':id', '1');
      const resp = await u.req(r.metodo, caminho, {});
      assert.equal(resp.status, 403, `${r.metodo} ${caminho}`);
    }
  } finally { await amb.encerrar(); }
});

test('usuário somente-leitura não acessa nenhum cadastro (profissionais, locais, projetos, horários, feriados)', async () => {
  const amb = await subirAmbiente();
  try {
    const a = await clienteAdmin(amb);
    const ativo = await a.post('/api/profissionais', prof({ nome_completo: 'Pessoa Ativa' }));
    const inativo = await a.post('/api/profissionais', prof({ nome_completo: 'Pessoa Inativa', status: 'inativo' }));
    const u = await clienteUsuario(amb);
    for (const rota of ['/api/profissionais', '/api/locais', '/api/projetos', '/api/horarios', '/api/periodos']) {
      assert.equal((await u.get(rota)).status, 403, rota);
    }
    assert.equal((await u.get(`/api/profissionais/${ativo.json.dado.id}`)).status, 403);
    // administrador continua vendo ativos e inativos normalmente
    assert.equal((await a.get('/api/profissionais')).json.total, 2);
    assert.equal((await a.get(`/api/profissionais/${inativo.json.dado.id}`)).status, 200);
  } finally { await amb.encerrar(); }
});

test('inativação preserva o registro (sem exclusão física) e registra histórico', async () => {
  const amb = await subirAmbiente();
  try {
    const a = await clienteAdmin(amb);
    const id = (await a.post('/api/profissionais', prof())).json.dado.id;
    const r = await a.post(`/api/profissionais/${id}/status`, { status: 'inativo' });
    assert.equal(r.status, 200);
    assert.equal(r.json.dado.status, 'inativo');
    assert.equal(r.json.dado.historico[0].acao, 'alterou_status');
    assert.equal((await a.req('DELETE', `/api/profissionais/${id}`)).status, 405);
    assert.equal((await a.post(`/api/profissionais/${id}/status`, { status: 'apagado' })).status, 422);
  } finally { await amb.encerrar(); }
});

test('listagem: busca, filtro, ordenação e paginação', async () => {
  const amb = await subirAmbiente();
  try {
    const a = await clienteAdmin(amb);
    for (const [n, uf] of [['Carla Dias', 'SP'], ['Bruno Lima', 'RJ'], ['Amanda Reis', 'SP'], ['Diego 100%', 'MG']]) {
      await a.post('/api/profissionais', prof({ nome_completo: n, uf }));
    }
    assert.deepEqual((await a.get('/api/profissionais')).json.dados.map((p: any) => p.nome_completo), ['Amanda Reis', 'Bruno Lima', 'Carla Dias', 'Diego 100%']);
    assert.equal((await a.get('/api/profissionais?uf=SP')).json.total, 2);
    assert.equal((await a.get('/api/profissionais?q=bruno')).json.total, 1);
    assert.equal((await a.get('/api/profissionais?q=100%25')).json.total, 1, 'curinga % deve ser tratado como texto');
    assert.equal((await a.get('/api/profissionais?q=%25')).json.total, 1);
    const pag = await a.get('/api/profissionais?porPagina=2&pagina=2&ordenar=nome_completo&dir=desc');
    assert.deepEqual(pag.json.dados.map((p: any) => p.nome_completo), ['Bruno Lima', 'Amanda Reis']);
    assert.equal(pag.json.total, 4);
    const injecao = await a.get("/api/profissionais?ordenar=nome_completo;DROP TABLE profissionais");
    assert.equal(injecao.status, 200);
    assert.equal((await a.get('/api/profissionais')).json.total, 4);
  } finally { await amb.encerrar(); }
});

test('projetos: código único, locais associados e regra de datas (regra 9)', async () => {
  const amb = await subirAmbiente();
  try {
    const a = await clienteAdmin(amb);
    const l = (await a.post('/api/locais', { nome: 'Base Norte', cidade: 'São Paulo', uf: 'SP' })).json.dado;
    const p = await a.post('/api/projetos', { nome: 'Obra Alfa', codigo: 'alfa-01', data_inicial: '2026-11-20', data_final: '2027-01-10', local_ids: [l.id] });
    assert.equal(p.status, 201);
    assert.equal(p.json.dado.codigo, 'ALFA-01');
    assert.deepEqual(p.json.dado.locais.map((x: any) => x.nome), ['Base Norte']);
    const dup = await a.post('/api/projetos', { nome: 'Outro', codigo: 'ALFA-01' });
    assert.equal(dup.status, 422);
    assert.match(dup.json.erro.campos.codigo, /já existe/);
    const datas = await a.post('/api/projetos', { nome: 'Datas', codigo: 'D-1', data_inicial: '2026-12-10', data_final: '2026-12-01' });
    assert.match(datas.json.erro.campos.data_final, /anterior/);
    const datasInvalidas = await a.post('/api/projetos', { nome: 'Projeto X', codigo: 'X-1', data_inicial: '2026-02-30' });
    assert.match(datasInvalidas.json.erro.campos.data_inicial, /data válida/);
    const lInativo = (await a.post('/api/locais', { nome: 'Desativado', status: 'inativo' })).json.dado;
    const novo = await a.post('/api/projetos', { nome: 'Projeto Y', codigo: 'Y-1', local_ids: [lInativo.id] });
    assert.match(novo.json.erro.campos.local_ids, /inativo/);
  } finally { await amb.encerrar(); }
});

test('ponto 2 do segundo pedido: projeto "ativo" com data final vencida conclui sozinho', async () => {
  const amb = await subirAmbiente();
  try {
    const a = await clienteAdmin(amb);
    const p1 = (await a.post('/api/projetos', { nome: 'Vencido', codigo: 'V-1', data_inicial: '2020-01-01', data_final: '2020-02-01' })).json.dado;
    await a.post(`/api/projetos/${p1.id}/status`, { status: 'ativo' });
    const p2 = (await a.post('/api/projetos', { nome: 'Em dia', codigo: 'V-2', data_inicial: '2020-01-01', data_final: '2099-02-01' })).json.dado;
    await a.post(`/api/projetos/${p2.id}/status`, { status: 'ativo' });
    _resetarThrottleParaTeste();
    await a.get('/api/opcoes'); // qualquer requisição autenticada dispara a verificação
    assert.equal((await a.get(`/api/projetos/${p1.id}`)).json.dado.status, 'concluido', 'data final no passado: conclui automaticamente');
    assert.equal((await a.get(`/api/projetos/${p2.id}`)).json.dado.status, 'ativo', 'data final no futuro: continua ativo');
  } finally { await amb.encerrar(); }
});

test('horários: virada de dia (regra 10), horas previstas calculadas e intervalo', async () => {
  const amb = await subirAmbiente();
  try {
    const a = await clienteAdmin(amb);
    const dia = await a.post('/api/horarios', { nome: 'Comercial', hora_inicio: '08:00', hora_fim: '17:00', intervalo_minutos: 60 });
    assert.equal(dia.status, 201);
    assert.equal(dia.json.dado.horas_previstas, 8);
    const noite = await a.post('/api/horarios', { nome: 'Noturno', hora_inicio: '22:00', hora_fim: '06:00', vira_dia: true });
    assert.equal(noite.status, 201);
    assert.equal(noite.json.dado.horas_previstas, 8);
    const semMarca = await a.post('/api/horarios', { nome: 'Errado', hora_inicio: '22:00', hora_fim: '06:00' });
    assert.equal(semMarca.status, 422);
    assert.match(semMarca.json.erro.campos.hora_fim, /virada de dia/);
    const marcaSobra = await a.post('/api/horarios', { nome: 'Errado2', hora_inicio: '08:00', hora_fim: '17:00', vira_dia: true });
    assert.equal(marcaSobra.status, 422);
    const igual = await a.post('/api/horarios', { nome: 'Igual', hora_inicio: '08:00', hora_fim: '08:00' });
    assert.match(igual.json.erro.campos.hora_fim, /igual/);
    const hora = await a.post('/api/horarios', { nome: 'Horário H', hora_inicio: '25:00', hora_fim: '08:00' });
    assert.match(hora.json.erro.campos.hora_inicio, /HH:MM/);
    const intervalo = await a.post('/api/horarios', { nome: 'Horário I', hora_inicio: '08:00', hora_fim: '09:00', intervalo_minutos: 90 });
    assert.match(intervalo.json.erro.campos.intervalo_minutos, /menor que a duração/);
  } finally { await amb.encerrar(); }
});

test('usuários: senha nunca é retornada; e-mail único; não pode remover o último administrador', async () => {
  const amb = await subirAmbiente();
  try {
    const a = await clienteAdmin(amb);
    const novo = await a.post('/api/usuarios', { nome: 'Nova Pessoa', email: 'nova@teste.local', senha: 'Senha-Forte-1', perfil: 'usuario' });
    assert.equal(novo.status, 201);
    assert.ok(!('senha_hash' in novo.json.dado) && !('senha' in novo.json.dado));
    assert.ok(!JSON.stringify((await a.get('/api/usuarios')).json).includes('scrypt'));
    const logou = await new Cliente(amb.base).entrar('nova@teste.local', 'Senha-Forte-1');
    assert.equal(logou.status, 200);
    assert.equal((await a.post('/api/usuarios', { nome: 'Dup', email: 'NOVA@teste.local', senha: 'Senha-Forte-1', perfil: 'usuario' })).status, 422);
    assert.match((await a.post('/api/usuarios', { nome: 'Sem', email: 'sem@teste.local', perfil: 'usuario' })).json.erro.campos.senha, /obrigatório/);
    assert.match((await a.post('/api/usuarios', { nome: 'Fraca', email: 'fraca@teste.local', senha: 'abc', perfil: 'usuario' })).json.erro.campos.senha, /8 caracteres/);
    const eu = (await a.get('/api/usuarios?q=admin@teste.local')).json.dados[0];
    const rebaixar = await a.put(`/api/usuarios/${eu.id}`, { nome: eu.nome, email: eu.email, perfil: 'usuario', status: 'ativo' });
    assert.equal(rebaixar.status, 422);
    // inativar usuário derruba a sessão dele
    const alvo = new Cliente(amb.base);
    await alvo.entrar('nova@teste.local', 'Senha-Forte-1');
    const id = novo.json.dado.id;
    assert.equal((await a.post(`/api/usuarios/${id}/status`, { status: 'inativo' })).status, 200);
    assert.equal((await alvo.get('/api/auth/me')).status, 401);
  } finally { await amb.encerrar(); }
});

test('exportação CSV: BOM, separador ; e neutralização de fórmulas', async () => {
  const amb = await subirAmbiente();
  try {
    const a = await clienteAdmin(amb);
    await a.post('/api/profissionais', prof({ nome_completo: '=HYPERLINK("http://x")', cargo: 'Cargo; com "aspas"' }));
    const r = await a.req('GET', '/api/profissionais/exportar');
    assert.equal(r.status, 200);
    assert.match(r.res.headers.get('content-type') ?? '', /text\/csv/);
    assert.match(r.res.headers.get('content-disposition') ?? '', /profissionais\.csv/);
    // fetch().text() descarta o BOM ao decodificar; conferimos os bytes reais enviados pelo servidor.
    const bruto = new Uint8Array(await (await fetch(amb.base + '/api/profissionais/exportar', { headers: { cookie: a.cookie } })).arrayBuffer());
    assert.deepEqual(Array.from(bruto.slice(0, 3)), [0xef, 0xbb, 0xbf], 'CSV deve começar com BOM UTF-8 (Excel)');
    const texto = r.json as string;
    assert.ok(texto.startsWith('Nome completo;Cargo ou função'));
    assert.ok(texto.includes(`"'=HYPERLINK(""http://x"")"`) || texto.includes(`'=HYPERLINK`));
    assert.ok(texto.includes('"Cargo; com ""aspas"""'));
  } finally { await amb.encerrar(); }
});

test('feriados por região: nacional (sem UF) e estadual, com validação e filtro por UF', async () => {
  const amb = await subirAmbiente();
  try {
    const a = await clienteAdmin(amb);
    const nacional = await a.post('/api/periodos', { nome: 'Natal', tipo: 'feriado', data_inicial: '2026-12-25', data_final: '2026-12-25' });
    assert.equal(nacional.status, 201);
    assert.equal(nacional.json.dado.uf, null, 'sem UF = nacional');
    const sp = await a.post('/api/periodos', { nome: 'Revolução Constitucionalista', tipo: 'feriado', uf: 'sp', data_inicial: '2026-07-09', data_final: '2026-07-09' });
    assert.equal(sp.status, 201);
    assert.equal(sp.json.dado.uf, 'SP', 'UF é normalizada para maiúsculas');
    const invalida = await a.post('/api/periodos', { nome: 'X', tipo: 'feriado', uf: 'XX', data_inicial: '2026-07-09', data_final: '2026-07-09' });
    assert.equal(invalida.status, 422);
    assert.match(invalida.json.erro.campos.uf, /estado válido/);
    const soSp = await a.get('/api/periodos?uf=SP');
    assert.deepEqual(soSp.json.dados.map((p: any) => p.nome), ['Revolução Constitucionalista']);
    assert.equal((await a.get('/api/periodos')).json.total, 2);
  } finally { await amb.encerrar(); }
});

test('feriados municipais: cidade exige UF; nacional/estadual/municipal coexistem', async () => {
  const amb = await subirAmbiente();
  try {
    const a = await clienteAdmin(amb);
    const semUf = await a.post('/api/periodos', { nome: 'Feriado sem UF', tipo: 'feriado', cidade: 'Curitiba', data_inicial: '2026-01-01', data_final: '2026-01-01' });
    assert.equal(semUf.status, 422);
    assert.match(semUf.json.erro.campos.cidade, /estado selecionado/);
    const municipal = await a.post('/api/periodos', { nome: 'Aniversário de Curitiba', tipo: 'feriado', uf: 'PR', cidade: 'Curitiba', data_inicial: '2026-03-29', data_final: '2026-03-29' });
    assert.equal(municipal.status, 201);
    assert.equal(municipal.json.dado.uf, 'PR');
    assert.equal(municipal.json.dado.cidade, 'Curitiba');
  } finally { await amb.encerrar(); }
});

test('profissionais podem informar cidade, usada junto com a UF', async () => {
  const amb = await subirAmbiente();
  try {
    const a = await clienteAdmin(amb);
    const p = await a.post('/api/profissionais', { nome_completo: 'Teste Cidade', uf: 'PR', cidade: 'Curitiba' });
    assert.equal(p.status, 201);
    assert.equal(p.json.dado.cidade, 'Curitiba');
  } finally { await amb.encerrar(); }
});

test('administrador pode exigir troca de senha de um usuário ao criar ou editar', async () => {
  const amb = await subirAmbiente();
  try {
    const a = await clienteAdmin(amb);
    const novo = await a.post('/api/usuarios', { nome: 'Pessoa Nova', email: 'nova2@teste.local', senha: 'Senha-Forte-1', perfil: 'usuario', deve_trocar_senha: true });
    assert.equal(novo.status, 201);
    assert.equal(novo.json.dado.deve_trocar_senha, true);
    const normal = await a.post('/api/usuarios', { nome: 'Outra Pessoa', email: 'outra2@teste.local', senha: 'Senha-Forte-1', perfil: 'usuario' });
    assert.equal(normal.json.dado.deve_trocar_senha, false, 'padrão é não exigir');
  } finally { await amb.encerrar(); }
});
