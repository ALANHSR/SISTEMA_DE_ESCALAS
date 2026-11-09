// Motor genérico de cadastros. Cada recurso declara esquema, relações e ganchos de regra de negócio;
// o motor cuida de listagem (busca/filtro/ordem/paginação), detalhe, criação, edição, mudança de status,
// auditoria e exportação. TODA mutação é registrada com acesso 'admin' (verificado no servidor).
import type { Acesso, Ctx, Roteador } from './http.ts';
import { HttpError, Resposta } from './http.ts';
import type { DB, Linha } from './db.ts';
import { executar, listar, obter, transacao } from './db.ts';
import type { Esquema } from './validacao.ts';
import { validar } from './validacao.ts';
import { diferencas, historico, registrarAuditoria } from './auditoria.ts';
import { formatarDataBR } from '../shared/datetime.ts';
import { rotulo } from './rotulos.ts';
import { lancarValidacao } from './regras.ts';

export interface Relacao {
  /** Campo do esquema com a lista de ids, ex.: 'profissional_ids'. */
  campo: string;
  tabela: string;
  fkPropria: string;
  fkOutra: string;
  tabelaOutra: string;
  colunaNome: string;
  /** Chave do detalhe com os objetos {id, nome, status}, ex.: 'profissionais'. */
  chaveDetalhe: string;
}

export interface ArgsNegocio {
  ctx: Ctx;
  dados: Linha;
  /** Registro atual no banco (com ids das relações) ou null na criação. */
  existente: Linha | null;
  forcar: boolean;
}

export interface Ganchos {
  /** Ajusta a entrada antes da validação (ex.: preencher horário a partir de um modelo). */
  preparar?(ctx: Ctx, entrada: Linha): Linha;
  filtrarLista?(ctx: Ctx): { where: string[]; params: unknown[] };
  podeVer?(ctx: Ctx, linha: Linha): boolean;
  /** Regras de negócio. Lança HttpError (422 validação, 409 conflito). Executa dentro da transação. */
  negocio?(a: ArgsNegocio): void;
  colunasExtras?(a: ArgsNegocio): Linha;
  posSalvar?(a: ArgsNegocio & { id: number }): void;
  detalhe?(ctx: Ctx, registro: Linha): Linha;
  /** Ajusta cada linha devolvida (listagem e detalhe), ex.: ocultar campos sensíveis para o perfil usuário. */
  transformarLinha?(ctx: Ctx, linha: Linha): Linha;
  /** Campos do esquema que não vêm de uma coluna simples nem de uma `relacao` (ex.: a grade de dias de
   *  uma escala, espalhada em `escala_dias`). Usado por `carregarEntrada` para que reenviar o registro
   *  atual (ex.: ao trocar só a situação via POST /:id/status) não apague esses campos por omissão —
   *  mesma categoria de bug já corrigida antes para campos do tipo "diasSemana". */
  carregarExtra?(db: DB, id: number): Linha;
}

export interface ColunaExportacao {
  campo: string;
  rotulo: string;
  tipo?: 'data' | 'bool' | 'rotulo';
}

export interface Definicao {
  nome: string;
  tabela: string;
  rotulo: string;
  esquema: Esquema;
  relacoes: Relacao[];
  colunasBool: string[];
  /** Colunas do esquema que não são persistidas diretamente (ex.: senha). */
  ignorarNaPersistencia?: string[];
  busca: string[];
  /** parâmetro de ordenação -> expressão SQL */
  ordenaveis: Record<string, string>;
  ordemPadrao: string;
  dirPadrao?: 'asc' | 'desc';
  /** parâmetro de query -> coluna (igualdade) */
  filtros: Record<string, string>;
  selectExtra?: string;
  exportacao: ColunaExportacao[];
  ganchos: Ganchos;
}

const SISTEMA = ['criado_em', 'atualizado_em', 'criado_por', 'atualizado_por'];

function colunasDoEsquema(def: Definicao): string[] {
  const rel = new Set(def.relacoes.map((r) => r.campo));
  const ign = new Set(def.ignorarNaPersistencia ?? []);
  return Object.keys(def.esquema).filter((k) => !rel.has(k) && !ign.has(k));
}

