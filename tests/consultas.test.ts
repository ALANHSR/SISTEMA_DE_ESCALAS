import test from 'node:test';
import assert from 'node:assert/strict';
import { clienteAdmin, clienteUsuario, subirAmbiente } from './apoio.ts';
import type { Ambiente, Cliente } from './apoio.ts';
import { hojeSaoPaulo, somarDias } from '../src/shared/datetime.ts';

function datasEntre(ini: string, fim: string): string[] {
  const out: string[] = [];
  for (let d = ini; d <= fim; d = somarDias(d, 1)) out.push(d);
  return out;
}

async function cenario(amb: Ambiente) {
  const a = await clienteAdmin(amb);
  const mk = async (rota: string, corpo: object) => {
    const r = await a.post(rota, corpo);
    assert.equal(r.status, 201, JSON.stringify(r.json));
    return r.json.dado;
  };
  const ana = await mk('/api/profissionais', { nome_completo: 'Ana Ribeiro', uf: 'SP' });
  const jose = await mk('/api/profissionais', { nome_completo: 'José Álvares', uf: 'RJ' });
  const local = await mk('/api/locais', { nome: 'Base Central', uf: 'SP' });
  const outroLocal = await mk('/api/locais', { nome: 'Base Sul', uf: 'RS' });
  const p1 = await mk('/api/projetos', { nome: 'Projeto Alfa', codigo: 'ALFA', status: 'ativo' });
  const p2 = await mk('/api/projetos', { nome: 'Projeto Beta', codigo: 'BETA', status: 'ativo' });
  let seqHorario = 0;
  // Cria uma escala com UM horário aplicado a todos os `profissional_ids`, em todas as datas do
  // período (ou só em `apenasDatas`, quando informado) — reproduz, nos testes, o padrão único por
  // registro que o modelo antigo oferecia, agora expresso como células explícitas da grade.
  const esc = async (o: {
    titulo: string; data_inicial: string; data_final: string; profissional_ids?: number[]; apenasDatas?: string[];
    hora_inicio?: string; hora_fim?: string; vira_dia?: boolean; [k: string]: unknown;
  }) => {
    const {
      profissional_ids = [], hora_inicio = '08:00', hora_fim = '17:00', vira_dia = false,
      data_inicial, data_final, apenasDatas, ...resto
    } = o;
    const h = await mk('/api/horarios', { nome: `H${++seqHorario}`, hora_inicio, hora_fim, vira_dia });
    const datas = apenasDatas ?? datasEntre(data_inicial, data_final);
    const dias = profissional_ids.flatMap((pid) => datas.map((data) => ({ profissional_id: pid, data, horario_id: h.id })));
    return mk('/api/escalas', { data_inicial, data_final, dias, ...resto });
  };
  return { a, ana, jose, local, outroLocal, p1, p2, esc, mk, datasEntre };
}
const tl = (c: Cliente, q: string) => c.get(`/api/timeline?${q}`);

test('timeline: valida o período', async () => {
  const amb = await subirAmbiente();
  try {
    const a = await clienteAdmin(amb);
    assert.equal((await tl(a, '')).status, 422);
    assert.equal((await tl(a, 'inicio=2026-10-10&fim=2026-10-01')).status, 422);
    assert.equal((await tl(a, 'inicio=2026-01-01&fim=2027-12-31')).status, 422);
    assert.equal((await tl(a, 'inicio=2026-10-01&fim=2026-10-31')).status, 200);
  } finally { await amb.encerrar(); }
});

