// Detecção de conflitos de agenda (regras 5, 6, 7 e 8).
//
// MODELO DE TEMPO
//  - Cada ocupação de ESCALA é uma célula concreta da grade (um profissional, numa data, no horário
//    escolhido para aquela data — ver escala_dias/routes/agenda.ts): uma linha = uma ocorrência, sem
//    recorrência para expandir (quarto pedido de ajustes, outubro). Treinamento ainda ocorre todos os
//    dias entre data_inicial e data_final (ou nos dias da semana marcados), no horário hora_inicio–
//    hora_fim; com virada de dia, cada ocorrência termina no dia seguinte.
//  - Folga ocupa os dias inteiros (00:00 do primeiro dia até 24:00 do último), com a mesma recorrência
//    por dia da semana quando marcada.
//  - Tempos são "minutos desde 1970-01-01 no relógio de America/Sao_Paulo" (sem conversão de fuso).
//  - Intervalos são semiabertos [início, fim): um turno que termina às 17:00 NÃO conflita com outro
//    que começa às 17:00.
//
// O QUE CONTA COMO OCUPAÇÃO (só ocupações "firmes" geram conflito):
//  - escala: planejada, confirmada, em andamento ou concluída (cancelada não conta) — a situação vale
//    para a escala inteira (todas as suas células);
//  - folga: somente APROVADA (solicitada/recusada/cancelada não contam);
//  - treinamento: somente CONFIRMADO.
//  Quaisquer duas ocupações firmes do MESMO profissional que se sobreponham são um conflito. Isso cobre
//  escala×escala (regra 5), escala×folga aprovada (regra 6) e escala×treinamento confirmado (regra 7),
//  além de treinamento×treinamento, folga×treinamento e folga×folga. Duas células da MESMA escala nunca
//  são comparadas entre si (mesmo tipo+id) — mesmo comportamento de antes, quando as ocorrências de um
//  único registro recorrente nunca conflitavam entre si.
//
// POLÍTICA (regra 8): conflitos BLOQUEIAM o salvamento (HTTP 409, com os registros envolvidos). O
//  administrador pode reenviar com `forcar: true` ("salvar mesmo assim"); nesse caso o registro é salvo,
//  o conflito passa a ser sinalizado na linha do tempo/dashboard e a decisão é registrada na auditoria.
//  A política é a mesma para escalas, folgas e treinamentos.
import type { DB } from './db.ts';
import { listar, marcadores, obter } from './db.ts';
import {
  dataParaDias, formatarDataBR, horaParaMinutos, somarDias,
} from '../shared/datetime.ts';
import { rotulo } from './rotulos.ts';

import { carregarSlots, ocupacoesDoTreinamento } from './treinamento_horarios.ts';

export type TipoAgenda = 'escala' | 'folga' | 'treinamento';

export interface Ocupacao {
  tipo: TipoAgenda;
  id: number;
  titulo: string;
  status: string;
  profissional_ids: number[];
  data_inicial: string;
  data_final: string;
  hora_inicio: string | null;
  hora_fim: string | null;
  vira_dia: boolean;
  /** Recorrência por dia da semana (0=domingo..6=sábado). null/vazio = todos os dias do período.
   *  Usado por folga e treinamento; escala sempre manda null (cada célula já é um dia concreto). */
  dias_semana: number[] | null;
}

export interface Intervalo { inicio: number; fim: number }

export const STATUS_FIRMES: Record<TipoAgenda, readonly string[]> = {
  escala: ['planejada', 'confirmada', 'em_andamento', 'concluida'],
  folga: ['aprovada'],
  treinamento: ['confirmado'],
};

export const ehFirme = (o: Pick<Ocupacao, 'tipo' | 'status'>): boolean => STATUS_FIRMES[o.tipo].includes(o.status);

const MIN_DIA = 1440;

/** 'AAAA-MM-DD' -> dia da semana (0-6), a partir do índice de dias já calculado (evita reconverter). */
const diaDaSemanaDoIndice = (diasDesdeEpoca: number): number => ((diasDesdeEpoca % 7) + 11) % 7;

/** Lê a coluna dias_semana do banco ("1,2,3,4,5" ou null) para a lista de números usada aqui. */
export function parseDiasSemana(texto: string | null | undefined): number[] | null {
  return texto ? texto.split(',').map(Number) : null;
}

