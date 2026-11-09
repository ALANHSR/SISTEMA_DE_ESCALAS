import test from 'node:test';
import assert from 'node:assert/strict';
import { clienteAdmin, clienteUsuario, subirAmbiente } from './apoio.ts';
import type { Ambiente, Cliente } from './apoio.ts';
import { _resetarThrottleParaTeste } from '../src/server/autoStatus.ts';

async function base(amb: Ambiente) {
  const a = await clienteAdmin(amb);
  const mk = async (rota: string, corpo: object) => {
    const r = await a.post(rota, corpo);
    assert.equal(r.status, 201, JSON.stringify(r.json));
    return r.json.dado;
  };
  const ana = await mk('/api/profissionais', { nome_completo: 'Ana Ribeiro', uf: 'SP' });
  const bia = await mk('/api/profissionais', { nome_completo: 'Bia Campos', uf: 'RJ' });
  const local = await mk('/api/locais', { nome: 'Base Central', uf: 'SP' });
  const projeto = await mk('/api/projetos', { nome: 'Projeto Alfa', codigo: 'ALFA', status: 'ativo', local_ids: [local.id] });
  const remoto = await mk('/api/projetos', { nome: 'Projeto Remoto', codigo: 'REM', status: 'ativo', remoto: true });
  // Dois modelos de horário cadastrados, usados nas células da grade (quarto pedido de ajustes).
  const diurno = await mk('/api/horarios', { nome: 'D1', hora_inicio: '08:00', hora_fim: '17:00' });
  const noturno = await mk('/api/horarios', { nome: 'Noturno', hora_inicio: '22:00', hora_fim: '06:00', vira_dia: true });
  return { a, ana, bia, local, projeto, remoto, diurno, noturno };
}

/** Uma escala sem grade preenchida (rascunho válido): só título e período são obrigatórios. */
const escalaBase = (o: object = {}) => ({ titulo: 'Plantão', data_inicial: '2026-10-05', data_final: '2026-10-05', ...o });

/** Monta o array `dias` (grade profissional×data×horário) a partir de uma lista de [profissional_id, data]. */
const grade = (horarioId: number, celulas: [number, string][]) =>
  celulas.map(([profissional_id, data]) => ({ profissional_id, data, horario_id: horarioId }));

const total = (amb: Ambiente, tabela: string) => Number((amb.db.prepare(`SELECT COUNT(*) AS n FROM ${tabela}`).get() as any).n);

test('escala em rascunho não exige projeto/grade/local; confirmar exige (regras 3 e 4)', async () => {
  const amb = await subirAmbiente();
  try {
    const { a, ana, local, projeto, remoto, diurno } = await base(amb);
    const rascunho = await a.post('/api/escalas', escalaBase());
    assert.equal(rascunho.status, 201);
    const id = rascunho.json.dado.id;
    const c1 = await a.post(`/api/escalas/${id}/status`, { status: 'confirmada' });
    assert.equal(c1.status, 422);
    assert.match(c1.json.erro.campos.projeto_id, /antes de confirmar/);
    assert.match(c1.json.erro.campos.dias, /ao menos um dia/);
    assert.match(c1.json.erro.campos.local_ids, /local/i);

    const semLocal = await a.post('/api/escalas', escalaBase({
      status: 'confirmada', projeto_id: projeto.id, dias: grade(diurno.id, [[ana.id, '2026-10-05']]),
    }));
    assert.equal(semLocal.status, 422);
    assert.ok(semLocal.json.erro.campos.local_ids);
    assert.equal(semLocal.json.erro.campos.projeto_id, undefined);

    const comLocal = await a.post('/api/escalas', escalaBase({
      status: 'confirmada', projeto_id: projeto.id, local_ids: [local.id], data_inicial: '2026-11-02', data_final: '2026-11-02',
      dias: grade(diurno.id, [[ana.id, '2026-11-02']]),
    }));
    assert.equal(comLocal.status, 201, JSON.stringify(comLocal.json));

    const remotoOk = await a.post('/api/escalas', escalaBase({
      status: 'confirmada', projeto_id: remoto.id, data_inicial: '2026-11-03', data_final: '2026-11-03',
      dias: grade(diurno.id, [[ana.id, '2026-11-03']]),
    }));
    assert.equal(remotoOk.status, 201, 'projeto remoto dispensa o local');
  } finally { await amb.encerrar(); }
});