test('timeline: itens dos três tipos, conflito sinalizado e folga solicitada sem conflito', async () => {
  const amb = await subirAmbiente();
  try {
    const { a, ana, jose, local, p1, esc, mk } = await cenario(amb);
    // Plantão A: só a Ana, três dias (05 a 07/10) — vira três células/itens na linha do tempo.
    await esc({ titulo: 'Plantão A', data_inicial: '2026-10-05', data_final: '2026-10-07', profissional_ids: [ana.id], projeto_id: p1.id, local_ids: [local.id], status: 'confirmada' });
    // Plantão B: Ana e José, só no dia 06/10, horário que cruza com o Plantão A — conflita só na Ana.
    await esc({ titulo: 'Plantão B', data_inicial: '2026-10-06', data_final: '2026-10-06', hora_inicio: '10:00', hora_fim: '12:00', profissional_ids: [ana.id, jose.id], forcar: true });
    await mk('/api/folgas', { profissional_id: jose.id, tipo: 'ferias', data_inicial: '2026-10-20', data_final: '2026-10-25', status: 'aprovada' });
    await mk('/api/folgas', { profissional_id: ana.id, tipo: 'folga_semanal', data_inicial: '2026-10-05', data_final: '2026-10-05', status: 'solicitada' });
    await mk('/api/treinamentos', { nome: 'NR-35', data_inicial: '2026-10-21', data_final: '2026-10-21', hora_inicio: '09:00', hora_fim: '11:00', profissional_ids: [ana.id], status: 'planejado' });

    const r = (await tl(a, 'inicio=2026-10-01&fim=2026-10-31')).json;
    // 3 células de "Plantão A" + 2 de "Plantão B" (uma por profissional) + Férias + Folga semanal + NR-35.
    assert.equal(r.itens.length, 8);
    const item = (t: string, d: string) => r.itens.find((i: any) => i.titulo === t && i.data_inicial === d);
    assert.equal(item('Plantão A', '2026-10-06').conflitos.length, 1, 'só a célula do dia 06 cruza com o Plantão B');
    assert.equal(item('Plantão A', '2026-10-06').conflitos[0].com.titulo, 'Plantão B');
    assert.equal(item('Plantão A', '2026-10-05').conflitos.length, 0);
    assert.equal(item('Plantão A', '2026-10-07').conflitos.length, 0);
    const conflitosEmB = r.itens.filter((i: any) => i.titulo === 'Plantão B').reduce((s: number, i: any) => s + i.conflitos.length, 0);
    assert.equal(conflitosEmB, 1, 'só a célula da Ana em "Plantão B" conflita; a do José não');
    assert.equal(r.total_conflitos, 1);
    assert.equal(r.itens.find((i: any) => i.titulo === 'Férias').conflitos.length, 0);
    assert.equal(r.itens.find((i: any) => i.titulo === 'Folga semanal').conflitos.length, 0, 'solicitada não bloqueia nem conflita');
    assert.equal(r.itens.filter((i: any) => i.tipo === 'folga').length, 2);
    assert.deepEqual(r.profissionais.map((p: any) => p.nome_completo), ['Ana Ribeiro', 'José Álvares']);
    assert.match(r.hoje, /^\d{4}-\d{2}-\d{2}$/);
  } finally { await amb.encerrar(); }
});

test('timeline: filtros por profissional, projeto, local, tipo, status e texto (sem acento)', async () => {
  const amb = await subirAmbiente();
  try {
    const { a, ana, jose, local, outroLocal, p1, p2, esc, mk } = await cenario(amb);
    await esc({ titulo: 'Escala Alfa', data_inicial: '2026-10-05', data_final: '2026-10-05', profissional_ids: [ana.id], projeto_id: p1.id, local_ids: [local.id], status: 'confirmada' });
    await esc({ titulo: 'Escala Beta', data_inicial: '2026-10-06', data_final: '2026-10-06', profissional_ids: [jose.id], projeto_id: p2.id, local_ids: [outroLocal.id], status: 'confirmada' });
    await esc({ titulo: 'Escala Rascunho', data_inicial: '2026-10-07', data_final: '2026-10-07', profissional_ids: [jose.id] });
    await mk('/api/folgas', { profissional_id: jose.id, tipo: 'ferias', data_inicial: '2026-10-08', data_final: '2026-10-09', status: 'aprovada' });
    const base = 'inicio=2026-10-01&fim=2026-10-31';
    const titulos = async (q: string) => (await tl(a, `${base}&${q}`)).json.itens.map((i: any) => i.titulo).sort();

    assert.deepEqual(await titulos(`profissional_id=${ana.id}`), ['Escala Alfa']);
    assert.deepEqual(await titulos(`profissional_id=${ana.id},${jose.id}`), ['Escala Alfa', 'Escala Beta', 'Escala Rascunho', 'Férias']);
    assert.deepEqual(await titulos(`projeto_id=${p2.id}`), ['Escala Beta']);
    assert.deepEqual(await titulos(`local_id=${local.id}`), ['Escala Alfa']);
    assert.deepEqual(await titulos('tipo=folga'), ['Férias']);
    assert.deepEqual(await titulos('tipo=escala,folga&status=confirmada'), ['Escala Alfa', 'Escala Beta']);
    assert.deepEqual(await titulos('q=jose'), ['Escala Beta', 'Escala Rascunho', 'Férias'], 'busca ignora acentos e casa com o nome do profissional');
    assert.deepEqual(await titulos('q=ALFA'), ['Escala Alfa']);
    assert.deepEqual(await titulos('q=ferias'), ['Férias']);
    const soJose = (await tl(a, `${base}&q=beta`)).json;
    assert.deepEqual(soJose.profissionais.map((p: any) => p.nome_completo), ['José Álvares'], 'com filtro ativo, só aparecem linhas com resultados');
  } finally { await amb.encerrar(); }
});