/** Intervalos de tempo da ocupação. Com `recorte`, gera só os que tocam o período [de, ate] (datas ISO). */
export function intervalos(o: Ocupacao, recorte?: { de: string; ate: string }): Intervalo[] {
  const ini = dataParaDias(o.data_inicial);
  const fim = dataParaDias(o.data_final);
  const limiteInf = recorte ? dataParaDias(recorte.de) * MIN_DIA : -Infinity;
  const limiteSup = recorte ? (dataParaDias(recorte.ate) + 1) * MIN_DIA : Infinity;
  const permiteDia = (d: number): boolean => !o.dias_semana || o.dias_semana.includes(diaDaSemanaDoIndice(d));

  if (o.tipo === 'folga') {
    if (!o.dias_semana) {
      const iv = { inicio: ini * MIN_DIA, fim: (fim + 1) * MIN_DIA };
      return iv.fim > limiteInf && iv.inicio < limiteSup ? [iv] : [];
    }
    // Com recorrência, a folga vira um intervalo de dia inteiro por dia da semana selecionado.
    const saida: Intervalo[] = [];
    const primeiro = recorte ? Math.max(ini, dataParaDias(recorte.de)) : ini;
    const ultimo = recorte ? Math.min(fim, dataParaDias(recorte.ate)) : fim;
    for (let d = primeiro; d <= ultimo; d++) {
      if (!permiteDia(d)) continue;
      const iv = { inicio: d * MIN_DIA, fim: (d + 1) * MIN_DIA };
      if (iv.fim > limiteInf && iv.inicio < limiteSup) saida.push(iv);
    }
    return saida;
  }
  const hi = horaParaMinutos(o.hora_inicio!);
  const hf = horaParaMinutos(o.hora_fim!);
  const saida: Intervalo[] = [];
  // Um dia antes do recorte, pois turnos com virada de dia entram no dia seguinte.
  const primeiro = recorte ? Math.max(ini, dataParaDias(recorte.de) - 1) : ini;
  const ultimo = recorte ? Math.min(fim, dataParaDias(recorte.ate)) : fim;
  for (let d = primeiro; d <= ultimo; d++) {
    // O dia selecionado é o dia em que o turno COMEÇA (mesmo com virada de dia).
    if (!permiteDia(d)) continue;
    const iv = { inicio: d * MIN_DIA + hi, fim: (d + (o.vira_dia ? 1 : 0)) * MIN_DIA + hf };
    if (iv.fim > limiteInf && iv.inicio < limiteSup) saida.push(iv);
  }
  return saida;
}

export interface Conflito {
  profissional_id: number;
  a: Ocupacao;
  b: Ocupacao;
  inicio: number;
  fim: number;
}

const mesmo = (x: Ocupacao, y: Ocupacao): boolean => x.tipo === y.tipo && x.id === y.id;

/** Todos os pares de ocupações firmes que se sobrepõem para o mesmo profissional (opcionalmente só dentro de um período). */
export function detectar(ocupacoes: Ocupacao[], recorte?: { de: string; ate: string }): Conflito[] {
  const porProfissional = new Map<number, { iv: Intervalo; o: Ocupacao }[]>();
  for (const o of ocupacoes) {
    if (!ehFirme(o)) continue;
    const ivs = intervalos(o, recorte);
    for (const pid of o.profissional_ids) {
      let lista = porProfissional.get(pid);
      if (!lista) { lista = []; porProfissional.set(pid, lista); }
      for (const iv of ivs) lista.push({ iv, o });
    }
  }

  const achados = new Map<string, Conflito>();
  for (const [pid, lista] of porProfissional) {
    lista.sort((x, y) => x.iv.inicio - y.iv.inicio);
    let abertos: typeof lista = [];
    for (const atual of lista) {
      abertos = abertos.filter((x) => x.iv.fim > atual.iv.inicio);
      for (const x of abertos) {
        if (mesmo(x.o, atual.o)) continue;
        const [p, q] = [x.o, atual.o].sort((m, n) => (m.tipo + m.id).localeCompare(n.tipo + n.id));
        const chave = `${pid}|${p!.tipo}${p!.id}|${q!.tipo}${q!.id}`;
        if (!achados.has(chave)) {
          achados.set(chave, {
            profissional_id: pid, a: p!, b: q!,
            inicio: Math.max(x.iv.inicio, atual.iv.inicio), fim: Math.min(x.iv.fim, atual.iv.fim),
          });
        }
      }
      abertos.push(atual);
    }
  }
  return [...achados.values()];
}

