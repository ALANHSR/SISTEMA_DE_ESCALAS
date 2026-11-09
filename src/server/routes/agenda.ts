import type { Ctx, Roteador } from '../http.ts';
import { HttpError } from '../http.ts';
import type { Linha } from '../db.ts';
import { executar, listar, marcadores, obter } from '../db.ts';
import type { Definicao } from '../recursos.ts';
import { registrarRecurso } from '../recursos.ts';
import { registrarAuditoria } from '../auditoria.ts';
import type { Erros } from '../validacao.ts';
import {
  checarProfissionais, checarReferencia, duracaoMinutos, lancarValidacao, regrasDePeriodo, temErros,
} from '../regras.ts';
import type { Ocupacao, TipoAgenda } from '../conflitos.ts';
import { conflitosDoCandidato, conflitosParaApi, ocupacoesSalvas, parseDiasSemana } from '../conflitos.ts';
import { dataValida, formatarDataBR, horaParaMinutos, horaValida } from '../../shared/datetime.ts';
import type { SlotTreinamento } from '../treinamento_horarios.ts';
import { carregarSlots, contarEncontros, fimDoEncontro, ocupacoesDoTreinamento } from '../treinamento_horarios.ts';

/** Um registro por período de até 366 dias (limita o tamanho da grade de dias de uma escala e a
 *  expansão diária usada na detecção de conflitos de folga/treinamento). */
const MAX_DIAS = 366;

const EXPORT_STATUS = { campo: 'status', rotulo: 'Situação', tipo: 'rotulo' } as const;
const ehAdmin = (ctx: Ctx): boolean => ctx.user?.perfil === 'administrador';
/** Converte a coluna dias_semana (string "1,2,3,4,5" ou null) para a lista de números usada pela API. */
const comDiasSemana = (l: Linha): Linha => ({ ...l, dias_semana: parseDiasSemana(l.dias_semana) });

/** Regra 8: bloqueia (409) quando há conflito, a menos que o administrador confirme com `forcar`.
 *  Aceita um candidato único (folga/treinamento) ou uma lista (escala: uma célula da grade por item). */
function verificarConflitos(ctx: Ctx, candidato: Ocupacao | Ocupacao[], forcar: boolean): void {
  const lista = Array.isArray(candidato) ? candidato : [candidato];
  if (lista.length === 0) return;
  const conflitos = conflitosDoCandidato(ctx.db, lista);
  if (conflitos.length === 0 || forcar) return;
  const apiLista = conflitosParaApi(ctx.db, conflitos, lista[0]!);
  throw new HttpError(
    409, 'conflito',
    `Há ${apiLista.length === 1 ? '1 conflito' : `${apiLista.length} conflitos`} de agenda. Ajuste as datas, os horários ou os profissionais, ou confirme para salvar mesmo assim.`,
    { conflitos: apiLista, pode_forcar: true },
  );
}

/** Após salvar com `forcar`, registra na auditoria que o conflito foi aceito. */
function auditarConflitoForcado(ctx: Ctx, tipo: TipoAgenda, id: number, forcar: boolean): void {
  if (!forcar) return;
  const salvas = ocupacoesSalvas(ctx.db, tipo, id);
  if (salvas.length === 0) return;
  const c = conflitosDoCandidato(ctx.db, salvas);
  if (c.length === 0) return;
  registrarAuditoria(ctx.db, {
    entidade: `${tipo === 'escala' ? 'escalas' : tipo === 'folga' ? 'folgas' : 'treinamentos'}`, registroId: id, acao: 'conflito_forcado', usuario: ctx.user,
    detalhes: { conflitos: conflitosParaApi(ctx.db, c, salvas[0]!).map((x) => x.mensagem) },
  });
}

function filtroPeriodo(ctx: Ctx, where: string[], params: unknown[]): void {
  const ini = ctx.query.get('inicio');
  const fim = ctx.query.get('fim');
  // Sobreposição de intervalos: funciona para períodos que atravessam meses e anos (regra 13).
  if (dataValida(ini)) { where.push('t.data_final >= ?'); params.push(ini); }
  if (dataValida(fim)) { where.push('t.data_inicial <= ?'); params.push(fim); }
}

function filtroProfissional(ctx: Ctx, tabelaVinculo: string, fk: string, where: string[], params: unknown[]): void {
  const pid = Number(ctx.query.get('profissional_id'));
  if (pid > 0) {
    where.push(`EXISTS (SELECT 1 FROM ${tabelaVinculo} v WHERE v.${fk} = t.id AND v.profissional_id = ?)`);
    params.push(pid);
  }
}

const nomeProfissionais = (tabela: string, fk: string): string =>
  `(SELECT group_concat(p.nome_completo, ', ') FROM ${tabela} v JOIN profissionais p ON p.id = v.profissional_id WHERE v.${fk} = t.id)`;