test('datas da escala: regra 9 (período) e limite máximo de dias', async () => {
  const amb = await subirAmbiente();
  try {
    const { a } = await base(amb);
    const datas = await a.post('/api/escalas', escalaBase({ data_inicial: '2026-10-10', data_final: '2026-10-09' }));
    assert.match(datas.json.erro.campos.data_final, /anterior à data inicial/);
    const longo = await a.post('/api/escalas', escalaBase({ data_inicial: '2026-01-01', data_final: '2027-06-01' }));
    assert.match(longo.json.erro.campos.data_final, /no máximo 366/);
  } finally { await amb.encerrar(); }
});

test('grade de dias: valida data fora do período, horário inativo e célula duplicada', async () => {
  const amb = await subirAmbiente();
  try {
    const { a, ana, diurno } = await base(amb);
    const foraDoPeriodo = await a.post('/api/escalas', escalaBase({ dias: grade(diurno.id, [[ana.id, '2026-10-06']]) }));
    assert.match(foraDoPeriodo.json.erro.campos.dias, /fora do período informado/);

    const inativo = (await a.post('/api/horarios', { nome: 'Vai inativar', hora_inicio: '08:00', hora_fim: '12:00' })).json.dado;
    await a.post(`/api/horarios/${inativo.id}/status`, { status: 'inativo' });
    const comInativo = await a.post('/api/escalas', escalaBase({ dias: grade(inativo.id, [[ana.id, '2026-10-05']]) }));
    assert.match(comInativo.json.erro.campos.dias, /inativos e não aceitam novos vínculos/);

    const duplicado = await a.post('/api/escalas', escalaBase({
      dias: [{ profissional_id: ana.id, data: '2026-10-05', horario_id: diurno.id }, { profissional_id: ana.id, data: '2026-10-05', horario_id: diurno.id }],
    }));
    assert.match(duplicado.json.erro.campos.dias, /já existe um horário definido/);
  } finally { await amb.encerrar(); }
});

test('conflito escala × escala: 409 lista os registros; nada é salvo; forcar salva e audita', async () => {
  const amb = await subirAmbiente();
  try {
    const { a, ana, bia, local, projeto, diurno } = await base(amb);
    const corpo = (o: object) => escalaBase({ status: 'confirmada', projeto_id: projeto.id, local_ids: [local.id], ...o });
    const primeira = await a.post('/api/escalas', corpo({ titulo: 'Plantão Norte', dias: grade(diurno.id, [[ana.id, '2026-10-05']]) }));
    assert.equal(primeira.status, 201, JSON.stringify(primeira.json));

    const vespertino = (await a.post('/api/horarios', { nome: 'Vespertino', hora_inicio: '16:00', hora_fim: '20:00' })).json.dado;
    const antes = total(amb, 'escalas');
    const bloqueada = await a.post('/api/escalas', corpo({
      titulo: 'Plantão Sul', dias: [...grade(vespertino.id, [[ana.id, '2026-10-05']]), ...grade(diurno.id, [[bia.id, '2026-10-05']])],
    }));
    assert.equal(bloqueada.status, 409);
    assert.equal(bloqueada.json.erro.codigo, 'conflito');
    assert.equal(bloqueada.json.erro.pode_forcar, true);
    assert.equal(bloqueada.json.erro.conflitos.length, 1);
    const c = bloqueada.json.erro.conflitos[0];
    assert.equal(c.profissional_nome, 'Ana Ribeiro');
    assert.equal(c.com.titulo, 'Plantão Norte');
    assert.match(c.mensagem, /Ana Ribeiro: sobreposição com Escala "Plantão Norte" \(05\/10\/2026, 08:00–17:00\)/);
    assert.equal(total(amb, 'escalas'), antes, 'a transação deve ter sido desfeita');
    assert.equal(total(amb, 'escala_dias'), 1, 'só a célula da primeira escala existe');

    const forcada = await a.post('/api/escalas', corpo({
      titulo: 'Plantão Sul', dias: [...grade(vespertino.id, [[ana.id, '2026-10-05']]), ...grade(diurno.id, [[bia.id, '2026-10-05']])], forcar: true,
    }));
    assert.equal(forcada.status, 201);
    assert.equal(forcada.json.dado.conflitos.length, 1, 'o detalhe passa a sinalizar o conflito (só a célula da Ana conflita)');
    assert.equal(forcada.json.dado.conflitos[0].com.titulo, 'Plantão Norte');
    assert.ok(forcada.json.dado.historico.some((h: any) => h.acao === 'conflito_forcado'));
    const outra = await a.get(`/api/escalas/${primeira.json.dado.id}`);
    assert.equal(outra.json.dado.conflitos[0].com.titulo, 'Plantão Sul', 'ambos os lados enxergam o conflito');
  } finally { await amb.encerrar(); }
});