function vinculos(db: DB, tabela: string, fk: string, ids: number[]): Map<number, number[]> {
  const mapa = new Map<number, number[]>();
  if (ids.length === 0) return mapa;
  for (const l of listar(db, `SELECT ${fk} AS rid, profissional_id AS pid FROM ${tabela} WHERE ${fk} IN (${marcadores(ids.length)})`, ...ids)) {
    const lista = mapa.get(l.rid) ?? [];
    lista.push(l.pid);
    mapa.set(l.rid, lista);
  }
  return mapa;
}

/** Um feriado "atinge" um profissional quando a abrangência do feriado contém a localidade dele:
 *  sem UF = nacional (atinge todos); com UF e sem cidade = estadual; com UF e cidade = municipal. */
function feriadoAtingeLocal(f: { uf: string | null; cidade: string | null }, p: { uf: string | null; cidade: string | null }): boolean {
  if (!f.uf) return true;
  if (f.uf !== p.uf) return false;
  if (!f.cidade) return true;
  return f.cidade === p.cidade;
}

/** Ponto 3 do pedido de ajustes: feriados viram folga automática (firme) para os profissionais cuja
 *  UF/cidade cadastrada coincide com a abrangência do feriado — sem gravar nada em `folgas`: são
 *  calculados a cada consulta, então passam a valer tanto para a detecção de conflitos quanto para a
 *  linha do tempo assim que o feriado ou a localidade do profissional mudam. O id é negativo
 *  (-periodo.id) para nunca colidir com o id de uma folga real. */
export function ocupacoesDeFeriados(db: DB, de: string, ate: string, profissionalIds?: number[]): Ocupacao[] {
  const feriados = listar(
    db,
    `SELECT id, nome, uf, cidade, data_inicial, data_final FROM periodos
      WHERE tipo = 'feriado' AND status = 'ativo' AND data_final >= ? AND data_inicial <= ?`,
    de, ate,
  );
  if (feriados.length === 0) return [];
  const restricao = profissionalIds?.length ? ` AND id IN (${marcadores(profissionalIds.length)})` : '';
  const profissionais = listar(db, `SELECT id, uf, cidade FROM profissionais WHERE status = 'ativo'${restricao}`, ...(profissionalIds?.length ? profissionalIds : []));
  const saida: Ocupacao[] = [];
  for (const f of feriados) {
    const ids = profissionais
      .filter((p) => feriadoAtingeLocal(f as { uf: string | null; cidade: string | null }, p as { uf: string | null; cidade: string | null }))
      .map((p) => p.id as number);
    if (ids.length === 0) continue;
    saida.push({
      tipo: 'folga', id: -f.id, titulo: `Feriado: ${f.nome}`, status: 'aprovada', profissional_ids: ids,
      data_inicial: f.data_inicial, data_final: f.data_final, hora_inicio: null, hora_fim: null, vira_dia: false, dias_semana: null,
    });
  }
  return saida;
}