function publico(def: Definicao, linha: Linha): Linha {
  const r: Linha = { ...linha };
  delete r.senha_hash;
  for (const c of def.colunasBool) if (c in r) r[c] = r[c] === 1 || r[c] === true;
  return r;
}

function idsDaRelacao(db: DB, r: Relacao, id: number): number[] {
  return listar(db, `SELECT ${r.fkOutra} AS oid FROM ${r.tabela} WHERE ${r.fkPropria} = ? ORDER BY ${r.fkOutra}`, id).map((l) => l.oid);
}

/** Registro no formato da entrada do formulário (campos do esquema + ids das relações). */
export function carregarEntrada(def: Definicao, db: DB, id: number): Linha | null {
  const l = obter(db, `SELECT * FROM ${def.tabela} WHERE id = ?`, id);
  if (!l) return null;
  const e = publico(def, l);
  for (const r of def.relacoes) e[r.campo] = idsDaRelacao(db, r, id);
  if (def.ganchos.carregarExtra) Object.assign(e, def.ganchos.carregarExtra(db, id));
  return e;
}

export function idDaRota(ctx: Ctx): number {
  const id = Number(ctx.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(404, 'nao_encontrado', 'Registro não encontrado.');
  return id;
}

export function detalhar(def: Definicao, ctx: Ctx, id: number): Linha {
  const db = ctx.db;
  const linha = obter(db, `SELECT * FROM ${def.tabela} WHERE id = ?`, id);
  if (!linha || (def.ganchos.podeVer && !def.ganchos.podeVer(ctx, linha))) {
    throw new HttpError(404, 'nao_encontrado', `${def.rotulo} não encontrado.`);
  }
  let reg = publico(def, linha);
  for (const r of def.relacoes) {
    const itens = listar(
      db,
      `SELECT o.id, o.${r.colunaNome} AS nome, o.status FROM ${r.tabela} v
         JOIN ${r.tabelaOutra} o ON o.id = v.${r.fkOutra}
        WHERE v.${r.fkPropria} = ? ORDER BY o.${r.colunaNome} COLLATE NOCASE`,
      id,
    );
    reg[r.campo] = itens.map((i) => i.id);
    reg[r.chaveDetalhe] = itens;
  }
  const nomeUsuario = (uid: unknown): string | null =>
    uid ? (obter(db, 'SELECT nome FROM usuarios WHERE id = ?', uid)?.nome ?? null) : null;
  reg.criado_por_nome = nomeUsuario(reg.criado_por);
  reg.atualizado_por_nome = nomeUsuario(reg.atualizado_por);
  if (ctx.user?.perfil === 'administrador') reg.historico = historico(db, def.nome, id);
  if (def.ganchos.detalhe) reg = def.ganchos.detalhe(ctx, reg);
  if (def.ganchos.transformarLinha) reg = def.ganchos.transformarLinha(ctx, reg);
  return reg;
}

function consultar(def: Definicao, ctx: Ctx, paginar: boolean): { linhas: Linha[]; total: number; pagina: number; porPagina: number } {
  const q = ctx.query;
  const where: string[] = [];
  const params: unknown[] = [];

  const busca = (q.get('q') ?? '').trim().slice(0, 100);
  if (busca && def.busca.length) {
    where.push(`(${def.busca.map((c) => `${c} LIKE ? ESCAPE '\\'`).join(' OR ')})`);
    const like = `%${busca.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    for (let i = 0; i < def.busca.length; i++) params.push(like);
  }
  for (const [param, coluna] of Object.entries(def.filtros)) {
    const v = q.get(param);
    if (v) { where.push(`${coluna} = ?`); params.push(v); }
  }
  const extra = def.ganchos.filtrarLista?.(ctx);
  if (extra) { where.push(...extra.where); params.push(...extra.params); }

  const cond = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const expr = def.ordenaveis[q.get('ordenar') ?? ''] ?? def.ordenaveis[def.ordemPadrao]!;
  const pedida = q.get('dir');
  const dir = (pedida === 'desc' || pedida === 'asc' ? pedida : (def.dirPadrao ?? 'asc')) === 'desc' ? 'DESC' : 'ASC';

  const total = Number(obter(ctx.db, `SELECT COUNT(*) AS n FROM ${def.tabela} t ${cond}`, ...params)!.n);
  const porPagina = paginar ? Math.min(100, Math.max(1, Number(q.get('porPagina')) || 20)) : 10_000;
  const pagina = paginar ? Math.max(1, Number(q.get('pagina')) || 1) : 1;
  const linhas = listar(
    ctx.db,
    `SELECT t.*${def.selectExtra ? `, ${def.selectExtra}` : ''} FROM ${def.tabela} t ${cond}
      ORDER BY ${expr} ${dir}, t.id DESC LIMIT ? OFFSET ?`,
    ...params, porPagina, (pagina - 1) * porPagina,
  ).map((l) => {
    const p = publico(def, l);
    return def.ganchos.transformarLinha ? def.ganchos.transformarLinha(ctx, p) : p;
  });
  return { linhas, total, pagina, porPagina };
}

export function salvar(def: Definicao, ctx: Ctx, id: number | null, corpo: unknown): number {
  const bruto = (corpo && typeof corpo === 'object' ? corpo : {}) as Linha;
  const forcar = bruto.forcar === true;
  const entrada = def.ganchos.preparar ? def.ganchos.preparar(ctx, { ...bruto }) : bruto;
  const { dados, erros } = validar(def.esquema, entrada);
  if (Object.keys(erros).length) lancarValidacao(erros);

  const db = ctx.db;
  const usuario = ctx.user!;
  const agora = new Date().toISOString();
  const colunas = colunasDoEsquema(def);

  return transacao(db, () => {
    const existente = id === null ? null : carregarEntrada(def, db, id);
    if (id !== null && !existente) throw new HttpError(404, 'nao_encontrado', `${def.rotulo} não encontrado.`);
    const args: ArgsNegocio = { ctx, dados, existente, forcar };
    def.ganchos.negocio?.(args);
    const extras = def.ganchos.colunasExtras?.(args) ?? {};

    let idFinal: number;
    if (id === null) {
      const nomes = [...colunas, ...Object.keys(extras), ...SISTEMA];
      const valores = [...colunas.map((c) => dados[c]), ...Object.values(extras), agora, agora, usuario.id, usuario.id];
      idFinal = executar(db, `INSERT INTO ${def.tabela} (${nomes.join(', ')}) VALUES (${nomes.map(() => '?').join(', ')})`, ...valores).id;
    } else {
      idFinal = id;
      const nomes = [...colunas, ...Object.keys(extras), 'atualizado_em', 'atualizado_por'];
      const valores = [...colunas.map((c) => dados[c]), ...Object.values(extras), agora, usuario.id];
      executar(db, `UPDATE ${def.tabela} SET ${nomes.map((n) => `${n} = ?`).join(', ')} WHERE id = ?`, ...valores, id);
    }

    for (const r of def.relacoes) {
      executar(db, `DELETE FROM ${r.tabela} WHERE ${r.fkPropria} = ?`, idFinal);
      for (const outro of dados[r.campo] as number[]) {
        executar(db, `INSERT INTO ${r.tabela} (${r.fkPropria}, ${r.fkOutra}) VALUES (?, ?)`, idFinal, outro);
      }
    }

    if (existente === null) {
      registrarAuditoria(db, { entidade: def.nome, registroId: idFinal, acao: 'criou', usuario });
    } else {
      const dif = diferencas(existente, dados, [...colunas, ...def.relacoes.map((r) => r.campo)]);
      if ('senha' in def.esquema && dados.senha) dif.senha = { de: '••••', para: '••••' };
      if (Object.keys(dif).length) {
        const soStatus = Object.keys(dif).length === 1 && 'status' in dif;
        registrarAuditoria(db, { entidade: def.nome, registroId: idFinal, acao: soStatus ? 'alterou_status' : 'atualizou', usuario, detalhes: { campos: dif } });
      }
    }
    def.ganchos.posSalvar?.({ ...args, id: idFinal });
    return idFinal;
  });
}

function celulaCsv(valor: unknown): string {
  let s = valor === null || valor === undefined ? '' : String(valor);
  // Neutraliza injeção de fórmulas ao abrir o CSV em planilhas.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function montarCsv(cabecalho: string[], linhas: unknown[][]): string {
  return `\uFEFF${[cabecalho, ...linhas].map((l) => l.map(celulaCsv).join(';')).join('\r\n')}\r\n`;
}

export function valorExportado(v: unknown, tipo?: ColunaExportacao['tipo']): unknown {
  if (v === null || v === undefined) return '';
  if (tipo === 'data') return formatarDataBR(String(v));
  if (tipo === 'bool') return v === true || v === 1 ? 'Sim' : 'Não';
  if (tipo === 'rotulo') return rotulo(v);
  return v;
}

export function respostaCsv(nomeArquivo: string, csv: string): Resposta {
  return new Resposta(200, csv, 'text/csv; charset=utf-8', {
    'Content-Disposition': `attachment; filename="${nomeArquivo}"`,
  });
}

export function registrarRecurso(roteador: Roteador, def: Definicao, leitura: Acesso = 'autenticado'): void {
  const base = `/api/${def.nome}`;

  roteador.get(base, leitura, (ctx) => {
    const r = consultar(def, ctx, true);
    return { dados: r.linhas, total: r.total, pagina: r.pagina, porPagina: r.porPagina };
  });

  roteador.get(`${base}/exportar`, 'admin', (ctx) => {
    const { linhas } = consultar(def, ctx, false);
    const csv = montarCsv(
      def.exportacao.map((c) => c.rotulo),
      linhas.map((l) => def.exportacao.map((c) => valorExportado(l[c.campo], c.tipo))),
    );
    return respostaCsv(`${def.nome}.csv`, csv);
  });

  roteador.get(`${base}/:id`, leitura, (ctx) => ({ dado: detalhar(def, ctx, idDaRota(ctx)) }));

  roteador.post(base, 'admin', (ctx) => {
    const id = salvar(def, ctx, null, ctx.body);
    return new Resposta(201, { dado: detalhar(def, ctx, id) });
  });

  roteador.put(`${base}/:id`, 'admin', (ctx) => {
    const id = idDaRota(ctx);
    salvar(def, ctx, id, ctx.body);
    return { dado: detalhar(def, ctx, id) };
  });

  // Inativar, cancelar, confirmar, aprovar... Exclusão física não existe: o histórico é preservado (regra 11).
  roteador.post(`${base}/:id/status`, 'admin', (ctx) => {
    const id = idDaRota(ctx);
    const novo = ctx.body?.status;
    const valores = def.esquema.status?.valores;
    if (typeof novo !== 'string' || !valores?.includes(novo)) {
      lancarValidacao({ status: 'Situação: selecione uma opção válida.' });
    }
    const atual = carregarEntrada(def, ctx.db, id);
    if (!atual) throw new HttpError(404, 'nao_encontrado', `${def.rotulo} não encontrado.`);
    // Campos do tipo "diasSemana" ficam guardados como texto ("1,2,3"), mas o validador só aceita
    // uma lista — ao reenviar o valor atual (aqui, não vindo de um formulário), desfaz essa
    // conversão para o formato de entrada. Sem isto, mudar só a situação de um registro com dias
    // da semana cadastrados era barrado por engano.
    const corpo: Linha = { ...atual, status: novo, forcar: ctx.body?.forcar === true };
    for (const [campo, def2] of Object.entries(def.esquema)) {
      if (def2.tipo === 'diasSemana' && typeof corpo[campo] === 'string') {
        corpo[campo] = (corpo[campo] as string).split(',').map(Number);
      }
    }
    salvar(def, ctx, id, corpo);
    return { dado: detalhar(def, ctx, id) };
  });
}