test('escala aceita mais de um local associado (ponto 1 do pedido de ajustes)', async () => {
  const amb = await subirAmbiente();
  try {
    const { a, ana, projeto, diurno } = await base(amb);
    const local2 = (await a.post('/api/locais', { nome: 'Base Norte', uf: 'SP' })).json.dado;
    const local3 = (await a.post('/api/locais', { nome: 'Base Leste', uf: 'SP' })).json.dado;

    const criada = await a.post('/api/escalas', escalaBase({
      status: 'confirmada', projeto_id: projeto.id, local_ids: [local2.id, local3.id], dias: grade(diurno.id, [[ana.id, '2026-10-05']]),
    }));
    assert.equal(criada.status, 201, JSON.stringify(criada.json));
    assert.deepEqual([...criada.json.dado.local_ids].sort((x: number, y: number) => x - y), [local2.id, local3.id].sort((x, y) => x - y));
    assert.equal(criada.json.dado.locais.length, 2);
    assert.deepEqual(criada.json.dado.locais.map((l: any) => l.nome).sort(), ['Base Leste', 'Base Norte']);

    const detalhe = await a.get(`/api/escalas/${criada.json.dado.id}`);
    assert.equal(detalhe.json.dado.locais.length, 2);

    const lista = await a.get('/api/escalas');
    const linha = lista.json.dados.find((l: any) => l.id === criada.json.dado.id);
    assert.match(linha.locais_nomes, /Base Leste/);
    assert.match(linha.locais_nomes, /Base Norte/);
  } finally { await amb.encerrar(); }
});

test('uma escala pode ter vários profissionais com dias e horários diferentes na mesma grade (quarto pedido de ajustes)', async () => {
  const amb = await subirAmbiente();
  try {
    const { a, ana, bia, diurno, noturno } = await base(amb);
    const terceiro = (await a.post('/api/profissionais', { nome_completo: 'Caio Nunes', uf: 'SP' })).json.dado;
    // Ana: diurno, segunda a sexta. Bia: noturno, só terça e quinta. Caio: diurno, só quarta.
    // Tudo dentro de UMA ÚNICA escala (a confusão que o pedido original queria resolver).
    const r = await a.post('/api/escalas', escalaBase({
      titulo: 'Grade mista', data_inicial: '2026-10-05', data_final: '2026-10-09',
      dias: [
        ...grade(diurno.id, [[ana.id, '2026-10-05'], [ana.id, '2026-10-06'], [ana.id, '2026-10-07'], [ana.id, '2026-10-08'], [ana.id, '2026-10-09']]),
        ...grade(noturno.id, [[bia.id, '2026-10-06'], [bia.id, '2026-10-08']]),
        ...grade(diurno.id, [[terceiro.id, '2026-10-07']]),
      ],
    }));
    assert.equal(r.status, 201, JSON.stringify(r.json));
    const detalhe = await a.get(`/api/escalas/${r.json.dado.id}`);
    assert.equal(detalhe.json.dado.dias.length, 8, '5 + 2 + 1 células');
    const profissionaisNaGrade = new Set(detalhe.json.dado.profissionais.map((p: any) => p.nome));
    assert.deepEqual(profissionaisNaGrade, new Set(['Ana Ribeiro', 'Bia Campos', 'Caio Nunes']));
    const celulaDaBia = detalhe.json.dado.dias.find((d: any) => d.profissional_id === bia.id && d.data === '2026-10-06');
    assert.equal(celulaDaBia.horario_nome, 'Noturno');
  } finally { await amb.encerrar(); }
});