/** Ocupações firmes que tocam o período [de, ate]. Opcionalmente restringe aos profissionais informados. */
export function carregarOcupacoes(
  db: DB,
  o: { de: string; ate: string; profissionalIds?: number[]; excluir?: { tipo: TipoAgenda; id: number } },
): Ocupacao[] {
  const de = somarDias(o.de, -1);
  const saida: Ocupacao[] = [];
  const restringir = (ids: number[]): number[] => (o.profissionalIds ? ids.filter((i) => o.profissionalIds!.includes(i)) : ids);

  // Cada linha de escala_dias já é uma ocorrência concreta (um profissional, uma data, um horário —
  // ver routes/agenda.ts): vira diretamente uma Ocupacao, sem recorrência para expandir.
  const diasEscala = listar(
    db,
    `SELECT ed.escala_id, ed.profissional_id, ed.data, e.titulo, e.status, h.hora_inicio, h.hora_fim, h.vira_dia
       FROM escala_dias ed
       JOIN escalas e ON e.id = ed.escala_id
       JOIN horarios h ON h.id = ed.horario_id
      WHERE e.status IN (${marcadores(STATUS_FIRMES.escala.length)}) AND ed.data >= ? AND ed.data <= ?`,
    ...STATUS_FIRMES.escala, de, o.ate,
  );
  for (const r of diasEscala) {
    if (o.profissionalIds && !o.profissionalIds.includes(r.profissional_id)) continue;
    saida.push({ tipo: 'escala', id: r.escala_id, titulo: r.titulo, status: r.status, profissional_ids: [r.profissional_id],
      data_inicial: r.data, data_final: r.data, hora_inicio: r.hora_inicio, hora_fim: r.hora_fim, vira_dia: r.vira_dia === 1,
      dias_semana: null });
  }

  // Treinamento: uma ocupação por (profissional, dias da semana, horário de início) — cada
  // participante tem o seu próprio horário (sexto pedido de ajustes, ver treinamento_horarios.ts).
  const trein = listar(
    db,
    `SELECT id, nome, status, data_inicial, data_final, duracao_minutos FROM treinamentos
      WHERE status IN (${marcadores(STATUS_FIRMES.treinamento.length)}) AND data_final >= ? AND data_inicial <= ?`,
    ...STATUS_FIRMES.treinamento, de, o.ate,
  );
  const slotsTr = carregarSlots(db, trein.map((t) => t.id));
  for (const t of trein) {
    saida.push(...ocupacoesDoTreinamento(t as never, (slotsTr.get(t.id) ?? []) as never, restringir));
  }

  const folgas = listar(
    db,
    `SELECT f.id, f.status, f.data_inicial, f.data_final, f.profissional_id, f.dias_semana, p.nome_completo FROM folgas f
       JOIN profissionais p ON p.id = f.profissional_id
      WHERE f.status IN (${marcadores(STATUS_FIRMES.folga.length)}) AND f.data_final >= ? AND f.data_inicial <= ?`,
    ...STATUS_FIRMES.folga, o.de, o.ate,
  );
  for (const f of folgas) {
    saida.push({ tipo: 'folga', id: f.id, titulo: `Folga de ${f.nome_completo}`, status: f.status, profissional_ids: restringir([f.profissional_id]),
      data_inicial: f.data_inicial, data_final: f.data_final, hora_inicio: null, hora_fim: null, vira_dia: false,
      dias_semana: parseDiasSemana(f.dias_semana) });
  }

  saida.push(...ocupacoesDeFeriados(db, de, o.ate, o.profissionalIds));

  return saida.filter((x) => x.profissional_ids.length > 0 && !(o.excluir && x.tipo === o.excluir.tipo && x.id === o.excluir.id));
}

/**
 * Conflitos que um ou mais candidatos (novos ou em edição) causariam com o que já está no banco.
 * Uma escala agora pode gerar VÁRIOS candidatos — um por célula da grade (profissional+data+horário,
 * ver routes/agenda.ts) — por isso esta função sempre recebe uma lista; folga e treinamento continuam
 * passando um único candidato (`[ocupacao]`). Todos os candidatos de uma mesma escala compartilham
 * tipo+id, então nunca conflitam entre si (ver `mesmo`), igual ao comportamento anterior em que as
 * ocorrências de um único registro recorrente nunca se confrontavam.
 */
export function conflitosDoCandidato(db: DB, candidatos: Ocupacao[]): Conflito[] {
  const firmes = candidatos.filter((c) => ehFirme(c) && c.profissional_ids.length > 0);
  if (firmes.length === 0) return [];
  const de = firmes.map((o) => o.data_inicial).sort()[0]!;
  const ate = firmes.map((o) => o.data_final).sort().at(-1)!;
  const profissionalIds = [...new Set(firmes.flatMap((o) => o.profissional_ids))];
  const { tipo, id } = firmes[0]!;
  const existentes = carregarOcupacoes(db, { de, ate, profissionalIds, excluir: { tipo, id } });
  const todos = detectar([...candidatos, ...existentes]);
  return todos.filter((c) => (c.a.tipo === tipo && c.a.id === id) || (c.b.tipo === tipo && c.b.id === id));
}