test('timeline: cancelados ocultos por padrão e disponíveis sob demanda', async () => {
  const amb = await subirAmbiente();
  try {
    const { a, ana, esc } = await cenario(amb);
    const e = await esc({ titulo: 'Será cancelada', data_inicial: '2026-10-05', data_final: '2026-10-05', profissional_ids: [ana.id] });
    await a.post(`/api/escalas/${e.id}/status`, { status: 'cancelada' });
    const base = 'inicio=2026-10-01&fim=2026-10-31';
    assert.equal((await tl(a, base)).json.itens.length, 0);
    assert.equal((await tl(a, `${base}&cancelados=1`)).json.itens.length, 1);
    assert.equal((await tl(a, `${base}&status=cancelada`)).json.itens.length, 1);
  } finally { await amb.encerrar(); }
});

test('timeline: períodos que atravessam meses/anos e turno noturno que invade o dia seguinte', async () => {
  const amb = await subirAmbiente();
  try {
    const { a, ana, esc } = await cenario(amb);
    // A escala declara o período inteiro (20/12 a 10/01), mas só tem células em duas datas dentro dele
    // — cada data vira um item independente, visível só quando a janela consultada a contém.
    await esc({ titulo: 'Virada de ano', data_inicial: '2026-12-20', data_final: '2027-01-10', profissional_ids: [ana.id], apenasDatas: ['2026-12-31', '2027-01-05'] });
    await esc({ titulo: 'Noturna', data_inicial: '2026-10-05', data_final: '2026-10-05', hora_inicio: '22:00', hora_fim: '06:00', vira_dia: true, profissional_ids: [ana.id] });
    const titulos = async (q: string) => [...new Set((await tl(a, q)).json.itens.map((i: any) => i.titulo))];
    assert.deepEqual(await titulos('inicio=2027-01-01&fim=2027-01-05'), ['Virada de ano']);
    assert.deepEqual(await titulos('inicio=2026-12-31&fim=2026-12-31'), ['Virada de ano']);
    assert.deepEqual(await titulos('inicio=2027-01-11&fim=2027-01-31'), []);
    assert.deepEqual(await titulos('inicio=2026-10-06&fim=2026-10-06'), ['Noturna'], 'o turno começou no dia 5 e ainda ocupa a madrugada do dia 6');
    assert.deepEqual(await titulos('inicio=2026-10-07&fim=2026-10-07'), []);
  } finally { await amb.encerrar(); }
});