test('editar uma escala não conflita consigo mesma; mover uma célula para horário livre resolve', async () => {
  const amb = await subirAmbiente();
  try {
    const { a, ana, diurno } = await base(amb);
    const vespertino = (await a.post('/api/horarios', { nome: 'Vespertino', hora_inicio: '18:00', hora_fim: '22:00' })).json.dado;
    const e1 = (await a.post('/api/escalas', escalaBase({ titulo: 'Escala 1', dias: grade(diurno.id, [[ana.id, '2026-10-05']]) }))).json.dado;
    await a.post('/api/escalas', escalaBase({ titulo: 'Escala 2', dias: grade(vespertino.id, [[ana.id, '2026-10-05']]) }));
    const mesmoDia = await a.put(`/api/escalas/${e1.id}`, { ...e1, descricao: 'ajuste', dias: e1.dias.map((d: any) => ({ profissional_id: d.profissional_id, data: d.data, horario_id: d.horario_id })) });
    assert.equal(mesmoDia.status, 200, JSON.stringify(mesmoDia.json));

    const sobreposto = (await a.post('/api/horarios', { nome: 'Invade', hora_inicio: '17:30', hora_fim: '19:00' })).json.dado;
    const invade = await a.put(`/api/escalas/${e1.id}`, { ...e1, dias: grade(sobreposto.id, [[ana.id, '2026-10-05']]) });
    assert.equal(invade.status, 409);
    assert.equal(invade.json.erro.conflitos[0].com.titulo, 'Escala 2');

    const livre = (await a.post('/api/horarios', { nome: 'Manhã cedo', hora_inicio: '06:00', hora_fim: '10:00' })).json.dado;
    const resolvida = await a.put(`/api/escalas/${e1.id}`, { ...e1, dias: grade(livre.id, [[ana.id, '2026-10-05']]) });
    assert.equal(resolvida.status, 200);
  } finally { await amb.encerrar(); }
});

test('conflito por virada de dia é detectado entre dias consecutivos', async () => {
  const amb = await subirAmbiente();
  try {
    const { a, ana, noturno } = await base(amb);
    await a.post('/api/escalas', escalaBase({ titulo: 'Noite', dias: grade(noturno.id, [[ana.id, '2026-10-05']]) }));
    const madrugada = (await a.post('/api/horarios', { nome: 'Madrugada', hora_inicio: '05:30', hora_fim: '09:00' })).json.dado;
    const manha = await a.post('/api/escalas', escalaBase({
      titulo: 'Manhã', data_inicial: '2026-10-06', data_final: '2026-10-06', dias: grade(madrugada.id, [[ana.id, '2026-10-06']]),
    }));
    assert.equal(manha.status, 409);
    const livre = (await a.post('/api/horarios', { nome: 'Manhã livre', hora_inicio: '06:00', hora_fim: '09:00' })).json.dado;
    const manhaOk = await a.post('/api/escalas', escalaBase({
      titulo: 'Manhã ok', data_inicial: '2026-10-06', data_final: '2026-10-06', dias: grade(livre.id, [[ana.id, '2026-10-06']]),
    }));
    assert.equal(manhaOk.status, 201);
  } finally { await amb.encerrar(); }
});