function filtroLocal(ctx: Ctx, tabelaVinculo: string, fk: string, where: string[], params: unknown[]): void {
  const lid = Number(ctx.query.get('local_id'));
  if (lid > 0) {
    where.push(`EXISTS (SELECT 1 FROM ${tabelaVinculo} v WHERE v.${fk} = t.id AND v.local_id = ?)`);
    params.push(lid);
  }
}

// ---------------------------------------------------------------- Escalas
const STATUS_ESCALA_CONFIRMADA = ['confirmada', 'em_andamento', 'concluida'];

interface CelulaGrade { profissional_id: number; data: string; horario_id: number }

/** Distintos, sem repetir o mesmo nome a cada dia em que a pessoa aparece na grade. */
const nomeProfissionaisDistintos = (tabela: string, fk: string): string =>
  `(SELECT group_concat(nome, ', ') FROM (SELECT DISTINCT p.nome_completo AS nome FROM ${tabela} v JOIN profissionais p ON p.id = v.profissional_id WHERE v.${fk} = t.id ORDER BY nome))`;

export const escalas: Definicao = {
  nome: 'escalas',
  tabela: 'escalas',
  rotulo: 'Escala',
  esquema: {
    titulo: { tipo: 'string', rotulo: 'Título', obrigatorio: true, min: 3, max: 120 },
    projeto_id: { tipo: 'id', rotulo: 'Projeto' },
    local_ids: { tipo: 'listaIds', rotulo: 'Locais' },
    data_inicial: { tipo: 'data', rotulo: 'Data inicial', obrigatorio: true },
    data_final: { tipo: 'data', rotulo: 'Data final', obrigatorio: true },
    // Grade profissional × dia × horário (quarto pedido de ajustes, outubro): cada item é uma célula
    // preenchida — {profissional_id, data, horario_id} —, validada e gravada em `escala_dias` por
    // `ganchos.negocio`/`ganchos.posSalvar` abaixo. Não é uma coluna de `escalas` (ver ignorarNaPersistencia).
    dias: { tipo: 'json', rotulo: 'Grade de dias' },
    status: { tipo: 'enum', rotulo: 'Situação', valores: ['planejada', 'confirmada', 'em_andamento', 'concluida', 'cancelada'], padrao: 'planejada' },
    descricao: { tipo: 'texto', rotulo: 'Descrição' },
    observacoes: { tipo: 'texto', rotulo: 'Observações' },
  },
  ignorarNaPersistencia: ['dias'],
  relacoes: [{
    campo: 'local_ids', tabela: 'escala_locais', fkPropria: 'escala_id', fkOutra: 'local_id',
    tabelaOutra: 'locais', colunaNome: 'nome', chaveDetalhe: 'locais',
  }],
  colunasBool: [],
  busca: ['t.titulo', '(SELECT nome FROM projetos WHERE id = t.projeto_id)', '(SELECT codigo FROM projetos WHERE id = t.projeto_id)', '(SELECT group_concat(l.nome, \', \') FROM escala_locais el JOIN locais l ON l.id = el.local_id WHERE el.escala_id = t.id)', nomeProfissionaisDistintos('escala_dias', 'escala_id')],
  ordenaveis: { titulo: 't.titulo COLLATE NOCASE', data_inicial: 't.data_inicial', data_final: 't.data_final', status: 't.status', projeto_nome: 'projeto_nome COLLATE NOCASE', locais_nomes: 'locais_nomes COLLATE NOCASE' },
  ordemPadrao: 'data_inicial',
  dirPadrao: 'desc',
  filtros: { status: 't.status', projeto_id: 't.projeto_id' },
  selectExtra: `(SELECT nome FROM projetos WHERE id = t.projeto_id) AS projeto_nome,
    (SELECT group_concat(l.nome, ', ') FROM escala_locais el JOIN locais l ON l.id = el.local_id WHERE el.escala_id = t.id) AS locais_nomes,
    ${nomeProfissionaisDistintos('escala_dias', 'escala_id')} AS profissionais_nomes,
    (SELECT COUNT(DISTINCT profissional_id) FROM escala_dias WHERE escala_id = t.id) AS total_profissionais,
    (SELECT COUNT(*) FROM escala_dias WHERE escala_id = t.id) AS total_dias`,
  exportacao: [
    { campo: 'titulo', rotulo: 'Título' }, { campo: 'projeto_nome', rotulo: 'Projeto' }, { campo: 'locais_nomes', rotulo: 'Locais' },
    { campo: 'data_inicial', rotulo: 'Data inicial', tipo: 'data' }, { campo: 'data_final', rotulo: 'Data final', tipo: 'data' },
    EXPORT_STATUS, { campo: 'profissionais_nomes', rotulo: 'Profissionais' }, { campo: 'total_dias', rotulo: 'Dias preenchidos na grade' },
  ],
  ganchos: {
    filtrarLista: (ctx) => {
      const where: string[] = [];
      const params: unknown[] = [];
      filtroPeriodo(ctx, where, params);
      filtroProfissional(ctx, 'escala_dias', 'escala_id', where, params);
      filtroLocal(ctx, 'escala_locais', 'escala_id', where, params);
      return { where, params };
    },
    // Sem isto, reenviar o registro atual sem tocar na grade (ex.: POST /:id/status, que só muda a
    // situação) apagaria todas as células, pois `dias` não é uma coluna simples nem uma `relacao` —
    // mesma categoria do bug já corrigido antes para campos "diasSemana" (ver recursos.ts).
    carregarExtra: (db, id) => ({
      dias: listar(db, 'SELECT profissional_id, data, horario_id FROM escala_dias WHERE escala_id = ?', id),
    }),
    negocio: ({ ctx, dados, existente, forcar }) => {
      const db = ctx.db;
      const erros: Erros = {};
      regrasDePeriodo(dados, erros, MAX_DIAS);
      const projeto = checarReferencia(db, erros, { tabela: 'projetos', campo: 'projeto_id', id: dados.projeto_id, rotulo: 'Projeto', novoVinculo: dados.projeto_id !== existente?.projeto_id });
      const localIds = (dados.local_ids as number[]) ?? [];
      const localesAnteriores = (existente?.local_ids as number[] | undefined) ?? [];
      for (const lid of localIds) {
        checarReferencia(db, erros, { tabela: 'locais', campo: 'local_ids', id: lid, rotulo: 'Locais', novoVinculo: !localesAnteriores.includes(lid) });
      }

      // Validação da grade de dias: cada item precisa de um profissional, uma data dentro do período
      // e um horário cadastrado; sem duplicar profissional+data (a tabela também tem essa restrição,
      // mas aqui a mensagem fica no mesmo tom das demais validações do sistema).
      const brutos = Array.isArray(dados.dias) ? (dados.dias as Linha[]) : [];
      const celulas: CelulaGrade[] = [];
      if (!erros.data_inicial && !erros.data_final) {
        const vistos = new Set<string>();
        brutos.forEach((c, i) => {
          const profissionalId = Number(c.profissional_id);
          const horarioId = Number(c.horario_id);
          const data = typeof c.data === 'string' ? c.data : '';
          if (!Number.isInteger(profissionalId) || profissionalId <= 0 || !Number.isInteger(horarioId) || horarioId <= 0 || !dataValida(data)) {
            erros.dias ??= `Grade de dias: item ${i + 1} inválido (profissional, data e horário são obrigatórios em cada célula preenchida).`;
            return;
          }
          if (data < (dados.data_inicial as string) || data > (dados.data_final as string)) {
            erros.dias ??= `Grade de dias: a data ${formatarDataBR(data)} está fora do período informado (${formatarDataBR(dados.data_inicial as string)} a ${formatarDataBR(dados.data_final as string)}).`;
            return;
          }
          const chave = `${profissionalId}|${data}`;
          if (vistos.has(chave)) {
            erros.dias ??= `Grade de dias: já existe um horário definido para este profissional em ${formatarDataBR(data)}.`;
            return;
          }
          vistos.add(chave);
          celulas.push({ profissional_id: profissionalId, data, horario_id: horarioId });
        });
      }

      // Regra 1 (profissionais inativos não recebem novos vínculos) aplicada aos profissionais da grade.
      const profIds = [...new Set(celulas.map((c) => c.profissional_id))];
      const anteriores = existente
        ? listar(db, 'SELECT DISTINCT profissional_id AS id FROM escala_dias WHERE escala_id = ?', existente.id).map((l) => l.id as number)
        : [];
      checarProfissionais(db, erros, 'dias', profIds, anteriores);

      // Horário de cada célula: precisa existir e, se for um vínculo novo (profissional+data novos
      // nesta escala), não pode estar inativo.
      const horarioIds = [...new Set(celulas.map((c) => c.horario_id))];
      let horarios = new Map<number, Linha>();
      if (horarioIds.length) {
        horarios = new Map(listar(db, `SELECT id, status, hora_inicio, hora_fim, vira_dia FROM horarios WHERE id IN (${marcadores(horarioIds.length)})`, ...horarioIds).map((h) => [h.id as number, h]));
        const inexistentes = horarioIds.filter((hid) => !horarios.has(hid));
        if (inexistentes.length) erros.dias ??= 'Grade de dias: um ou mais horários selecionados não foram encontrados.';
        const horariosAnteriores = existente
          ? listar(db, 'SELECT DISTINCT horario_id AS id FROM escala_dias WHERE escala_id = ?', existente.id).map((l) => l.id as number)
          : [];
        const inativosNovos = horarioIds.filter((hid) => horarios.get(hid) && horarios.get(hid)!.status !== 'ativo' && !horariosAnteriores.includes(hid));
        if (inativosNovos.length) erros.dias ??= 'Grade de dias: um ou mais horários selecionados estão inativos e não aceitam novos vínculos.';
      }

      // Regras 3 e 4: para confirmar, a escala precisa de projeto, ao menos uma célula preenchida na
      // grade e local (exceto quando o projeto é remoto/sem local definido). Período já é obrigatório.
      if (STATUS_ESCALA_CONFIRMADA.includes(dados.status)) {
        if (!dados.projeto_id) erros.projeto_id ??= 'Projeto: informe o projeto antes de confirmar a escala.';
        if (celulas.length === 0) erros.dias ??= 'Grade de dias: preencha ao menos um dia de ao menos um profissional antes de confirmar a escala.';
        const semLocalPermitido = projeto?.remoto === 1;
        if (localIds.length === 0 && !semLocalPermitido) erros.local_ids ??= 'Locais: informe ao menos um local antes de confirmar, ou marque o projeto como remoto/sem local definido.';
      }
      if (temErros(erros)) lancarValidacao(erros);

      const candidatos: Ocupacao[] = celulas.map((c) => {
        const h = horarios.get(c.horario_id)!;
        return { tipo: 'escala', id: existente?.id ?? 0, titulo: dados.titulo as string, status: dados.status as string, profissional_ids: [c.profissional_id],
          data_inicial: c.data, data_final: c.data, hora_inicio: h.hora_inicio, hora_fim: h.hora_fim, vira_dia: h.vira_dia === 1, dias_semana: null };
      });
      verificarConflitos(ctx, candidatos, forcar);

      // A grade já validada substitui a entrada bruta — `ganchos.posSalvar` grava essas células.
      dados.dias = celulas;
    },
    posSalvar: ({ ctx, dados, id, forcar }) => {
      const db = ctx.db;
      const celulas = dados.dias as CelulaGrade[];
      const antes = listar(db, 'SELECT profissional_id, data, horario_id FROM escala_dias WHERE escala_id = ? ORDER BY profissional_id, data', id);
      const canon = (l: { profissional_id: number; data: string; horario_id: number }[]): string =>
        JSON.stringify([...l].sort((x, y) => (x.profissional_id - y.profissional_id) || x.data.localeCompare(y.data)));
      const mudou = canon(antes as CelulaGrade[]) !== canon(celulas);

      executar(db, 'DELETE FROM escala_dias WHERE escala_id = ?', id);
      const agora = new Date().toISOString();
      for (const c of celulas) {
        executar(
          db,
          `INSERT INTO escala_dias (escala_id, profissional_id, data, horario_id, criado_em, atualizado_em, criado_por, atualizado_por)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          id, c.profissional_id, c.data, c.horario_id, agora, agora, ctx.user!.id, ctx.user!.id,
        );
      }
      if (mudou) {
        registrarAuditoria(db, {
          entidade: 'escalas', registroId: id, acao: 'atualizou_grade', usuario: ctx.user,
          detalhes: { total_antes: antes.length, total_depois: celulas.length },
        });
      }
      auditarConflitoForcado(ctx, 'escala', id, forcar);
    },
    detalhe: (ctx, reg) => {
      const linhas = listar(
        ctx.db,
        `SELECT ed.profissional_id, p.nome_completo AS profissional_nome, p.status AS profissional_status,
                ed.data, ed.horario_id, h.nome AS horario_nome, h.hora_inicio, h.hora_fim, h.vira_dia
           FROM escala_dias ed
           JOIN profissionais p ON p.id = ed.profissional_id
           JOIN horarios h ON h.id = ed.horario_id
          WHERE ed.escala_id = ?
          ORDER BY p.nome_completo COLLATE NOCASE, ed.data`,
        reg.id,
      );
      reg.dias = linhas.map((l) => ({ ...l, vira_dia: l.vira_dia === 1 }));
      const profissionais = new Map<number, Linha>();
      for (const l of linhas) {
        if (!profissionais.has(l.profissional_id)) {
          profissionais.set(l.profissional_id, { id: l.profissional_id, nome: l.profissional_nome, status: l.profissional_status });
        }
      }
      reg.profissionais = [...profissionais.values()];
      return detalheAgenda(ctx, reg, 'escala');
    },
  },
};

function detalheAgenda(ctx: Ctx, reg: Linha, tipo: TipoAgenda): Linha {
  const db = ctx.db;
  if (reg.projeto_id) reg.projeto = obter(db, 'SELECT id, nome, codigo, remoto, status FROM projetos WHERE id = ?', reg.projeto_id);
  if (reg.local_id) reg.local = obter(db, 'SELECT id, nome, endereco, cidade, uf, status FROM locais WHERE id = ?', reg.local_id);
  const localIds = reg.local_ids as number[] | undefined;
  if (localIds?.length) {
    reg.locais = listar(db, `SELECT id, nome, endereco, cidade, uf, status FROM locais WHERE id IN (${marcadores(localIds.length)})`, ...localIds);
  }
  const salvas = ocupacoesSalvas(db, tipo, reg.id);
  reg.conflitos = salvas.length ? conflitosParaApi(db, conflitosDoCandidato(db, salvas), { tipo, id: reg.id }) : [];
  return reg;
}

// ---------------------------------------------------------------- Folgas
export const folgas: Definicao = {
  nome: 'folgas',
  tabela: 'folgas',
  rotulo: 'Folga',
  esquema: {
    profissional_id: { tipo: 'id', rotulo: 'Profissional', obrigatorio: true },
    tipo: { tipo: 'enum', rotulo: 'Tipo de folga', obrigatorio: true, valores: ['folga_compensatoria', 'folga_semanal', 'ferias', 'licenca', 'banco_de_horas', 'outro'] },
    data_inicial: { tipo: 'data', rotulo: 'Data inicial', obrigatorio: true },
    data_final: { tipo: 'data', rotulo: 'Data final', obrigatorio: true },
    dias_semana: { tipo: 'diasSemana', rotulo: 'Dias da semana' },
    status: { tipo: 'enum', rotulo: 'Situação', valores: ['solicitada', 'aprovada', 'recusada', 'cancelada'], padrao: 'solicitada' },
    motivo: { tipo: 'texto', rotulo: 'Motivo ou observação' },
  },
  relacoes: [],
  colunasBool: [],
  busca: ['(SELECT nome_completo FROM profissionais WHERE id = t.profissional_id)', 't.motivo'],
  ordenaveis: { profissional_nome: 'profissional_nome COLLATE NOCASE', data_inicial: 't.data_inicial', data_final: 't.data_final', tipo: 't.tipo', status: 't.status' },
  ordemPadrao: 'data_inicial',
  dirPadrao: 'desc',
  filtros: { status: 't.status', tipo: 't.tipo', profissional_id: 't.profissional_id' },
  selectExtra: `(SELECT nome_completo FROM profissionais WHERE id = t.profissional_id) AS profissional_nome,
    (SELECT nome FROM usuarios WHERE id = t.aprovado_por) AS aprovado_por_nome`,
  exportacao: [
    { campo: 'profissional_nome', rotulo: 'Profissional' }, { campo: 'tipo', rotulo: 'Tipo', tipo: 'rotulo' },
    { campo: 'data_inicial', rotulo: 'Data inicial', tipo: 'data' }, { campo: 'data_final', rotulo: 'Data final', tipo: 'data' },
    EXPORT_STATUS, { campo: 'aprovado_por_nome', rotulo: 'Decidido por' },
  ],
  ganchos: {
    filtrarLista: (ctx) => {
      const where: string[] = [];
      const params: unknown[] = [];
      filtroPeriodo(ctx, where, params);
      return { where, params };
    },
    // O motivo pode conter dado sensível (ex.: licença médica): só administradores o veem.
    transformarLinha: (ctx, l) => comDiasSemana(ehAdmin(ctx) ? l : { ...l, motivo: null }),
    negocio: ({ ctx, dados, existente, forcar }) => {
      const erros: Erros = {};
      regrasDePeriodo(dados, erros);
      checarReferencia(ctx.db, erros, { tabela: 'profissionais', campo: 'profissional_id', id: dados.profissional_id, rotulo: 'Profissional', novoVinculo: dados.profissional_id !== existente?.profissional_id });
      if (temErros(erros)) lancarValidacao(erros);
      verificarConflitos(ctx, {
        tipo: 'folga', id: existente?.id ?? 0, titulo: 'Folga', status: dados.status, profissional_ids: [dados.profissional_id],
        data_inicial: dados.data_inicial, data_final: dados.data_final, hora_inicio: null, hora_fim: null, vira_dia: false,
        dias_semana: parseDiasSemana(dados.dias_semana),
      }, forcar);
    },
    // Registra quem aprovou/recusou e quando (regra: usuário responsável pela aprovação).
    colunasExtras: ({ ctx, dados, existente }) => {
      const decidiu = dados.status === 'aprovada' || dados.status === 'recusada';
      if (decidiu && existente?.status !== dados.status) return { aprovado_por: ctx.user!.id, aprovado_em: new Date().toISOString() };
      if (dados.status === 'solicitada') return { aprovado_por: null, aprovado_em: null };
      return {};
    },
    posSalvar: ({ ctx, id, forcar }) => auditarConflitoForcado(ctx, 'folga', id, forcar),
    detalhe: (ctx, reg) => {
      reg.profissional = obter(ctx.db, 'SELECT id, nome_completo AS nome, status FROM profissionais WHERE id = ?', reg.profissional_id);
      reg.aprovado_por_nome = reg.aprovado_por ? (obter(ctx.db, 'SELECT nome FROM usuarios WHERE id = ?', reg.aprovado_por)?.nome ?? null) : null;
      return detalheAgenda(ctx, reg, 'folga');
    },
  },
};

// ---------------------------------------------------------------- Treinamentos
/** Entrada bruta de um horário de participante: {profissional_id, dias_semana: number[]|null, hora_inicio}. */
function normalizarHorariosTreinamento(brutos: Linha[], erros: Erros): SlotTreinamento[] {
  const slots: SlotTreinamento[] = [];
  brutos.forEach((h, i) => {
    const pid = Number(h.profissional_id);
    const hora = typeof h.hora_inicio === 'string' ? h.hora_inicio : '';
    let dias: number[] | null = null;
    if (Array.isArray(h.dias_semana)) {
      dias = [...new Set((h.dias_semana as unknown[]).map(Number))].sort((x, y) => x - y);
      if (dias.some((n) => !Number.isInteger(n) || n < 0 || n > 6)) { erros.horarios ??= `Participantes e horários: item ${i + 1} tem dia da semana inválido.`; return; }
      if (dias.length === 0) { erros.horarios ??= `Participantes e horários: item ${i + 1} — marque ao menos um dia da semana.`; return; }
      if (dias.length === 7) dias = null;
    } else if (h.dias_semana !== null && h.dias_semana !== undefined) {
      erros.horarios ??= `Participantes e horários: item ${i + 1} tem dias da semana inválidos.`; return;
    }
    if (!Number.isInteger(pid) || pid <= 0) { erros.horarios ??= `Participantes e horários: item ${i + 1} sem profissional.`; return; }
    if (!horaValida(hora)) { erros.horarios ??= `Participantes e horários: item ${i + 1} — informe o horário de início (HH:MM).`; return; }
    slots.push({ profissional_id: pid, dias_semana: dias, hora_inicio: hora });
  });
  return slots;
}

export const treinamentos: Definicao = {
  nome: 'treinamentos',
  tabela: 'treinamentos',
  rotulo: 'Treinamento',
  esquema: {
    nome: { tipo: 'string', rotulo: 'Nome', obrigatorio: true, min: 3, max: 120 },
    descricao: { tipo: 'texto', rotulo: 'Descrição' },
    instrutor: { tipo: 'string', rotulo: 'Instrutor ou responsável', max: 120 },
    projeto_id: { tipo: 'id', rotulo: 'Projeto' },
    local_id: { tipo: 'id', rotulo: 'Local' },
    remoto: { tipo: 'bool', rotulo: 'Treinamento remoto' },
    data_inicial: { tipo: 'data', rotulo: 'Data inicial', obrigatorio: true },
    data_final: { tipo: 'data', rotulo: 'Data final', obrigatorio: true },
    // Sexto pedido de ajustes: duração de CADA encontro; início e dias de cada participante ficam em
    // `horarios` (gravado em treinamento_horarios por ganchos.posSalvar).
    duracao_minutos: { tipo: 'inteiro', rotulo: 'Duração de cada encontro (minutos)', min: 1, max: 1439 },
    horarios: { tipo: 'json', rotulo: 'Participantes e horários' },
    // Resumo do registro, preenchido pelo sistema (menor horário de início e seu término); aceitos
    // na entrada só para compatibilidade com o formato anterior (um horário e uma recorrência para todos).
    hora_inicio: { tipo: 'hora', rotulo: 'Horário de início' },
    hora_fim: { tipo: 'hora', rotulo: 'Horário de término' },
    vira_dia: { tipo: 'bool', rotulo: 'Virada de dia' },
    dias_semana: { tipo: 'diasSemana', rotulo: 'Dias da semana' },
    status: { tipo: 'enum', rotulo: 'Situação', valores: ['planejado', 'confirmado', 'concluido', 'cancelado'], padrao: 'planejado' },
    profissional_ids: { tipo: 'listaIds', rotulo: 'Participantes' },
    observacoes: { tipo: 'texto', rotulo: 'Observações' },
  },
  ignorarNaPersistencia: ['horarios'],
  relacoes: [{
    campo: 'profissional_ids', tabela: 'treinamento_profissionais', fkPropria: 'treinamento_id', fkOutra: 'profissional_id',
    tabelaOutra: 'profissionais', colunaNome: 'nome_completo', chaveDetalhe: 'profissionais',
  }],
  colunasBool: ['remoto', 'vira_dia'],
  busca: ['t.nome', 't.instrutor', '(SELECT nome FROM projetos WHERE id = t.projeto_id)', '(SELECT nome FROM locais WHERE id = t.local_id)', nomeProfissionais('treinamento_profissionais', 'treinamento_id')],
  ordenaveis: { nome: 't.nome COLLATE NOCASE', data_inicial: 't.data_inicial', data_final: 't.data_final', status: 't.status', local_nome: 'local_nome COLLATE NOCASE', projeto_nome: 'projeto_nome COLLATE NOCASE' },
  ordemPadrao: 'data_inicial',
  dirPadrao: 'desc',
  filtros: { status: 't.status', local_id: 't.local_id', remoto: 't.remoto', projeto_id: 't.projeto_id' },
  selectExtra: `(SELECT nome FROM locais WHERE id = t.local_id) AS local_nome,
    (SELECT nome FROM projetos WHERE id = t.projeto_id) AS projeto_nome,
    ${nomeProfissionais('treinamento_profissionais', 'treinamento_id')} AS profissionais_nomes,
    (SELECT COUNT(*) FROM treinamento_profissionais v WHERE v.treinamento_id = t.id) AS total_profissionais`,
  exportacao: [
    { campo: 'nome', rotulo: 'Nome' }, { campo: 'instrutor', rotulo: 'Instrutor' }, { campo: 'projeto_nome', rotulo: 'Projeto' }, { campo: 'local_nome', rotulo: 'Local' },
    { campo: 'remoto', rotulo: 'Remoto', tipo: 'bool' }, { campo: 'data_inicial', rotulo: 'Data inicial', tipo: 'data' },
    { campo: 'data_final', rotulo: 'Data final', tipo: 'data' }, { campo: 'duracao_minutos', rotulo: 'Duração do encontro (min)' },
    EXPORT_STATUS, { campo: 'profissionais_nomes', rotulo: 'Participantes' },
  ],
  ganchos: {
    filtrarLista: (ctx) => {
      const where: string[] = [];
      const params: unknown[] = [];
      filtroPeriodo(ctx, where, params);
      filtroProfissional(ctx, 'treinamento_profissionais', 'treinamento_id', where, params);
      return { where, params };
    },
    transformarLinha: (_ctx, l) => comDiasSemana(l),
    // Sem isto, reenviar o registro sem tocar nos horários (ex.: POST /:id/status) apagaria todos.
    carregarExtra: (db, id) => ({
      horarios: (carregarSlots(db, [id]).get(id) ?? []).map((h) => ({ profissional_id: h.profissional_id, dias_semana: h.dias_semana, hora_inicio: h.hora_inicio })),
    }),
    negocio: ({ ctx, dados, existente, forcar }) => {
      const db = ctx.db;
      const erros: Erros = {};
      regrasDePeriodo(dados, erros, MAX_DIAS);

      // Formato anterior (um horário + dias para todos os participantes) vira horários individuais.
      let brutos = Array.isArray(dados.horarios) ? (dados.horarios as Linha[]) : [];
      let duracao = dados.duracao_minutos as number | null;
      if (brutos.length === 0 && dados.hora_inicio && dados.hora_fim && (dados.profissional_ids as number[]).length) {
        duracao ??= Math.max(1, duracaoMinutos(dados.hora_inicio, dados.hora_fim, dados.vira_dia));
        const dias = parseDiasSemana(dados.dias_semana);
        brutos = (dados.profissional_ids as number[]).map((pid) => ({ profissional_id: pid, dias_semana: dias, hora_inicio: dados.hora_inicio }));
      }
      if (!duracao) erros.duracao_minutos ??= 'Duração de cada encontro (minutos): campo obrigatório.';
      if (brutos.length === 0) erros.horarios ??= 'Participantes e horários: adicione ao menos um profissional com seus dias e horários.';
      const slots = erros.horarios ? [] : normalizarHorariosTreinamento(brutos, erros);

      if (!erros.horarios && !erros.duracao_minutos && !erros.data_inicial && !erros.data_final) {
        const nomeProf = (pid: number): string => (obter(db, 'SELECT nome_completo FROM profissionais WHERE id = ?', pid)?.nome_completo as string | undefined) ?? `Profissional ${pid}`;
        // Cada horário precisa ter ao menos um encontro no período, e os de um mesmo profissional não podem se sobrepor.
        for (const sl of slots) {
          if (contarEncontros(dados.data_inicial, dados.data_final, sl.dias_semana) === 0) {
            erros.horarios ??= `Participantes e horários: ${nomeProf(sl.profissional_id)} às ${sl.hora_inicio} não tem nenhum encontro no período (confira os dias da semana).`;
          }
        }
        const ocs = ocupacoesDoTreinamento({ id: 0, nome: '', status: '', data_inicial: dados.data_inicial, data_final: dados.data_final, duracao_minutos: duracao! }, slots);
        for (let i = 0; i < ocs.length && !erros.horarios; i++) {
          for (let j = i + 1; j < ocs.length; j++) {
            const a = ocs[i]!; const b = ocs[j]!;
            if (a.profissional_ids[0] !== b.profissional_ids[0]) continue;
            const diasA = a.dias_semana ?? [0, 1, 2, 3, 4, 5, 6]; const diasB = b.dias_semana ?? [0, 1, 2, 3, 4, 5, 6];
            if (!diasA.some((d) => diasB.includes(d))) continue;
            const ia = horaParaMinutos(a.hora_inicio!); const ib = horaParaMinutos(b.hora_inicio!);
            if (ia < ib + duracao! && ib < ia + duracao!) {
              erros.horarios = `Participantes e horários: ${nomeProf(a.profissional_ids[0]!)} tem dois horários que se sobrepõem (${a.hora_inicio} e ${b.hora_inicio}) no mesmo dia da semana.`;
              break;
            }
          }
        }
      }

      const ids = [...new Set(slots.map((sl) => sl.profissional_id))];
      checarProfissionais(db, erros, 'horarios', ids, (existente?.profissional_ids as number[] | undefined) ?? []);
      checarReferencia(db, erros, { tabela: 'projetos', campo: 'projeto_id', id: dados.projeto_id, rotulo: 'Projeto', novoVinculo: dados.projeto_id !== existente?.projeto_id });
      checarReferencia(db, erros, { tabela: 'locais', campo: 'local_id', id: dados.local_id, rotulo: 'Local', novoVinculo: dados.local_id !== existente?.local_id });
      if (dados.remoto && dados.local_id) erros.local_id ??= 'Local: treinamento remoto não tem local físico. Desmarque "remoto" ou remova o local.';
      if (['confirmado', 'concluido'].includes(dados.status) && !dados.remoto && !dados.local_id) {
        erros.local_id ??= 'Local: informe o local ou marque o treinamento como remoto antes de confirmar.';
      }
      if (temErros(erros)) lancarValidacao(erros);

      // Resumo do registro (colunas antigas): menor horário de início e o término do seu encontro.
      const menor = [...slots].sort((x, y) => horaParaMinutos(x.hora_inicio) - horaParaMinutos(y.hora_inicio))[0]!;
      const { hora_fim, vira_dia } = fimDoEncontro(menor.hora_inicio, duracao!);
      dados.duracao_minutos = duracao;
      dados.hora_inicio = menor.hora_inicio;
      dados.hora_fim = hora_fim;
      dados.vira_dia = vira_dia;
      dados.dias_semana = null;
      dados.profissional_ids = ids;
      dados.horarios = slots;

      verificarConflitos(ctx, ocupacoesDoTreinamento(
        { id: existente?.id ?? 0, nome: dados.nome, status: dados.status, data_inicial: dados.data_inicial, data_final: dados.data_final, duracao_minutos: duracao! }, slots,
      ), forcar);
    },
    posSalvar: ({ ctx, dados, id, forcar }) => {
      const db = ctx.db;
      const slots = dados.horarios as SlotTreinamento[];
      const antes = (carregarSlots(db, [id]).get(id) ?? []).map((h) => ({ profissional_id: h.profissional_id as number, dias_semana: h.dias_semana as number[] | null, hora_inicio: h.hora_inicio as string }));
      const canon = (l: SlotTreinamento[]): string => JSON.stringify([...l].map((x) => [x.profissional_id, x.dias_semana?.join(',') ?? '', x.hora_inicio]).sort());
      const mudou = canon(antes) !== canon(slots);
      executar(db, 'DELETE FROM treinamento_horarios WHERE treinamento_id = ?', id);
      for (const sl of slots) {
        executar(db, 'INSERT INTO treinamento_horarios (treinamento_id, profissional_id, dias_semana, hora_inicio) VALUES (?, ?, ?, ?)',
          id, sl.profissional_id, sl.dias_semana ? sl.dias_semana.join(',') : null, sl.hora_inicio);
      }
      if (mudou && antes.length) {
        registrarAuditoria(db, { entidade: 'treinamentos', registroId: id, acao: 'atualizou_horarios', usuario: ctx.user, detalhes: { total_antes: antes.length, total_depois: slots.length } });
      }
      auditarConflitoForcado(ctx, 'treinamento', id, forcar);
    },
    detalhe: (ctx, reg) => {
      const db = ctx.db;
      const out = detalheAgenda(ctx, reg, 'treinamento');
      // Por participante: horários, encontros no período e horas (encontros × duração).
      const slots = carregarSlots(db, [reg.id]).get(reg.id) ?? [];
      const nomes = new Map<number, Linha>(listar(db, `SELECT id, nome_completo, cargo FROM profissionais WHERE id IN (${marcadores(Math.max(1, slots.length))})`, ...(slots.length ? slots.map((x) => x.profissional_id) : [0])).map((p) => [p.id, p]));
      const porProf = new Map<number, Linha>();
      for (const sl of slots) {
        const p = porProf.get(sl.profissional_id) ?? { profissional_id: sl.profissional_id, profissional_nome: nomes.get(sl.profissional_id)?.nome_completo ?? '', funcao: nomes.get(sl.profissional_id)?.cargo ?? null, horarios: [], encontros: 0, minutos: 0 };
        const { hora_fim } = fimDoEncontro(sl.hora_inicio, reg.duracao_minutos);
        const n = contarEncontros(reg.data_inicial, reg.data_final, sl.dias_semana);
        p.horarios.push({ dias_semana: sl.dias_semana, hora_inicio: sl.hora_inicio, hora_fim, encontros: n });
        p.encontros += n; p.minutos += n * reg.duracao_minutos;
        porProf.set(sl.profissional_id, p);
      }
      out.participantes = [...porProf.values()].sort((a, b) => String(a.profissional_nome).localeCompare(String(b.profissional_nome), 'pt-BR'));
      out.horas_total_minutos = out.participantes.reduce((acc: number, p: Linha) => acc + p.minutos, 0);
      return out;
    },
  },
};

export function registrarAgenda(roteador: Roteador): void {
  registrarRecurso(roteador, escalas);
  registrarRecurso(roteador, folgas);
  registrarRecurso(roteador, treinamentos);
}
