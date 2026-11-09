import test from 'node:test';
import assert from 'node:assert/strict';
import { clienteAdmin, clienteUsuario, subirAmbiente } from './apoio.ts';
import { lerCsv } from '../src/server/csv.ts';

const CAB = 'Título;Código do projeto;Local;Data inicial;Data final;Horário;Situação;Dias da semana;Profissionais;Descrição';

async function preparar() {
  const amb = await subirAmbiente();
  const a = await clienteAdmin(amb);
  const mk = async (rota: string, corpo: object) => (await a.post(rota, corpo)).json.dado;
  await mk('/api/profissionais', { nome_completo: 'Ana Ribeiro', uf: 'SP' });
  await mk('/api/profissionais', { nome_completo: 'José Álvares', uf: 'RJ' });
  await mk('/api/locais', { nome: 'Base Central', uf: 'SP' });
  await mk('/api/projetos', { nome: 'Projeto Alfa', codigo: 'ALFA', status: 'ativo' });
  await mk('/api/horarios', { nome: 'Comercial', hora_inicio: '08:00', hora_fim: '17:00' });
  await mk('/api/horarios', { nome: 'Noturno', hora_inicio: '22:00', hora_fim: '06:00', vira_dia: true });
  await mk('/api/horarios', { nome: 'Curto', hora_inicio: '10:00', hora_fim: '12:00' });
  return { amb, a };
}

test('csv: lê aspas, separador dentro de campo, BOM e quebras de linha do Windows', () => {
  const r = lerCsv('﻿a;b;c\r\n"x;y";"diz ""oi""";z\r\n\r\n');
  assert.deepEqual(r, [['a', 'b', 'c'], ['x;y', 'diz "oi"', 'z']]);
  assert.deepEqual(lerCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']], 'detecta vírgula como separador');
});

test('importação: cria as linhas válidas, resolve nomes sem acento e aplica dias da semana', async () => {
  const { amb, a } = await preparar();
  try {
    const csv = [CAB,
      'Plantão Manhã;ALFA;Base Central;05/10/2026;11/10/2026;Comercial;Confirmada;Seg, Ter, Qua, Qui, Sex;Ana Ribeiro | Jose Alvares;Semana 1',
      'Plantão Noite;ALFA;;12/10/2026;12/10/2026;Noturno;;Todos;Ana Ribeiro;',
    ].join('\r\n');
    const r = await a.post('/api/escalas/importar', { csv });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.total, 2);
    assert.equal(r.json.criadas, 2, JSON.stringify(r.json.resultados));
    const e = (await a.get(`/api/escalas/${r.json.resultados[0].id}`)).json.dado;
    // Seg a sex (05 a 11/10) para dois profissionais = 5 dias × 2 = 10 células na grade.
    assert.equal(e.dias.length, 10);
    assert.equal(e.profissionais.length, 2, '"Jose Alvares" (sem acento) encontra "José Álvares"');
    assert.equal(e.status, 'confirmada');
    const noite = (await a.get(`/api/escalas/${r.json.resultados[1].id}`)).json.dado;
    assert.equal(noite.dias.length, 1);
    assert.equal(noite.dias[0].vira_dia, true);
    assert.equal(noite.status, 'planejada', 'situação vazia assume planejada');
    assert.ok(e.historico.some((h: any) => h.acao === 'criou'), 'a importação também é auditada');
  } finally { await amb.encerrar(); }
});

test('importação: linhas com erro são informadas e não impedem as demais', async () => {
  const { amb, a } = await preparar();
  try {
    const csv = [CAB,
      'Boa;ALFA;Base Central;05/10/2026;05/10/2026;Comercial;;;Ana Ribeiro;',
      'Data ruim;ALFA;Base Central;31/02/2026;05/10/2026;Comercial;;;Ana Ribeiro;',
      'Projeto ruim;XXX;Base Central;06/10/2026;06/10/2026;Comercial;;;Ana Ribeiro;',
      'Pessoa ruim;ALFA;Base Central;07/10/2026;07/10/2026;Comercial;;;Fulano Inexistente;',
      'Horário ruim;ALFA;Base Central;08/10/2026;08/10/2026;Não Existe;;;Ana Ribeiro;',
      'Dia ruim;ALFA;Base Central;09/10/2026;09/10/2026;Comercial;;Xyz;Ana Ribeiro;',
    ].join('\n');
    const r = await a.post('/api/escalas/importar', { csv });
    assert.equal(r.json.total, 6);
    assert.equal(r.json.criadas, 1);
    assert.equal(r.json.com_erro, 5);
    const porLinha = (n: number) => r.json.resultados.find((x: any) => x.linha === n);
    assert.equal(porLinha(2).ok, true);
    assert.match(porLinha(3).erros[0], /Data inicial/);
    assert.match(porLinha(4).erros[0], /"XXX" não está cadastrado/);
    assert.match(porLinha(5).erros[0], /Fulano Inexistente/);
    assert.match(porLinha(6).erros[0], /"Não Existe" não está cadastrado/);
    assert.match(porLinha(7).erros[0], /Dias da semana/);
    assert.equal((await a.get('/api/escalas')).json.total, 1, 'só a linha boa foi gravada');
  } finally { await amb.encerrar(); }
});

test('importação: conflito de agenda bloqueia a linha, a menos que se force', async () => {
  const { amb, a } = await preparar();
  try {
    const csv = [CAB,
      'Primeira;ALFA;Base Central;05/10/2026;05/10/2026;Comercial;;;Ana Ribeiro;',
      'Segunda (conflita);ALFA;Base Central;05/10/2026;05/10/2026;Curto;;;Ana Ribeiro;',
    ].join('\n');
    const r = await a.post('/api/escalas/importar', { csv });
    assert.equal(r.json.criadas, 1);
    assert.match(r.json.resultados[1].erros[0], /Conflito de agenda — Ana Ribeiro: sobreposição com Escala "Primeira"/);

    const forcado = await a.post('/api/escalas/importar', { csv: [CAB, 'Terceira;ALFA;Base Central;05/10/2026;05/10/2026;Curto;;;Ana Ribeiro;'].join('\n'), forcar_conflitos: true });
    assert.equal(forcado.json.criadas, 1);
    const id = forcado.json.resultados[0].id;
    assert.ok((await a.get(`/api/escalas/${id}`)).json.dado.historico.some((h: any) => h.acao === 'conflito_forcado'));
  } finally { await amb.encerrar(); }
});

test('importação: cabeçalho incompleto, arquivo vazio e permissão', async () => {
  const { amb, a } = await preparar();
  try {
    const semColuna = await a.post('/api/escalas/importar', { csv: 'Título;Data inicial\nX;05/10/2026' });
    assert.equal(semColuna.status, 422);
    assert.match(semColuna.json.erro.mensagem, /Colunas obrigatórias ausentes/);
    assert.equal((await a.post('/api/escalas/importar', { csv: '' })).status, 422);
    assert.equal((await a.post('/api/escalas/importar', {})).status, 422);
    const u = await clienteUsuario(amb);
    assert.equal((await u.post('/api/escalas/importar', { csv: CAB })).status, 403, 'usuário somente-leitura não importa');
  } finally { await amb.encerrar(); }
});