test('folga aprovada × escala (regra 6): bloqueia ao criar a folga e ao criar a escala', async () => {
  const amb = await subirAmbiente();
  try {
    const { a, ana, diurno } = await base(amb);
    await a.post('/api/escalas', escalaBase({ titulo: 'Plantão', dias: grade(diurno.id, [[ana.id, '2026-10-05']]) }));
    const folga = { profissional_id: ana.id, tipo: 'folga_compensatoria', data_inicial: '2026-10-04', data_final: '2026-10-06' };
    const solicitada = await a.post('/api/folgas', { ...folga, status: 'solicitada' });
    assert.equal(solicitada.status, 201, 'solicitação pendente não bloqueia');
    assert.equal(solicitada.json.dado.aprovado_por, null);
    const aprovar = await a.post(`/api/folgas/${solicitada.json.dado.id}/status`, { status: 'aprovada' });
    assert.equal(aprovar.status, 409, 'aprovar é o momento em que a folga passa a valer');
    assert.match(aprovar.json.erro.conflitos[0].mensagem, /Escala "Plantão"/);
    const forcada = await a.post(`/api/folgas/${solicitada.json.dado.id}/status`, { status: 'aprovada', forcar: true });
    assert.equal(forcada.status, 200);
    assert.equal(forcada.json.dado.aprovado_por_nome, 'Ana Admin');
    assert.ok(forcada.json.dado.aprovado_em);

    const nova = await a.post('/api/escalas', escalaBase({
      titulo: 'Outra', data_inicial: '2026-10-06', data_final: '2026-10-08', dias: grade(diurno.id, [[ana.id, '2026-10-06']]),
    }));
    assert.equal(nova.status, 409);
    assert.equal(nova.json.erro.conflitos[0].com.tipo, 'folga');
    const cancelada = await a.post(`/api/folgas/${solicitada.json.dado.id}/status`, { status: 'cancelada' });
    assert.equal(cancelada.status, 200);
    const depoisDeCancelar = await a.post('/api/escalas', escalaBase({
      titulo: 'Outra', data_inicial: '2026-10-06', data_final: '2026-10-08', dias: grade(diurno.id, [[ana.id, '2026-10-06']]),
    }));
    assert.equal(depoisDeCancelar.status, 201, 'folga cancelada libera a agenda');
  } finally { await amb.encerrar(); }
});

test('treinamento confirmado × escala (regra 7) e regras de local/remoto', async () => {
  const amb = await subirAmbiente();
  try {
    const { a, ana, bia, local, diurno } = await base(amb);
    await a.post('/api/escalas', escalaBase({ titulo: 'Plantão', dias: grade(diurno.id, [[ana.id, '2026-10-05']]) }));
    const t = { nome: 'NR-10', data_inicial: '2026-10-05', data_final: '2026-10-05', hora_inicio: '09:00', hora_fim: '12:00', profissional_ids: [ana.id, bia.id] };
    const planejado = await a.post('/api/treinamentos', { ...t, status: 'planejado' });
    assert.equal(planejado.status, 201, 'planejado não bloqueia');
    const semLocal = await a.post(`/api/treinamentos/${planejado.json.dado.id}/status`, { status: 'confirmado' });
    assert.equal(semLocal.status, 422);
    assert.match(semLocal.json.erro.campos.local_id, /remoto/);
    const ambos = await a.post('/api/treinamentos', { ...t, remoto: true, local_id: local.id });
    assert.equal(ambos.status, 422);
    const confirmado = await a.post('/api/treinamentos', { ...t, status: 'confirmado', local_id: local.id });
    assert.equal(confirmado.status, 409);
    assert.equal(confirmado.json.erro.conflitos[0].profissional_nome, 'Ana Ribeiro');
    assert.equal(confirmado.json.erro.conflitos.length, 1, 'Bia não tem conflito');
    const remotoForcado = await a.post('/api/treinamentos', { ...t, status: 'confirmado', remoto: true, forcar: true });
    assert.equal(remotoForcado.status, 201);
    assert.equal(remotoForcado.json.dado.profissionais.length, 2);
  } finally { await amb.encerrar(); }
});

test('profissional inativo não recebe novos vínculos na grade, mas mantém os antigos (regra 1)', async () => {
  const amb = await subirAmbiente();
  try {
    const { a, ana, bia, diurno } = await base(amb);
    const e = (await a.post('/api/escalas', escalaBase({
      titulo: 'Histórico', dias: grade(diurno.id, [[ana.id, '2026-10-05'], [bia.id, '2026-10-05']]),
    }))).json.dado;
    await a.post(`/api/profissionais/${bia.id}/status`, { status: 'inativo' });
    const editar = await a.put(`/api/escalas/${e.id}`, { ...e, titulo: 'Histórico editado', dias: e.dias.map((d: any) => ({ profissional_id: d.profissional_id, data: d.data, horario_id: d.horario_id })) });
    assert.equal(editar.status, 200, 'quem já estava vinculado permanece (grade não mudou)');
    assert.equal(editar.json.dado.profissionais.length, 2);
    const nova = await a.post('/api/escalas', escalaBase({
      titulo: 'Nova', data_inicial: '2026-12-01', data_final: '2026-12-01', dias: grade(diurno.id, [[bia.id, '2026-12-01']]),
    }));
    assert.equal(nova.status, 422);
    assert.match(nova.json.erro.campos.dias, /inativos não aceitam novos vínculos: Bia Campos/);
    assert.equal((await a.post('/api/folgas', { profissional_id: bia.id, tipo: 'ferias', data_inicial: '2026-12-01', data_final: '2026-12-02' })).status, 422);
    assert.equal((await a.get(`/api/escalas/${e.id}`)).json.dado.profissionais.length, 2, 'consulta histórica continua completa');
  } finally { await amb.encerrar(); }
});