/** Lê um registro já salvo e devolve suas ocupações (independente do status) — uma por célula, no
 *  caso de escala; uma única ocupação (em lista) para folga/treinamento. Lista vazia = não encontrado
 *  ou (só para escala) sem nenhuma célula preenchida na grade. */
export function ocupacoesSalvas(db: DB, tipo: TipoAgenda, id: number): Ocupacao[] {
  if (tipo === 'folga') {
    const f = obter(db, `SELECT f.*, p.nome_completo FROM folgas f JOIN profissionais p ON p.id = f.profissional_id WHERE f.id = ?`, id);
    if (!f) return [];
    return [{ tipo, id, titulo: `Folga de ${f.nome_completo}`, status: f.status, profissional_ids: [f.profissional_id],
      data_inicial: f.data_inicial, data_final: f.data_final, hora_inicio: null, hora_fim: null, vira_dia: false,
      dias_semana: parseDiasSemana(f.dias_semana) }];
  }
  if (tipo === 'treinamento') {
    const r = obter(db, 'SELECT * FROM treinamentos WHERE id = ?', id);
    if (!r) return [];
    return ocupacoesDoTreinamento(r as never, (carregarSlots(db, [id]).get(id) ?? []) as never);
  }
  const e = obter(db, 'SELECT * FROM escalas WHERE id = ?', id);
  if (!e) return [];
  const linhas = listar(
    db,
    `SELECT ed.profissional_id, ed.data, h.hora_inicio, h.hora_fim, h.vira_dia
       FROM escala_dias ed JOIN horarios h ON h.id = ed.horario_id WHERE ed.escala_id = ?`,
    id,
  );
  return linhas.map((l) => ({ tipo, id, titulo: e.titulo, status: e.status, profissional_ids: [l.profissional_id],
    data_inicial: l.data, data_final: l.data, hora_inicio: l.hora_inicio, hora_fim: l.hora_fim, vira_dia: l.vira_dia === 1,
    dias_semana: null }));
}

export function periodoLegivel(o: Pick<Ocupacao, 'data_inicial' | 'data_final' | 'hora_inicio' | 'hora_fim' | 'tipo' | 'vira_dia'>): string {
  const datas = o.data_inicial === o.data_final
    ? formatarDataBR(o.data_inicial)
    : `${formatarDataBR(o.data_inicial)} a ${formatarDataBR(o.data_final)}`;
  const horas = o.tipo === 'folga' ? 'dia inteiro' : `${o.hora_inicio}–${o.hora_fim}${o.vira_dia ? ' (+1 dia)' : ''}`;
  return `${datas}, ${horas}`;
}

export interface ConflitoApi {
  profissional_id: number;
  profissional_nome: string;
  com: { tipo: TipoAgenda; id: number; titulo: string; status: string; data_inicial: string; data_final: string; hora_inicio: string | null; hora_fim: string | null; vira_dia: boolean };
  mensagem: string;
}

/** Formata conflitos do ponto de vista de `propria` (o registro consultado ou em edição). */
export function conflitosParaApi(db: DB, conflitos: Conflito[], propria: { tipo: TipoAgenda; id: number }): ConflitoApi[] {
  const ids = [...new Set(conflitos.map((c) => c.profissional_id))];
  const nomes = new Map<number, string>();
  if (ids.length) {
    for (const l of listar(db, `SELECT id, nome_completo FROM profissionais WHERE id IN (${marcadores(ids.length)})`, ...ids)) nomes.set(l.id, l.nome_completo);
  }
  return conflitos.map((c) => {
    const outra = c.a.tipo === propria.tipo && c.a.id === propria.id ? c.b : c.a;
    const nome = nomes.get(c.profissional_id) ?? `Profissional ${c.profissional_id}`;
    return {
      profissional_id: c.profissional_id,
      profissional_nome: nome,
      com: { tipo: outra.tipo, id: outra.id, titulo: outra.titulo, status: outra.status, data_inicial: outra.data_inicial,
        data_final: outra.data_final, hora_inicio: outra.hora_inicio, hora_fim: outra.hora_fim, vira_dia: outra.vira_dia },
      mensagem: `${nome}: sobreposição com ${rotulo(outra.tipo)} "${outra.titulo}" (${periodoLegivel(outra)}).`,
    };
  });
}