test('timeline: profissional inativo com histórico continua aparecendo', async () => {
  const amb = await subirAmbiente();
  try {
    const { a, ana, jose, esc } = await cenario(amb);
    await esc({ titulo: 'Histórico', data_inicial: '2026-10-05', data_final: '2026-10-05', profissional_ids: [jose.id, ana.id] });
    await a.post(`/api/profissionais/${jose.id}/status`, { status: 'inativo' });
    const r = (await tl(a, 'inicio=2026-10-01&fim=2026-10-31')).json;
    assert.deepEqual(r.profissionais.map((p: any) => `${p.nome_completo}:${p.status}`), ['Ana Ribeiro:ativo', 'José Álvares:inativo']);
    const vazio = (await tl(a, 'inicio=2027-03-01&fim=2027-03-31')).json;
    assert.deepEqual(vazio.profissionais.map((p: any) => p.nome_completo), ['Ana Ribeiro'], 'sem registros no período, inativos saem da grade');
  } finally { await amb.encerrar(); }
});

test('timeline: acessível ao usuário somente-leitura; exportação só para administrador', async () => {
  const amb = await subirAmbiente();
  try {
    const { a, ana, esc } = await cenario(amb);
    await esc({ titulo: 'Escala X', data_inicial: '2026-10-05', data_final: '2026-10-05', profissional_ids: [ana.id] });
    const u = await clienteUsuario(amb);
    assert.equal((await tl(u, 'inicio=2026-10-01&fim=2026-10-31')).json.itens.length, 1);
    assert.equal((await u.get('/api/timeline/exportar?inicio=2026-10-01&fim=2026-10-31')).status, 403);
    const csv = await a.get('/api/timeline/exportar?inicio=2026-10-01&fim=2026-10-31');
    assert.equal(csv.status, 200);
    assert.match(csv.json as string, /Ana Ribeiro;Escala;Escala X;Planejada;05\/10\/2026;05\/10\/2026;08:00;17:00/);
  } finally { await amb.encerrar(); }
});

test('dashboard: escalas de hoje, próximos 7 dias, contagens, folgas, treinamentos e conflitos', async () => {
  const amb = await subirAmbiente();
  try {
    const { a, ana, jose, mk, esc } = await cenario(amb);
    const hoje = hojeSaoPaulo();
    const d = (n: number) => somarDias(hoje, n);
    await esc({ titulo: 'Hoje 1', data_inicial: hoje, data_final: hoje, profissional_ids: [ana.id], status: 'planejada' });
    await esc({ titulo: 'Amanhã', data_inicial: d(1), data_final: d(2), profissional_ids: [jose.id], apenasDatas: [d(1), d(2)] });
    await esc({ titulo: 'Longe', data_inicial: d(20), data_final: d(20), profissional_ids: [jose.id] });
    await esc({ titulo: 'Conflita com Hoje 1', data_inicial: hoje, data_final: hoje, hora_inicio: '09:00', hora_fim: '10:00', profissional_ids: [ana.id], forcar: true });
    await mk('/api/folgas', { profissional_id: jose.id, tipo: 'ferias', data_inicial: d(3), data_final: d(4), status: 'aprovada' });
    await mk('/api/treinamentos', { nome: 'Integração', data_inicial: d(5), data_final: d(5), hora_inicio: '09:00', hora_fim: '12:00', remoto: true, status: 'confirmado', profissional_ids: [jose.id] });
    await a.post('/api/projetos', { nome: 'Projeto Ativo', codigo: 'ATV', status: 'ativo' });

    const u = await clienteUsuario(amb);
    const r = (await u.get(`/api/dashboard?inicio=${hoje}&fim=${d(30)}`)).json;
    assert.equal(r.contagens.profissionais_ativos, 2);
    assert.equal(r.contagens.projetos_ativos, 3);
    assert.equal(r.contagens.escalas_hoje, 2);
    assert.deepEqual(r.escalas_hoje.map((e: any) => e.titulo), ['Hoje 1', 'Conflita com Hoje 1']);
    assert.equal(r.proximos_dias.length, 7);
    assert.equal(r.proximos_dias[0].data, d(1));
    assert.equal(r.proximos_dias[0].total, 1);
    assert.equal(r.proximos_dias[1].total, 1);
    assert.equal(r.proximos_dias[2].total, 0);
    assert.equal(r.contagens.folgas_aprovadas_periodo, 1);
    assert.equal(r.folgas_periodo[0].profissional_nome, 'José Álvares');
    assert.equal(r.contagens.treinamentos_proximos, 1);
    assert.equal(r.contagens.conflitos, 1);
    assert.equal(r.conflitos[0].profissional_nome, 'Ana Ribeiro');
    assert.equal(r.conflitos[0].data, hoje);
    assert.equal(r.demo, false);
    const sem = await u.get('/api/dashboard?inicio=2026-10-10&fim=2026-10-01');
    assert.equal(sem.status, 422);
  } finally { await amb.encerrar(); }
});

