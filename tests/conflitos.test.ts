import test from 'node:test';
import assert from 'node:assert/strict';
import { detectar, intervalos } from '../src/server/conflitos.ts';
import type { Ocupacao } from '../src/server/conflitos.ts';
import { agoraSaoPaulo, dataParaDias, dataValida, diasParaData, horaValida, somarDias } from '../src/shared/datetime.ts';

let seq = 0;
function escala(p: Partial<Ocupacao> = {}): Ocupacao {
  return { tipo: 'escala', id: ++seq, titulo: `E${seq}`, status: 'confirmada', profissional_ids: [1],
    data_inicial: '2026-10-05', data_final: '2026-10-05', hora_inicio: '08:00', hora_fim: '17:00', vira_dia: false, dias_semana: null, ...p };
}
const folga = (p: Partial<Ocupacao> = {}): Ocupacao => escala({ tipo: 'folga', status: 'aprovada', hora_inicio: null, hora_fim: null, ...p });
const trein = (p: Partial<Ocupacao> = {}): Ocupacao => escala({ tipo: 'treinamento', status: 'confirmado', ...p });

test('datas: validação de dias reais, ano bissexto e aritmética entre meses/anos', () => {
  assert.equal(dataValida('2028-02-29'), true);
  assert.equal(dataValida('2027-02-29'), false);
  assert.equal(dataValida('2026-13-01'), false);
  assert.equal(dataValida('01/10/2026'), false);
  assert.equal(horaValida('23:59'), true);
  assert.equal(horaValida('24:00'), false);
  assert.equal(somarDias('2026-12-31', 1), '2027-01-01');
  assert.equal(somarDias('2026-03-01', -1), '2026-02-28');
  assert.equal(diasParaData(dataParaDias('2026-10-05')), '2026-10-05');
  assert.match(agoraSaoPaulo(new Date('2026-10-05T02:30:00Z')).data, /^2026-10-04$/, '02:30 UTC ainda é dia 04 em São Paulo (UTC-3)');
  assert.equal(agoraSaoPaulo(new Date('2026-10-05T02:30:00Z')).hora, '23:30');
});

test('sobreposição parcial no mesmo dia e mesmo profissional é conflito', () => {
  const r = detectar([escala(), escala({ hora_inicio: '16:00', hora_fim: '20:00' })]);
  assert.equal(r.length, 1);
  assert.equal(r[0]!.profissional_id, 1);
});

test('turnos encostados (fim = início) não conflitam', () => {
  assert.equal(detectar([escala(), escala({ hora_inicio: '17:00', hora_fim: '22:00' })]).length, 0);
});

test('profissionais diferentes não conflitam; um em comum basta', () => {
  assert.equal(detectar([escala({ profissional_ids: [1] }), escala({ profissional_ids: [2] })]).length, 0);
  const r = detectar([escala({ profissional_ids: [1, 2, 3] }), escala({ profissional_ids: [3, 4] })]);
  assert.deepEqual(r.map((c) => c.profissional_id), [3]);
});

test('virada de dia: turno noturno conflita com o turno da manhã seguinte', () => {
  const noite = escala({ hora_inicio: '22:00', hora_fim: '06:00', vira_dia: true });
  const manha = escala({ data_inicial: '2026-10-06', data_final: '2026-10-06', hora_inicio: '05:00', hora_fim: '09:00' });
  assert.equal(detectar([noite, manha]).length, 1);
  const depois = escala({ data_inicial: '2026-10-06', data_final: '2026-10-06', hora_inicio: '06:00', hora_fim: '09:00' });
  assert.equal(detectar([noite, depois]).length, 0, 'terminou às 06:00, o outro começa às 06:00');
});

test('períodos de vários dias: horários que não se cruzam em nenhum dia não conflitam', () => {
  const manha = escala({ data_inicial: '2026-10-01', data_final: '2026-10-31', hora_inicio: '08:00', hora_fim: '12:00' });
  const tarde = escala({ data_inicial: '2026-10-15', data_final: '2026-11-15', hora_inicio: '13:00', hora_fim: '17:00' });
  assert.equal(detectar([manha, tarde]).length, 0);
  const cruza = escala({ data_inicial: '2026-10-31', data_final: '2026-11-15', hora_inicio: '11:00', hora_fim: '14:00' });
  assert.equal(detectar([manha, cruza]).length, 1, 'só 31/10 se sobrepõe');
});

