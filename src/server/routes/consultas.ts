// Consultas de leitura: linha do tempo, dashboard, conflitos e opções para filtros/seleções.
import type { Ctx, Roteador } from '../http.ts';
import type { DB, Linha } from '../db.ts';
import { listar, marcadores, obter } from '../db.ts';
import { lancarValidacao } from '../regras.ts';
import {
  agoraSaoPaulo, dataValida, diasParaData, duracaoEmDias, somarDias,
} from '../../shared/datetime.ts';
import type { Conflito, Ocupacao, TipoAgenda } from '../conflitos.ts';
import { carregarSlots, ocupacoesDoTreinamento } from '../treinamento_horarios.ts';
import { carregarOcupacoes, detectar, ehFirme, intervalos, ocupacoesDeFeriados, parseDiasSemana } from '../conflitos.ts';
import { montarCsv, respostaCsv } from '../recursos.ts';
import { rotulo } from '../rotulos.ts';
import { formatarDataBR } from '../../shared/datetime.ts';

const MAX_DIAS_TIMELINE = 366;
const TIPOS: TipoAgenda[] = ['escala', 'folga', 'treinamento'];
const STATUS_ENCERRADOS = ['cancelada', 'cancelado', 'recusada'];

export interface ItemAgenda {
  tipo: TipoAgenda;
  id: number;
  titulo: string;
  status: string;
  data_inicial: string;
  data_final: string;
  hora_inicio: string | null;
  hora_fim: string | null;
  vira_dia: boolean;
  projeto_id: number | null;
  projeto_nome: string | null;
  projeto_codigo: string | null;
  local_id: number | null;
  local_nome: string | null;
  local_ids: number[];
  remoto: boolean;
  instrutor: string | null;
  tipo_folga: string | null;
  profissional_ids: number[];
  dias_semana: number[] | null;
  /** Só preenchido para escala (nome do horário cadastrado usado nesta célula da grade). */
  horario_nome: string | null;
  // Quinto pedido de ajustes (outubro): a dica da linha do tempo precisa mostrar o período
  // CADASTRADO da escala (data inicial/final do registro, não só o dia desta célula) — ver uso em
  // montarTimeline() e na dica montada no frontend (public/js/views/timeline.js). `data_inicial`/
  // `data_final` acima continuam sendo o dia concreto da célula (usados pela detecção de
  // conflitos e pelo CSV) — não mexer nesses dois para não quebrar aquela lógica.
  escala_data_inicial: string | null;
  escala_data_final: string | null;
}

const paraOcupacao = (i: ItemAgenda): Ocupacao => ({
  tipo: i.tipo, id: i.id, titulo: i.titulo, status: i.status, profissional_ids: i.profissional_ids,
  data_inicial: i.data_inicial, data_final: i.data_final, hora_inicio: i.hora_inicio, hora_fim: i.hora_fim, vira_dia: i.vira_dia,
  dias_semana: i.dias_semana,
});

function vinculos(db: DB, tabela: string, fk: string, ids: number[], fkOutra = 'profissional_id'): Map<number, number[]> {
  const mapa = new Map<number, number[]>();
  if (!ids.length) return mapa;
  for (const l of listar(db, `SELECT ${fk} AS rid, ${fkOutra} AS pid FROM ${tabela} WHERE ${fk} IN (${marcadores(ids.length)})`, ...ids)) {
    mapa.set(l.rid, [...(mapa.get(l.rid) ?? []), l.pid]);
  }
  return mapa;
}