test('opções: usuário só recebe profissionais ativos; administrador recebe todos', async () => {
  const amb = await subirAmbiente();
  try {
    const { a, jose } = await cenario(amb);
    await a.post(`/api/profissionais/${jose.id}/status`, { status: 'inativo' });
    const u = await clienteUsuario(amb);
    assert.deepEqual((await u.get('/api/opcoes')).json.profissionais.map((p: any) => p.nome), ['Ana Ribeiro']);
    const adm = (await a.get('/api/opcoes')).json;
    assert.equal(adm.profissionais.length, 2);
    assert.equal(adm.projetos.length, 2);
    assert.equal(adm.locais.length, 2);
  } finally { await amb.encerrar(); }
});

test('timeline e dashboard expõem a região dos feriados e o estado dos profissionais', async () => {
  const amb = await subirAmbiente();
  try {
    const { a, ana, jose, esc } = await cenario(amb);
    await esc({ titulo: 'Escala X', data_inicial: '2026-10-05', data_final: '2026-10-05', profissional_ids: [ana.id, jose.id] });
    await a.post('/api/periodos', { nome: 'Feriado Nacional Teste', tipo: 'feriado', data_inicial: '2026-10-12', data_final: '2026-10-12' });
    await a.post('/api/periodos', { nome: 'Feriado Paulista Teste', tipo: 'feriado', uf: 'SP', data_inicial: '2026-10-20', data_final: '2026-10-20' });
    const r = (await tl(a, 'inicio=2026-10-01&fim=2026-10-31')).json;
    assert.deepEqual(r.periodos.map((p: any) => [p.nome, p.uf]), [['Feriado Nacional Teste', null], ['Feriado Paulista Teste', 'SP']]);
    assert.deepEqual(r.profissionais.map((p: any) => [p.nome_completo, p.uf]), [['Ana Ribeiro', 'SP'], ['José Álvares', 'RJ']]);
    const hoje = hojeSaoPaulo();
    await a.post('/api/periodos', { nome: 'Feriado de Amanhã', tipo: 'feriado', uf: 'RJ', data_inicial: somarDias(hoje, 1), data_final: somarDias(hoje, 1) });
    const dash = (await a.get('/api/dashboard')).json;
    assert.ok(dash.feriados_proximos.some((f: any) => f.nome === 'Feriado de Amanhã' && f.uf === 'RJ'));
  } finally { await amb.encerrar(); }
});

test('timeline expõe cidade de profissionais e de feriados (granularidade municipal)', async () => {
  const amb = await subirAmbiente();
  try {
    const { a, ana } = await cenario(amb);
    await a.put(`/api/profissionais/${ana.id}`, { nome_completo: 'Ana Ribeiro', uf: 'PR', cidade: 'Curitiba', status: 'ativo' });
    await a.post('/api/periodos', { nome: 'Aniversário de Curitiba', tipo: 'feriado', uf: 'PR', cidade: 'Curitiba', data_inicial: '2026-10-15', data_final: '2026-10-15' });
    const r = (await tl(a, 'inicio=2026-10-01&fim=2026-10-31')).json;
    const anaResp = r.profissionais.find((p: any) => p.id === ana.id);
    assert.equal(anaResp.cidade, 'Curitiba');
    const per = r.periodos.find((p: any) => p.nome === 'Aniversário de Curitiba');
    assert.equal(per.uf, 'PR');
    assert.equal(per.cidade, 'Curitiba');
  } finally { await amb.encerrar(); }
});