test('período que atravessa a virada de ano é comparado corretamente', () => {
  const a = escala({ data_inicial: '2026-12-28', data_final: '2027-01-03' });
  const b = escala({ data_inicial: '2027-01-03', data_final: '2027-01-05' });
  assert.equal(detectar([a, b]).length, 1);
  const c = escala({ data_inicial: '2027-01-04', data_final: '2027-01-05' });
  assert.equal(detectar([a, c]).length, 0);
});

test('escala × folga APROVADA conflita (dia inteiro); solicitada não', () => {
  const e = escala();
  assert.equal(detectar([e, folga({ data_inicial: '2026-10-04', data_final: '2026-10-06' })]).length, 1);
  assert.equal(detectar([e, folga({ status: 'solicitada' })]).length, 0);
  assert.equal(detectar([e, folga({ status: 'recusada' })]).length, 0);
  assert.equal(detectar([e, folga({ data_inicial: '2026-10-06', data_final: '2026-10-07' })]).length, 0);
});

test('escala × treinamento CONFIRMADO conflita; planejado não', () => {
  assert.equal(detectar([escala(), trein({ hora_inicio: '09:00', hora_fim: '10:00' })]).length, 1);
  assert.equal(detectar([escala(), trein({ status: 'planejado' })]).length, 0);
  assert.equal(detectar([escala(), trein({ status: 'cancelado' })]).length, 0);
});

test('escala cancelada não ocupa agenda; planejada e concluída ocupam', () => {
  assert.equal(detectar([escala(), escala({ status: 'cancelada' })]).length, 0);
  assert.equal(detectar([escala(), escala({ status: 'planejada' })]).length, 1);
  assert.equal(detectar([escala(), escala({ status: 'concluida' })]).length, 1);
});

test('um registro não conflita consigo mesmo e pares não são duplicados', () => {
  const a = escala({ data_inicial: '2026-10-01', data_final: '2026-10-10' });
  const b = escala({ data_inicial: '2026-10-01', data_final: '2026-10-10' });
  const r = detectar([a, b]);
  assert.equal(r.length, 1, 'dez dias de sobreposição resultam em um único conflito por par/profissional');
  assert.equal(detectar([a]).length, 0);
});

test('intervalos com recorte geram apenas o que toca o período', () => {
  const e = escala({ data_inicial: '2026-10-01', data_final: '2026-10-31' });
  assert.equal(intervalos(e).length, 31);
  assert.equal(intervalos(e, { de: '2026-10-10', ate: '2026-10-12' }).length, 3);
  const noite = escala({ data_inicial: '2026-10-09', data_final: '2026-10-09', hora_inicio: '22:00', hora_fim: '06:00', vira_dia: true });
  assert.equal(intervalos(noite, { de: '2026-10-10', ate: '2026-10-10' }).length, 1, 'turno que começou dia 09 ainda toca o dia 10');
  assert.equal(intervalos(noite, { de: '2026-10-11', ate: '2026-10-11' }).length, 0);
});

test('recorrência por dia da semana: "dias úteis" não gera ocupação no fim de semana', () => {
  // 05/10/2026 (segunda) a 11/10/2026 (domingo): uma semana cheia.
  const uteis = escala({ data_inicial: '2026-10-05', data_final: '2026-10-11', dias_semana: [1, 2, 3, 4, 5] });
  assert.equal(intervalos(uteis).length, 5, 'só segunda a sexta, 5 ocorrências');
  const todos = escala({ data_inicial: '2026-10-05', data_final: '2026-10-11', dias_semana: null });
  assert.equal(intervalos(todos).length, 7, 'sem restrição, todos os 7 dias');
});

