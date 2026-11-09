// Horas e pessoal por projeto (pensamento futuro do quinto pedido de ajustes), no mesmo formato da
// planilha "Planejamento de horas": por projeto, horas de treinamento + horas de operação assistida
// (as escalas) e, abaixo, o detalhe por profissional. Tudo é calculado na hora a partir do que já
// está cadastrado — escalas (grade), treinamentos e horários — sem tabela nova nem digitação extra.
import type { Ctx, Roteador } from '../http.ts';
import type { Linha } from '../db.ts';
import { listar, marcadores } from '../db.ts';
import { dataValida, formatarDataBR } from '../../shared/datetime.ts';
import { lancarValidacao } from '../regras.ts';
import { montarCsv, respostaCsv } from '../recursos.ts';
import { carregarSlots, contarEncontros } from '../treinamento_horarios.ts';
import { rotulo } from '../rotulos.ts';

// "firmes": só o que já está confirmado/em andamento/concluído; "todas": tudo, menos cancelado/recusado.
const ESCALA_FIRME = ['confirmada', 'em_andamento', 'concluida'];
const ESCALA_TODAS = ['planejada', 'confirmada', 'em_andamento', 'concluida'];
const TREINO_FIRME = ['confirmado', 'concluido'];
const TREINO_TODOS = ['planejado', 'confirmado', 'concluido'];

export function formatarHoras(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = Math.round(minutos - h * 60);
  if (h === 0 && m === 0) return '0h';
  if (h === 0) return `${m}min`;
  return m === 0 ? `${h}h` : `${h}h${m}min`;
}

interface Acumulado { treinamento: number; operacao: number }
interface ResultadoHoras {
  filtros: { inicio: string | null; fim: string | null; projeto_id: number | null; considerar: 'todas' | 'firmes' };
  projetos: Linha[];
  detalhe: Linha[];
  totais: { treinamento_min: number; operacao_min: number; total_min: number; profissionais: number };
}

function lerFiltros(ctx: Ctx): ResultadoHoras['filtros'] {
  const inicio = ctx.query.get('inicio') || null;
  const fim = ctx.query.get('fim') || null;
  const erros: Record<string, string> = {};
  if (inicio && !dataValida(inicio)) erros.inicio = 'Início: informe uma data válida.';
  if (fim && !dataValida(fim)) erros.fim = 'Fim: informe uma data válida.';
  if (!erros.inicio && !erros.fim && inicio && fim && fim < inicio) erros.fim = 'Fim: não pode ser anterior ao início.';
  const pid = ctx.query.get('projeto_id');
  const projetoId = pid ? Number(pid) : null;
  if (pid && !Number.isInteger(projetoId)) erros.projeto_id = 'Projeto: seleção inválida.';
  if (Object.keys(erros).length) lancarValidacao(erros);
  return { inicio, fim, projeto_id: projetoId, considerar: ctx.query.get('considerar') === 'firmes' ? 'firmes' : 'todas' };
}