/** Todos os registros (qualquer status) que possuem ocorrência dentro de [de, ate]. */
export function itensDoPeriodo(db: DB, de: string, ate: string): ItemAgenda[] {
  const antes = somarDias(de, -1); // turnos com virada de dia começam um dia antes
  const itens: ItemAgenda[] = [];

  // Uma escala não tem mais um único período/horário: cada célula da grade (escala_dias) já é uma
  // ocorrência concreta (um profissional, uma data, um horário), e vira diretamente um item da agenda.
  const diasEsc = listar(db, 'SELECT escala_id, profissional_id, data, horario_id FROM escala_dias WHERE data >= ? AND data <= ?', antes, ate);
  const escalaIds = [...new Set(diasEsc.map((d) => d.escala_id as number))];
  const escalasMap = new Map<number, Linha>();
  const locaisNomesEsc = new Map<number, string | null>();
  const locaisIdsEsc = vinculos(db, 'escala_locais', 'escala_id', escalaIds, 'local_id');
  if (escalaIds.length) {
    for (const e of listar(
      db,
      `SELECT e.id, e.titulo, e.status, e.projeto_id, e.data_inicial, e.data_final, p.nome AS projeto_nome, p.codigo AS projeto_codigo, p.remoto AS projeto_remoto
         FROM escalas e LEFT JOIN projetos p ON p.id = e.projeto_id WHERE e.id IN (${marcadores(escalaIds.length)})`,
      ...escalaIds,
    )) escalasMap.set(e.id, e);
    for (const l of listar(
      db,
      `SELECT el.escala_id, group_concat(l.nome, ', ') AS nomes FROM escala_locais el JOIN locais l ON l.id = el.local_id
        WHERE el.escala_id IN (${marcadores(escalaIds.length)}) GROUP BY el.escala_id`,
      ...escalaIds,
    )) locaisNomesEsc.set(l.escala_id, l.nomes);
  }
  const horarioIds = [...new Set(diasEsc.map((d) => d.horario_id as number))];
  const horariosMap = new Map<number, Linha>();
  if (horarioIds.length) {
    for (const h of listar(db, `SELECT id, nome, hora_inicio, hora_fim, vira_dia FROM horarios WHERE id IN (${marcadores(horarioIds.length)})`, ...horarioIds)) horariosMap.set(h.id, h);
  }
  for (const d of diasEsc) {
    const e = escalasMap.get(d.escala_id);
    const h = horariosMap.get(d.horario_id);
    if (!e || !h) continue; // defensivo: registro apagado entre as duas consultas (corrida improvável)
    itens.push({
      tipo: 'escala', id: e.id, titulo: e.titulo, status: e.status, data_inicial: d.data, data_final: d.data,
      hora_inicio: h.hora_inicio, hora_fim: h.hora_fim, vira_dia: h.vira_dia === 1,
      projeto_id: e.projeto_id, projeto_nome: e.projeto_nome, projeto_codigo: e.projeto_codigo,
      local_id: null, local_nome: locaisNomesEsc.get(e.id) ?? null, local_ids: locaisIdsEsc.get(e.id) ?? [],
      remoto: e.projeto_remoto === 1, instrutor: null, tipo_folga: null, horario_nome: h.nome,
      profissional_ids: [d.profissional_id], dias_semana: null,
      escala_data_inicial: e.data_inicial, escala_data_final: e.data_final,
    });
  }

  const trein = listar(
    db,
    `SELECT t.*, l.nome AS local_nome, p.nome AS projeto_nome, p.codigo AS projeto_codigo FROM treinamentos t
       LEFT JOIN locais l ON l.id = t.local_id LEFT JOIN projetos p ON p.id = t.projeto_id
      WHERE t.data_final >= ? AND t.data_inicial <= ?`,
    antes, ate,
  );
  // Treinamento: um item por (profissional, dias da semana, horário de início) — cada participante
  // tem o seu próprio horário (sexto pedido de ajustes).
  const slotsTr = carregarSlots(db, trein.map((t) => t.id));
  for (const t of trein) {
    for (const o of ocupacoesDoTreinamento(t as never, (slotsTr.get(t.id) ?? []) as never)) {
      itens.push({
        tipo: 'treinamento', id: t.id, titulo: t.nome, status: t.status, data_inicial: t.data_inicial, data_final: t.data_final,
        hora_inicio: o.hora_inicio, hora_fim: o.hora_fim, vira_dia: o.vira_dia,
        projeto_id: t.projeto_id, projeto_nome: t.projeto_nome, projeto_codigo: t.projeto_codigo, local_id: t.local_id, local_nome: t.local_nome,
        local_ids: t.local_id ? [t.local_id] : [],
        remoto: t.remoto === 1, instrutor: t.instrutor, tipo_folga: null, profissional_ids: o.profissional_ids,
        dias_semana: o.dias_semana, horario_nome: null,
        escala_data_inicial: null, escala_data_final: null,
      });
    }
  }

  for (const f of listar(db, 'SELECT * FROM folgas WHERE data_final >= ? AND data_inicial <= ?', de, ate)) {
    itens.push({
      tipo: 'folga', id: f.id, titulo: rotulo(f.tipo), status: f.status, data_inicial: f.data_inicial, data_final: f.data_final,
      hora_inicio: null, hora_fim: null, vira_dia: false, projeto_id: null, projeto_nome: null, projeto_codigo: null,
      local_id: null, local_nome: null, local_ids: [], remoto: false, instrutor: null, tipo_folga: f.tipo, profissional_ids: [f.profissional_id],
      dias_semana: parseDiasSemana(f.dias_semana), horario_nome: null,
      escala_data_inicial: null, escala_data_final: null,
    });
  }

  // Ponto 3: feriados viram folga automática, por localidade, na linha do tempo (e nos conflitos).
  for (const h of ocupacoesDeFeriados(db, antes, ate)) {
    itens.push({
      tipo: 'folga', id: h.id, titulo: h.titulo, status: h.status, data_inicial: h.data_inicial, data_final: h.data_final,
      hora_inicio: null, hora_fim: null, vira_dia: false, projeto_id: null, projeto_nome: null, projeto_codigo: null,
      local_id: null, local_nome: null, local_ids: [], remoto: false, instrutor: null, tipo_folga: 'feriado', profissional_ids: h.profissional_ids,
      dias_semana: null, horario_nome: null,
      escala_data_inicial: null, escala_data_final: null,
    });
  }
  return itens.filter((i) => intervalos(paraOcupacao(i), { de, ate }).length > 0);
}