test('recorrência por dia da semana: duas escalas em dias alternados não conflitam', () => {
  // Segunda/quarta/sexta (1,3,5) vs terça/quinta (2,4), mesmo horário, mesma semana.
  const a = escala({ data_inicial: '2026-10-05', data_final: '2026-10-11', dias_semana: [1, 3, 5], profissional_ids: [1] });
  const b = escala({ data_inicial: '2026-10-05', data_final: '2026-10-11', dias_semana: [2, 4], profissional_ids: [1] });
  assert.equal(detectar([a, b]).length, 0, 'nenhum dia em comum entre os dois padrões');
});

test('recorrência por dia da semana: conflito só aparece no dia em comum', () => {
  // Segunda/quarta/sexta (1,3,5) vs só quarta (3) — conflitam apenas na quarta.
  const a = escala({ data_inicial: '2026-10-05', data_final: '2026-10-11', dias_semana: [1, 3, 5], profissional_ids: [1] });
  const b = escala({ data_inicial: '2026-10-05', data_final: '2026-10-11', dias_semana: [3], profissional_ids: [1], hora_inicio: '10:00', hora_fim: '12:00' });
  const r = detectar([a, b]);
  assert.equal(r.length, 1);
  assert.equal(diasParaData(Math.floor(r[0]!.inicio / 1440)), '2026-10-07', 'a única sobreposição é na quarta-feira (07/10)');
});

test('recorrência por dia da semana: folga recorrente vira um bloqueio por dia, não um período contínuo', () => {
  // Folga aprovada toda segunda-feira, e uma escala confirmada de terça a domingo — não deve conflitar
  // (a segunda-feira fica FORA do período da escala).
  const f = folga({ data_inicial: '2026-10-05', data_final: '2026-10-19', dias_semana: [1], profissional_ids: [1] });
  const e1 = escala({ data_inicial: '2026-10-06', data_final: '2026-10-11', profissional_ids: [1] });
  assert.equal(detectar([f, e1]).length, 0, 'a folga só ocupa segundas-feiras, fora do período desta escala');
  // Mas uma escala que inclua uma segunda-feira do período da folga deve conflitar.
  const e2 = escala({ data_inicial: '2026-10-10', data_final: '2026-10-13', profissional_ids: [1] });
  const r = detectar([f, e2]);
  assert.equal(r.length, 1);
  assert.equal(diasParaData(Math.floor(r[0]!.inicio / 1440)), '2026-10-12', 'a segunda-feira dentro do período da escala (12/10)');
});

test('recorrência por dia da semana combinada com virada de dia: o dia considerado é o de início do turno', () => {
  // Turno noturno que só ocorre às sextas-feiras (22h-06h, virada de dia): começa sexta 09/10, termina sábado 10/10 de manhã.
  const noiteSexta = escala({ data_inicial: '2026-10-05', data_final: '2026-10-11', hora_inicio: '22:00', hora_fim: '06:00', vira_dia: true, dias_semana: [5], profissional_ids: [1] });
  assert.equal(intervalos(noiteSexta).length, 1, 'só uma sexta-feira nessa semana');
  const manhaSabado = escala({ data_inicial: '2026-10-10', data_final: '2026-10-10', hora_inicio: '05:00', hora_fim: '09:00', profissional_ids: [1] });
  assert.equal(detectar([noiteSexta, manhaSabado]).length, 1, 'o turno iniciado sexta ainda invade a madrugada de sábado');
});