export function calcularHoras(ctx: Ctx): ResultadoHoras {
  const db = ctx.db;
  const f = lerFiltros(ctx);
  const statusEscala = f.considerar === 'firmes' ? ESCALA_FIRME : ESCALA_TODAS;
  const statusTreino = f.considerar === 'firmes' ? TREINO_FIRME : TREINO_TODOS;
  // projeto -> profissional -> minutos
  const mapa = new Map<number, Map<number, Acumulado>>();
  const somar = (projeto: number, prof: number, campo: keyof Acumulado, min: number): void => {
    if (min <= 0) return;
    const porProf = mapa.get(projeto) ?? new Map<number, Acumulado>();
    mapa.set(projeto, porProf);
    const a = porProf.get(prof) ?? { treinamento: 0, operacao: 0 };
    a[campo] += min;
    porProf.set(prof, a);
  };

  // Operação assistida = células da grade das escalas × horas previstas do horário (já descontado o intervalo).
  const where = [`e.status IN (${marcadores(statusEscala.length)})`, 'e.projeto_id IS NOT NULL'];
  const params: unknown[] = [...statusEscala];
  if (f.inicio) { where.push('ed.data >= ?'); params.push(f.inicio); }
  if (f.fim) { where.push('ed.data <= ?'); params.push(f.fim); }
  if (f.projeto_id) { where.push('e.projeto_id = ?'); params.push(f.projeto_id); }
  for (const c of listar(
    db,
    `SELECT e.projeto_id, ed.profissional_id, SUM(ROUND(h.horas_previstas * 60)) AS minutos
       FROM escala_dias ed JOIN escalas e ON e.id = ed.escala_id JOIN horarios h ON h.id = ed.horario_id
      WHERE ${where.join(' AND ')} GROUP BY e.projeto_id, ed.profissional_id`,
    ...params,
  )) somar(c.projeto_id, c.profissional_id, 'operacao', Number(c.minutos));

  // Treinamento = para cada horário de cada participante: encontros no período (respeitando os dias
  // da semana daquele participante) × duração do encontro (sexto pedido de ajustes).
  const wT = [`t.status IN (${marcadores(statusTreino.length)})`, 't.projeto_id IS NOT NULL'];
  const pT: unknown[] = [...statusTreino];
  if (f.inicio) { wT.push('t.data_final >= ?'); pT.push(f.inicio); }
  if (f.fim) { wT.push('t.data_inicial <= ?'); pT.push(f.fim); }
  if (f.projeto_id) { wT.push('t.projeto_id = ?'); pT.push(f.projeto_id); }
  const treinos = listar(db, `SELECT t.id, t.projeto_id, t.data_inicial, t.data_final, t.duracao_minutos FROM treinamentos t WHERE ${wT.join(' AND ')}`, ...pT);
  const slotsTr = carregarSlots(db, treinos.map((t) => t.id));
  for (const t of treinos) {
    for (const sl of slotsTr.get(t.id) ?? []) {
      const encontros = contarEncontros(t.data_inicial, t.data_final, sl.dias_semana, { de: f.inicio, ate: f.fim });
      somar(t.projeto_id, sl.profissional_id, 'treinamento', encontros * t.duracao_minutos);
    }
  }

  // Monta as linhas com nomes (projetos e profissionais).
  const projIds = f.projeto_id ? [f.projeto_id] : [...mapa.keys()];
  const projetos = projIds.length
    ? listar(db, `SELECT id, nome, codigo, status, data_inicial, data_final FROM projetos WHERE id IN (${marcadores(projIds.length)}) ORDER BY nome COLLATE NOCASE`, ...projIds)
    : [];
  const profIds = [...new Set([...mapa.values()].flatMap((m) => [...m.keys()]))];
  const profs = new Map<number, Linha>(profIds.length
    ? listar(db, `SELECT id, nome_completo, cargo FROM profissionais WHERE id IN (${marcadores(profIds.length)})`, ...profIds).map((p) => [p.id, p])
    : []);

  const detalhe: Linha[] = [];
  const linhasProjeto = projetos.map((p) => {
    const porProf = mapa.get(p.id) ?? new Map<number, Acumulado>();
    let tr = 0; let op = 0;
    for (const [pid, a] of porProf) {
      tr += a.treinamento; op += a.operacao;
      detalhe.push({
        projeto_id: p.id, projeto_nome: p.nome, profissional_id: pid,
        profissional_nome: profs.get(pid)?.nome_completo ?? `Profissional ${pid}`, funcao: profs.get(pid)?.cargo ?? null,
        treinamento_min: a.treinamento, operacao_min: a.operacao, total_min: a.treinamento + a.operacao,
      });
    }
    return { ...p, treinamento_min: tr, operacao_min: op, total_min: tr + op, total_profissionais: porProf.size };
  });
  detalhe.sort((a, b) => a.projeto_nome.localeCompare(b.projeto_nome, 'pt-BR') || a.profissional_nome.localeCompare(b.profissional_nome, 'pt-BR'));

  const tr = linhasProjeto.reduce((s, p) => s + p.treinamento_min, 0);
  const op = linhasProjeto.reduce((s, p) => s + p.operacao_min, 0);
  return { filtros: f, projetos: linhasProjeto, detalhe, totais: { treinamento_min: tr, operacao_min: op, total_min: tr + op, profissionais: profIds.length } };
}

export function registrarHoras(roteador: Roteador): void {
  roteador.get('/api/horas-projetos', 'admin', (ctx) => calcularHoras(ctx));

  roteador.get('/api/horas-projetos/exportar', 'admin', (ctx) => {
    const r = calcularHoras(ctx);
    const proj = new Map(r.projetos.map((p) => [p.id, p]));
    const linhas = r.detalhe.map((d) => {
      const p = proj.get(d.projeto_id)!;
      return [
        p.nome, `${p.data_inicial ? formatarDataBR(p.data_inicial) : ''}${p.data_final ? ` a ${formatarDataBR(p.data_final)}` : ''}`, rotulo(p.status),
        d.profissional_nome, d.funcao ?? '', formatarHoras(d.treinamento_min), formatarHoras(d.operacao_min), formatarHoras(d.total_min),
        Math.round((d.total_min / 60) * 100) / 100,
      ];
    });
    return respostaCsv('horas-por-projeto.csv', montarCsv(
      ['Projeto', 'Período do projeto', 'Situação', 'Profissional', 'Função', 'Treinamento', 'Op. assistida', 'Total de horas', 'Total (horas decimais)'], linhas));
  });
}