test('listagem por período considera intervalos que atravessam meses e anos (regra 13)', async () => {
  const amb = await subirAmbiente();
  try {
    const { a, ana, diurno } = await base(amb);
    await a.post('/api/escalas', escalaBase({
      titulo: 'Virada de ano', data_inicial: '2026-12-20', data_final: '2027-01-10', dias: grade(diurno.id, [[ana.id, '2026-12-25']]),
    }));
    await a.post('/api/escalas', escalaBase({ titulo: 'Só outubro', data_inicial: '2026-10-05', data_final: '2026-10-06' }));
    const titulos = async (q: string) => (await a.get(`/api/escalas?${q}`)).json.dados.map((e: any) => e.titulo);
    assert.deepEqual(await titulos('inicio=2027-01-01&fim=2027-01-31'), ['Virada de ano']);
    assert.deepEqual(await titulos('inicio=2026-12-01&fim=2026-12-31'), ['Virada de ano']);
    assert.deepEqual(await titulos('inicio=2027-02-01&fim=2027-02-28'), []);
    assert.deepEqual((await titulos('inicio=2026-10-01&fim=2027-12-31')).sort(), ['Só outubro', 'Virada de ano']);
    assert.deepEqual(await titulos(`profissional_id=${ana.id}`), ['Virada de ano']);
  } finally { await amb.encerrar(); }
});

test('usuário somente-leitura vê escalas e folgas, mas não o motivo da folga', async () => {
  const amb = await subirAmbiente();
  try {
    const { a, ana } = await base(amb);
    const f = await a.post('/api/folgas', { profissional_id: ana.id, tipo: 'licenca', data_inicial: '2026-10-05', data_final: '2026-10-06', status: 'aprovada', motivo: 'Consulta médica' });
    assert.equal(f.json.dado.motivo, 'Consulta médica');
    const u = await clienteUsuario(amb);
    const lista = await u.get('/api/folgas');
    assert.equal(lista.status, 200);
    assert.equal(lista.json.dados[0].motivo, null);
    assert.equal((await u.get(`/api/folgas/${f.json.dado.id}`)).json.dado.motivo, null);
    assert.equal((await u.get(`/api/folgas/${f.json.dado.id}`)).json.dado.historico, undefined, 'histórico é só de administradores');
    assert.equal((await u.get('/api/escalas')).status, 200);
    assert.equal((await u.get('/api/treinamentos')).status, 200);
    assert.equal((await u.post('/api/escalas', escalaBase())).status, 403);
    assert.equal((await u.post('/api/folgas', {})).status, 403);
  } finally { await amb.encerrar(); }
});

test('recorrência por dia da semana em folgas: bloqueia só nos dias marcados', async () => {
  const amb = await subirAmbiente();
  try {
    const { a, diurno } = await base(amb);
    const prof = (await a.post('/api/profissionais', { nome_completo: 'Prof Folga', uf: 'SP' })).json.dado;
    const folga = await a.post('/api/folgas', {
      profissional_id: prof.id, tipo: 'folga_semanal', data_inicial: '2026-10-05', data_final: '2026-10-19', status: 'aprovada', dias_semana: [1],
    });
    assert.equal(folga.status, 201);
    assert.deepEqual(folga.json.dado.dias_semana, [1]);
    // Terça a domingo não inclui nenhuma segunda-feira do período da folga.
    const semConflito = await a.post('/api/escalas', escalaBase({
      titulo: 'Sem conflito', data_inicial: '2026-10-06', data_final: '2026-10-11', dias: grade(diurno.id, [[prof.id, '2026-10-06']]),
    }));
    assert.equal(semConflito.status, 201, JSON.stringify(semConflito.json));
    // Este período (12 e 13/10) inclui a segunda-feira 12/10 e não toca a outra escala.
    const comConflito = await a.post('/api/escalas', escalaBase({
      titulo: 'Com conflito', data_inicial: '2026-10-12', data_final: '2026-10-13', dias: grade(diurno.id, [[prof.id, '2026-10-12']]),
    }));
    assert.equal(comConflito.status, 409);
    assert.equal(comConflito.json.erro.conflitos[0].com.tipo, 'folga');
  } finally { await amb.encerrar(); }
});