test('quarto pedido de ajustes: grade de escala — cada célula (profissional+data+horário) é uma ocupação concreta, sem recorrência', () => {
  // Como routes/agenda.ts grava escala_dias: uma linha por (escala_id, profissional_id, data, horario_id).
  // Aqui simulamos a leitura de carregarOcupacoes() para essas linhas: uma Ocupacao por célula, todas com
  // o MESMO id de escala (então nunca conflitam entre si, mesmo id — ver `mesmo()`), cada uma só naquele dia.
  const idEscala = ++seq;
  const celula = (data: string, profissional_id: number, p: Partial<Ocupacao> = {}) => escala({
    id: idEscala, data_inicial: data, data_final: data, profissional_ids: [profissional_id], ...p,
  });

  // Caso real do pedido: dentro de UMA ÚNICA escala, a Adriana trabalha segunda a sexta (D1, 08h-17h) e a
  // Ana Carla trabalha só terça e quinta (MT, 13h-22h) — dois profissionais, dois padrões de dia/horário
  // diferentes, no mesmo registro de escala. Isso é exatamente o que a tela de grade precisa permitir.
  const adriana = [1, 2, 3, 4, 5].map((n) => celula(`2026-10-0${n}`, 10));
  const anaCarla = ['2026-10-06', '2026-10-08'].map((d) => celula(d, 20, { hora_inicio: '13:00', hora_fim: '22:00' }));
  assert.equal(detectar([...adriana, ...anaCarla]).length, 0, 'profissionais diferentes, mesma escala: sem conflito entre eles');

  // Se a Ana Carla também tivesse uma célula no mesmo dia e horário que a Adriana, ainda não conflitaria
  // (profissionais diferentes nunca conflitam entre si, independente da escala).
  const anaCarlaMesmoDiaQueAdriana = celula('2026-10-01', 20, { hora_inicio: '08:00', hora_fim: '17:00' });
  assert.equal(detectar([...adriana, anaCarlaMesmoDiaQueAdriana]).length, 0);

  // Já duas células do MESMO profissional, no mesmo dia, em horários que se cruzam (ex.: cadastro
  // duplicado por engano) continuam gerando conflito normalmente, mesmo pertencendo à mesma escala —
  // só células da MESMA ocupação (tipo+id) nunca conflitam entre si; aqui são ids diferentes.
  const outraEscalaMesmoDia = escala({ data_inicial: '2026-10-01', data_final: '2026-10-01', profissional_ids: [10], hora_inicio: '10:00', hora_fim: '12:00' });
  assert.equal(detectar([...adriana, outraEscalaMesmoDia]).length, 1, 'mesma pessoa, dias/horários que se cruzam, escalas diferentes: conflita');
});

test('quarto pedido de ajustes: escala 12x36 (Alan/Ivan) expressa como células explícitas da grade, inclusive dentro de uma mesma escala', () => {
  // Mesmo exemplo literal do pedido (Alan a cada 2 dias a partir de 13/10; Ivan a cada 2 dias a partir de
  // 14/10), mas agora cada ocorrência é uma célula explícita da grade — como o admin preencheria na tela —
  // em vez de um campo de recorrência. Ambos dentro da MESMA escala (dois profissionais, dois padrões).
  const idEscala = ++seq;
  const datasAlan = ['13', '15', '17', '19', '21', '23', '25', '27', '29', '31'].map((d) => `2026-10-${d}`);
  const datasIvan = ['14', '16', '18', '20', '22', '24', '26', '28', '30'].map((d) => `2026-10-${d}`);
  const celulasAlan = datasAlan.map((d) => escala({ id: idEscala, data_inicial: d, data_final: d, profissional_ids: [1] }));
  const celulasIvan = datasIvan.map((d) => escala({ id: idEscala, data_inicial: d, data_final: d, profissional_ids: [2] }));

  assert.equal(detectar([...celulasAlan, ...celulasIvan]).length, 0, 'Alan e Ivan revezam em dias opostos: nunca se encontram');

  // Se o Ivan também tivesse uma célula no dia 13/10 (mesma fase do Alan), aí sim conflitaria, pois seria
  // o MESMO profissional (o Alan) tendo duas células no mesmo dia e horário — simulando um erro de cadastro.
  const celulaDuplicadaAlan = escala({ id: idEscala, data_inicial: '2026-10-13', data_final: '2026-10-13', profissional_ids: [1] });
  const outraEscalaMesmaCelula = escala({ data_inicial: '2026-10-13', data_final: '2026-10-13', profissional_ids: [1] });
  assert.ok(detectar([celulaDuplicadaAlan, outraEscalaMesmaCelula]).length > 0, 'mesmo profissional, mesmo dia/horário, escalas diferentes: conflita');
});