function periodoDaQuery(ctx: Ctx, padrao?: { inicio: string; fim: string }): { de: string; ate: string } {
  const inicio = ctx.query.get('inicio') ?? padrao?.inicio ?? null;
  const fim = ctx.query.get('fim') ?? padrao?.fim ?? null;
  const erros: Record<string, string> = {};
  if (!dataValida(inicio)) erros.inicio = 'Data inicial: informe uma data válida.';
  if (!dataValida(fim)) erros.fim = 'Data final: informe uma data válida.';
  if (Object.keys(erros).length) lancarValidacao(erros);
  if ((fim as string) < (inicio as string)) lancarValidacao({ fim: 'Data final: não pode ser anterior à data inicial.' });
  if (duracaoEmDias(inicio as string, fim as string) > MAX_DIAS_TIMELINE) {
    lancarValidacao({ fim: `Período: no máximo ${MAX_DIAS_TIMELINE} dias por consulta.` });
  }
  return { de: inicio as string, ate: fim as string };
}

const lista = (v: string | null): string[] => (v ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const semAcento = (s: string): string => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

interface ResultadoTimeline {
  de: string;
  ate: string;
  profissionais: Linha[];
  itens: (ItemAgenda & { conflitos: { profissional_id: number; com: { tipo: TipoAgenda; id: number; titulo: string } }[] })[];
  conflitos: Conflito[];
}

function montarTimeline(ctx: Ctx): ResultadoTimeline {
  const db = ctx.db;
  const { de, ate } = periodoDaQuery(ctx);
  const q = ctx.query;

  const tipos = lista(q.get('tipo')).filter((t): t is TipoAgenda => (TIPOS as string[]).includes(t));
  const statusPedidos = lista(q.get('status'));
  const profIds = lista(q.get('profissional_id')).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const projetoId = Number(q.get('projeto_id')) || null;
  const localId = Number(q.get('local_id')) || null;
  const texto = semAcento((q.get('q') ?? '').trim());
  const incluirEncerrados = q.get('cancelados') === '1' || statusPedidos.some((s) => STATUS_ENCERRADOS.includes(s));

  const todos = itensDoPeriodo(db, de, ate);
  // Conflitos são calculados sobre TODOS os registros do período (os filtros só escondem itens, não conflitos).
  const conflitos = detectar(todos.map(paraOcupacao), { de, ate });
  // Uma escala agora pode gerar VÁRIOS itens (um por célula da grade — ver itensDoPeriodo), todos com o
  // mesmo tipo+id, mas em datas diferentes. Por isso a atribuição de conflito a um item não pode usar só
  // tipo+id (isso espalharia o conflito de UMA célula para TODAS as células da escala); guarda também o
  // profissional e a data em que a sobreposição realmente ocorre (minutosParaData(c.inicio)), e no momento
  // de montar `itens` casa isso com o profissional e o período de CADA item individualmente.
  const porRegistro = new Map<string, { profissional_id: number; data: string; com: { tipo: TipoAgenda; id: number; titulo: string } }[]>();
  for (const c of conflitos) {
    for (const [meu, outro] of [[c.a, c.b], [c.b, c.a]] as const) {
      const chave = `${meu.tipo}:${meu.id}`;
      porRegistro.set(chave, [
        ...(porRegistro.get(chave) ?? []),
        { profissional_id: c.profissional_id, data: minutosParaData(c.inicio), com: { tipo: outro.tipo, id: outro.id, titulo: outro.titulo } },
      ]);
    }
  }
  const conflitosDoItem = (i: ItemAgenda): ResultadoTimeline['itens'][number]['conflitos'] =>
    (porRegistro.get(`${i.tipo}:${i.id}`) ?? [])
      .filter((x) => i.profissional_ids.includes(x.profissional_id) && i.data_inicial <= x.data && x.data <= i.data_final)
      .map(({ profissional_id, com }) => ({ profissional_id, com }));

  const nomes = new Map<number, string>();
  const ids = [...new Set(todos.flatMap((i) => i.profissional_ids))];
  if (ids.length) for (const l of listar(db, `SELECT id, nome_completo FROM profissionais WHERE id IN (${marcadores(ids.length)})`, ...ids)) nomes.set(l.id, l.nome_completo);

  const filtrado = todos.filter((i) => {
    if (tipos.length && !tipos.includes(i.tipo)) return false;
    if (statusPedidos.length ? !statusPedidos.includes(i.status) : (!incluirEncerrados && STATUS_ENCERRADOS.includes(i.status))) return false;
    if (profIds.length && !i.profissional_ids.some((p) => profIds.includes(p))) return false;
    if (projetoId && i.projeto_id !== projetoId) return false;
    if (localId && !i.local_ids.includes(localId)) return false;
    if (texto) {
      const palheiro = semAcento([i.titulo, i.projeto_nome, i.projeto_codigo, i.local_nome, i.instrutor, rotulo(i.tipo_folga), ...i.profissional_ids.map((p) => nomes.get(p))].filter(Boolean).join(' '));
      if (!palheiro.includes(texto)) return false;
    }
    return true;
  });

  // Linhas: os profissionais selecionados; ou, sem seleção, todos os ativos + inativos que tenham registros no período.
  const filtrosAtivos = Boolean(tipos.length || statusPedidos.length || projetoId || localId || texto);
  const comItens = new Set(filtrado.flatMap((i) => i.profissional_ids));
  let profissionais: Linha[];
  if (profIds.length) {
    profissionais = listar(db, `SELECT id, nome_completo, cargo, uf, cidade, status FROM profissionais WHERE id IN (${marcadores(profIds.length)}) ORDER BY nome_completo COLLATE NOCASE`, ...profIds);
  } else {
    profissionais = listar(db, 'SELECT id, nome_completo, cargo, uf, cidade, status FROM profissionais ORDER BY nome_completo COLLATE NOCASE')
      .filter((p) => (filtrosAtivos ? comItens.has(p.id) : p.status === 'ativo' || comItens.has(p.id)));
  }

  return {
    de, ate, profissionais, conflitos,
    itens: filtrado.map((i) => ({ ...i, conflitos: ehFirme(paraOcupacao(i)) ? conflitosDoItem(i) : [] })),
  };
}

const minutosParaData = (m: number): string => diasParaData(Math.floor(m / 1440));

function resumoConflitos(db: DB, conflitos: Conflito[]): Linha[] {
  const ids = [...new Set(conflitos.map((c) => c.profissional_id))];
  const nomes = new Map<number, string>();
  if (ids.length) for (const l of listar(db, `SELECT id, nome_completo FROM profissionais WHERE id IN (${marcadores(ids.length)})`, ...ids)) nomes.set(l.id, l.nome_completo);
  return conflitos
    .sort((x, y) => x.inicio - y.inicio)
    .map((c) => ({
      profissional_id: c.profissional_id,
      profissional_nome: nomes.get(c.profissional_id) ?? '',
      data: minutosParaData(c.inicio),
      a: { tipo: c.a.tipo, id: c.a.id, titulo: c.a.titulo },
      b: { tipo: c.b.tipo, id: c.b.id, titulo: c.b.titulo },
    }));
}

const primeiroDoMes = (d: string): string => `${d.slice(0, 8)}01`;
function ultimoDoMes(d: string): string {
  const [a, m] = d.split('-').map(Number) as [number, number];
  return diasParaData(Date.UTC(a, m, 1) / 86_400_000 - 1);
}

export function registrarConsultas(roteador: Roteador): void {
  roteador.get('/api/timeline', 'autenticado', (ctx) => {
    const t = montarTimeline(ctx);
    const agora = agoraSaoPaulo();
    const periodos = listar(ctx.db, "SELECT id, nome, tipo, uf, cidade, data_inicial, data_final FROM periodos WHERE status = 'ativo' AND data_final >= ? AND data_inicial <= ? ORDER BY data_inicial", t.de, t.ate);
    return {
      periodo: { inicio: t.de, fim: t.ate }, hoje: agora.data, agora: agora.hora,
      profissionais: t.profissionais, itens: t.itens, periodos,
      total_conflitos: t.conflitos.length,
    };
  });

  roteador.get('/api/timeline/exportar', 'admin', (ctx) => {
    const t = montarTimeline(ctx);
    const nomes = new Map(t.profissionais.map((p) => [p.id, p.nome_completo]));
    // Uma linha por profissional (em vez de juntar todos numa única célula), agrupadas por nome,
    // para facilitar filtrar/ordenar cada profissional individualmente numa planilha.
    const linhas = t.itens
      .flatMap((i) => i.profissional_ids.map((pid) => ({ item: i, pid, nome: nomes.get(pid) ?? '' })))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR') || a.item.data_inicial.localeCompare(b.item.data_inicial))
      .map(({ item: i, pid, nome }) => [
        nome, rotulo(i.tipo), i.titulo, rotulo(i.status), formatarDataBR(i.data_inicial), formatarDataBR(i.data_final),
        i.hora_inicio ?? '', i.hora_fim ?? '', i.projeto_nome ?? '', i.local_nome ?? (i.remoto ? 'Remoto' : ''),
        i.conflitos.some((c) => c.profissional_id === pid) ? 'Sim' : 'Não',
      ]);
    return respostaCsv('linha-do-tempo.csv', montarCsv(
      ['Profissional', 'Tipo', 'Título', 'Situação', 'Data inicial', 'Data final', 'Início', 'Término', 'Projeto', 'Local', 'Conflito'], linhas));
  });

  roteador.get('/api/conflitos', 'autenticado', (ctx) => {
    const hoje = agoraSaoPaulo().data;
    const { de, ate } = periodoDaQuery(ctx, { inicio: hoje, fim: somarDias(hoje, 30) });
    const c = detectar(carregarOcupacoes(ctx.db, { de, ate }), { de, ate });
    return { periodo: { inicio: de, fim: ate }, total: c.length, dados: resumoConflitos(ctx.db, c) };
  });

  roteador.get('/api/dashboard', 'autenticado', (ctx) => {
    const db = ctx.db;
    const { data: hoje, hora } = agoraSaoPaulo();
    const { de, ate } = periodoDaQuery(ctx, { inicio: primeiroDoMes(hoje), fim: ultimoDoMes(hoje) });

    // Escalas com ocorrência em cada um dos próximos sete dias (a partir de amanhã).
    const janela = itensDoPeriodo(db, hoje, somarDias(hoje, 7)).filter((i) => i.tipo === 'escala' && i.status !== 'cancelada');
    const nomes = new Map<number, string>();
    for (const l of listar(db, 'SELECT id, nome_completo FROM profissionais')) nomes.set(l.id, l.nome_completo);
    const resumo = (i: ItemAgenda): Linha => ({
      id: i.id, titulo: i.titulo, status: i.status, hora_inicio: i.hora_inicio, hora_fim: i.hora_fim, vira_dia: i.vira_dia,
      projeto_nome: i.projeto_nome, local_nome: i.local_nome, remoto: i.remoto,
      profissionais: i.profissional_ids.map((p) => nomes.get(p)).filter(Boolean),
    });
    const naData = (i: ItemAgenda, d: string): boolean => i.data_inicial <= d && d <= i.data_final;
    const escalasHoje = janela.filter((i) => naData(i, hoje)).sort((x, y) => (x.hora_inicio ?? '').localeCompare(y.hora_inicio ?? '')).map(resumo);
    const proximosDias = Array.from({ length: 7 }, (_v, k) => {
      const d = somarDias(hoje, k + 1);
      const doDia = janela.filter((i) => naData(i, d)).sort((x, y) => (x.hora_inicio ?? '').localeCompare(y.hora_inicio ?? ''));
      return { data: d, total: doDia.length, escalas: doDia.slice(0, 5).map(resumo) };
    });

    const folgasPeriodo = listar(
      db,
      `SELECT f.id, f.tipo, f.data_inicial, f.data_final, p.nome_completo AS profissional_nome FROM folgas f
         JOIN profissionais p ON p.id = f.profissional_id
        WHERE f.status = 'aprovada' AND f.data_final >= ? AND f.data_inicial <= ? ORDER BY f.data_inicial, p.nome_completo`,
      de, ate,
    );
    const treinamentosProximos = listar(
      db,
      `SELECT t.id, t.nome, t.status, t.data_inicial, t.data_final, t.hora_inicio, t.hora_fim, t.remoto, l.nome AS local_nome,
              (SELECT COUNT(*) FROM treinamento_profissionais v WHERE v.treinamento_id = t.id) AS total_profissionais
         FROM treinamentos t LEFT JOIN locais l ON l.id = t.local_id
        WHERE t.status IN ('planejado', 'confirmado') AND t.data_final >= ? AND t.data_inicial <= ?
        ORDER BY t.data_inicial LIMIT 8`,
      hoje, somarDias(hoje, 30),
    ).map((t) => ({ ...t, remoto: t.remoto === 1 }));

    const feriadosProximos = listar(
      db,
      `SELECT id, nome, tipo, uf, cidade, data_inicial, data_final FROM periodos
        WHERE status = 'ativo' AND data_final >= ? AND data_inicial <= ? ORDER BY data_inicial, nome LIMIT 10`,
      hoje, somarDias(hoje, 60),
    );

    const limite = somarDias(hoje, 30);
    const conflitos = detectar(carregarOcupacoes(db, { de: hoje, ate: limite }), { de: hoje, ate: limite });
    const count = (sql: string): number => Number(obter(db, sql)!.n);

    return {
      hoje, agora: hora, periodo: { inicio: de, fim: ate },
      demo: obter(db, "SELECT valor FROM configuracoes WHERE chave = 'dados_demo'")?.valor === '1',
      contagens: {
        profissionais_ativos: count("SELECT COUNT(*) AS n FROM profissionais WHERE status = 'ativo'"),
        projetos_ativos: count("SELECT COUNT(*) AS n FROM projetos WHERE status = 'ativo'"),
        escalas_hoje: escalasHoje.length,
        folgas_aprovadas_periodo: folgasPeriodo.length,
        treinamentos_proximos: treinamentosProximos.length,
        conflitos: conflitos.length,
      },
      escalas_hoje: escalasHoje, proximos_dias: proximosDias, folgas_periodo: folgasPeriodo.slice(0, 10),
      treinamentos_proximos: treinamentosProximos,
      feriados_proximos: feriadosProximos,
      conflitos: resumoConflitos(db, conflitos).slice(0, 8),
    };
  });

  // Listas leves para filtros e seleções nos formulários.
  roteador.get('/api/opcoes', 'autenticado', (ctx) => {
    const admin = ctx.user!.perfil === 'administrador';
    const db = ctx.db;
    return {
      profissionais: listar(db, `SELECT id, nome_completo AS nome, cargo, uf, cidade, status FROM profissionais ${admin ? '' : "WHERE status = 'ativo'"} ORDER BY nome_completo COLLATE NOCASE`),
      projetos: listar(db, 'SELECT id, nome, codigo, status, remoto FROM projetos ORDER BY nome COLLATE NOCASE').map((p) => ({ ...p, remoto: p.remoto === 1 })),
      locais: listar(db, 'SELECT id, nome, cidade, uf, status, tipo FROM locais ORDER BY nome COLLATE NOCASE'),
      horarios: listar(db, 'SELECT id, nome, hora_inicio, hora_fim, vira_dia, status FROM horarios ORDER BY hora_inicio').map((h) => ({ ...h, vira_dia: h.vira_dia === 1 })),
    };
  });
}