test('cancelar escala libera a agenda e preserva o histórico', async () => {
  const amb = await subirAmbiente();
  try {
    const { a, ana, diurno } = await base(amb);
    const e1 = (await a.post('/api/escalas', escalaBase({ titulo: 'Escala 1', dias: grade(diurno.id, [[ana.id, '2026-10-05']]) }))).json.dado;
    assert.equal((await a.post('/api/escalas', escalaBase({ titulo: 'Escala 2', dias: grade(diurno.id, [[ana.id, '2026-10-05']]) }))).status, 409);
    const cancelada = await a.post(`/api/escalas/${e1.id}/status`, { status: 'cancelada' });
    assert.equal(cancelada.status, 200);
    assert.equal(cancelada.json.dado.status, 'cancelada');
    assert.equal((await a.post('/api/escalas', escalaBase({ titulo: 'Escala 2', dias: grade(diurno.id, [[ana.id, '2026-10-05']]) }))).status, 201);
    assert.equal((await a.get(`/api/escalas/${e1.id}`)).json.dado.historico[0].acao, 'alterou_status');
  } finally { await amb.encerrar(); }
});

test('alterar só a situação de uma escala com grade preenchida não é barrado (bug corrigido) e a grade é preservada', async () => {
  const amb = await subirAmbiente();
  try {
    const { a, ana, diurno } = await base(amb);
    const e = await a.post('/api/escalas', escalaBase({
      titulo: 'Escala com grade', data_inicial: '2026-10-05', data_final: '2026-10-08',
      dias: grade(diurno.id, [[ana.id, '2026-10-05'], [ana.id, '2026-10-07']]),
    }));
    assert.equal(e.status, 201);
    const r = await a.post(`/api/escalas/${e.json.dado.id}/status`, { status: 'cancelada' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.dado.status, 'cancelada');
    assert.equal(r.json.dado.dias.length, 2, 'as células da grade continuam intactas');
  } finally { await amb.encerrar(); }
});

test('ponto 4 do segundo pedido: escala "em andamento" com data final vencida conclui sozinha', async () => {
  const amb = await subirAmbiente();
  try {
    const { a, ana, local, projeto, diurno } = await base(amb);
    const vencida = await a.post('/api/escalas', escalaBase({
      titulo: 'Plantão vencido', data_inicial: '2020-01-01', data_final: '2020-01-02', projeto_id: projeto.id, local_ids: [local.id],
      dias: grade(diurno.id, [[ana.id, '2020-01-01']]),
    }));
    const statusVencida = await a.post(`/api/escalas/${vencida.json.dado.id}/status`, { status: 'em_andamento' });
    assert.equal(statusVencida.status, 200, JSON.stringify(statusVencida.json));
    const futura = await a.post('/api/escalas', escalaBase({
      titulo: 'Plantão futuro', data_inicial: '2099-01-01', data_final: '2099-01-02', projeto_id: projeto.id, local_ids: [local.id],
      dias: grade(diurno.id, [[ana.id, '2099-01-01']]),
    }));
    const statusFutura = await a.post(`/api/escalas/${futura.json.dado.id}/status`, { status: 'em_andamento' });
    assert.equal(statusFutura.status, 200, JSON.stringify(statusFutura.json));
    _resetarThrottleParaTeste();
    await a.get('/api/opcoes');
    assert.equal((await a.get(`/api/escalas/${vencida.json.dado.id}`)).json.dado.status, 'concluida', 'data final no passado: conclui automaticamente');
    assert.equal((await a.get(`/api/escalas/${futura.json.dado.id}`)).json.dado.status, 'em_andamento', 'data final no futuro: continua em andamento');
  } finally { await amb.encerrar(); }
});