test('quarto pedido de ajustes: a linha do tempo só mostra ocorrência nas datas em que a grade tem célula preenchida', async () => {
  const amb = await subirAmbiente();
  try {
    const { a, ana, esc } = await cenario(amb);
    // Escala 12x36-like: período de 13 a 19/10, mas só com células em 13, 15, 17 e 19 (a cada 2 dias) —
    // exatamente o cenário do "Alan" do pedido original, agora expresso como células explícitas.
    await esc({
      titulo: 'Plantão 12x36', data_inicial: '2026-10-13', data_final: '2026-10-19', profissional_ids: [ana.id],
      apenasDatas: ['2026-10-13', '2026-10-15', '2026-10-17', '2026-10-19'],
    });
    const r = (await tl(a, 'inicio=2026-10-13&fim=2026-10-19')).json;
    const datasComItem = r.itens.filter((i: any) => i.titulo === 'Plantão 12x36').map((i: any) => i.data_inicial).sort();
    assert.deepEqual(datasComItem, ['2026-10-13', '2026-10-15', '2026-10-17', '2026-10-19'], 'só aparece nas datas em que a grade foi preenchida');
    const semDia14 = (await tl(a, 'inicio=2026-10-14&fim=2026-10-14')).json.itens.filter((i: any) => i.titulo === 'Plantão 12x36');
    assert.equal(semDia14.length, 0, '14/10 não tem célula preenchida, então não aparece');
  } finally { await amb.encerrar(); }
});

test('feriado vincula folga automática ao profissional por localidade (ponto 3 do pedido de ajustes)', async () => {
  const amb = await subirAmbiente();
  try {
    const { a, ana, jose, esc } = await cenario(amb); // ana: SP · jose: RJ
    await a.post('/api/periodos', { nome: 'Feriado de São Paulo', tipo: 'feriado', uf: 'SP', data_inicial: '2026-10-15', data_final: '2026-10-15' });

    const r = (await tl(a, 'inicio=2026-10-01&fim=2026-10-31')).json;
    const feriadoAna = r.itens.find((i: any) => i.tipo === 'folga' && i.tipo_folga === 'feriado' && i.profissional_ids.includes(ana.id));
    assert.ok(feriadoAna, 'o feriado estadual gera um item de folga automática para quem está em SP');
    assert.equal(feriadoAna.titulo, 'Feriado: Feriado de São Paulo');
    assert.ok(!feriadoAna.profissional_ids.includes(jose.id), 'não atinge quem está em outro estado (RJ)');

    // Recesso (outro tipo) não gera folga automática — só o tipo "feriado" vincula.
    await a.post('/api/periodos', { nome: 'Recesso interno', tipo: 'recesso', uf: 'SP', data_inicial: '2026-10-16', data_final: '2026-10-16' });
    const r2 = (await tl(a, 'inicio=2026-10-01&fim=2026-10-31')).json;
    assert.ok(!r2.itens.some((i: any) => i.titulo.includes('Recesso interno')));

    // E bloqueia a criação de uma escala para o profissional atingido no dia do feriado (regra 8),
    // igual a qualquer outro conflito de agenda — a menos que seja forçada. (`esc()` exige 201, então
    // usamos `a.post` direto aqui, já que o ponto do teste é justamente receber 409.)
    const h = (await a.post('/api/horarios', { nome: 'H-Feriado', hora_inicio: '08:00', hora_fim: '17:00' })).json.dado;
    const direta = await a.post('/api/escalas', {
      titulo: 'Plantão no feriado', data_inicial: '2026-10-15', data_final: '2026-10-15',
      dias: [{ profissional_id: ana.id, data: '2026-10-15', horario_id: h.id }],
    });
    assert.equal(direta.status, 409);
    assert.match(direta.json.erro.conflitos[0].mensagem, /Feriado de São Paulo/);

    const livre = await a.post('/api/escalas', {
      titulo: 'Plantão no feriado (RJ)', data_inicial: '2026-10-15', data_final: '2026-10-15',
      dias: [{ profissional_id: jose.id, data: '2026-10-15', horario_id: h.id }],
    });
    assert.equal(livre.status, 201, 'quem não está em SP não é afetado pelo feriado estadual');
  } finally { await amb.encerrar(); }
});
