// Importação em massa de escalas por CSV.
//
// Cada linha do arquivo vira UMA escala (com sua própria grade de dias), passando pelo mesmo caminho
// do cadastro manual (`salvar` do motor genérico): validação de campos, regras de negócio (projeto/
// local/profissionais/horário), detecção de conflitos e auditoria. Linhas com problema NÃO impedem as
// demais: cada linha é uma transação própria e o resultado informa, linha a linha, o que foi criado e
// o que falhou (e por quê).
//
// Quarto pedido de ajustes (outubro): a escala deixou de ter um único horário fixo (ver
// routes/agenda.ts), então a linha do CSV não informa mais "Hora início/Hora fim/Virada de dia" — em
// vez disso informa o NOME de um horário já cadastrado (tela de Horários), que é aplicado a todos os
// profissionais da linha, em todas as datas do período que casarem com "Dias da semana" (ou todos os
// dias, se em branco/"Todos"). Isso reproduz o comportamento anterior (um padrão só, igual para todos
// os profissionais da linha); para profissionais com padrões diferentes dentro da mesma escala, use o
// cadastro manual pela tela (grade) ou várias linhas com o mesmo título — cada linha de CSV ainda cria
// um registro de escala separado.
import type { Ctx, Roteador } from '../http.ts';
import { HttpError } from '../http.ts';
import { listar } from '../db.ts';
import { salvar } from '../recursos.ts';
import { lerCsv, normalizar } from '../csv.ts';
import { dataDeBR, diaDaSemana, somarDias } from '../../shared/datetime.ts';
import { escalas } from './agenda.ts';

const MAX_LINHAS = 1000;

/** Colunas aceitas (cabeçalho comparado sem acento/maiúsculas). Só as marcadas são obrigatórias. */
const COLUNAS = {
  titulo: ['titulo'],
  projeto: ['codigo do projeto', 'projeto', 'codigo projeto'],
  local: ['local', 'locais', 'nome do local'],
  data_inicial: ['data inicial', 'data inicio', 'inicio'],
  data_final: ['data final', 'data fim', 'fim', 'termino'],
  horario: ['horario', 'modelo de horario', 'nome do horario'],
  status: ['situacao', 'status'],
  dias_semana: ['dias da semana', 'dias semana'],
  profissionais: ['profissionais', 'profissional'],
  descricao: ['descricao'],
} as const;
type Campo = keyof typeof COLUNAS;
const OBRIGATORIAS: Campo[] = ['titulo', 'data_inicial', 'data_final', 'horario', 'profissionais'];

const STATUS_POR_TEXTO: Record<string, string> = {
  planejada: 'planejada', confirmada: 'confirmada', 'em andamento': 'em_andamento', em_andamento: 'em_andamento',
  concluida: 'concluida', cancelada: 'cancelada',
};
const DIAS: Record<string, number> = { dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sab: 6 };

/** Interpreta a lista de dias ("Seg,Ter,Qua" / "Todos" / vazio). undefined = todos os dias; null = inválido. */
function lerDiasSemana(texto: string): number[] | undefined | null {
  const t = normalizar(texto);
  if (t === '' || t === 'todos' || t === 'todos os dias') return undefined;
  if (t === 'dias uteis' || t === 'uteis') return [1, 2, 3, 4, 5];
  const dias = t.split(/[,\s/]+/).filter(Boolean).map((p) => DIAS[p.slice(0, 3)]);
  return dias.some((d) => d === undefined) ? null : (dias as number[]);
}

/** Todas as datas de [dataInicial, dataFinal] que casam com os dias da semana informados (undefined = todas). */
function expandirDatas(dataInicial: string, dataFinal: string, diasSemana: number[] | undefined): string[] {
  const saida: string[] = [];
  for (let d = dataInicial; d <= dataFinal; d = somarDias(d, 1)) {
    if (!diasSemana || diasSemana.includes(diaDaSemana(d))) saida.push(d);
  }
  return saida;
}

export interface ResultadoLinha { linha: number; ok: boolean; id?: number; titulo?: string; erros: string[] }

export function importarEscalas(ctx: Ctx, csv: string, forcarConflitos: boolean): {
  total: number; criadas: number; com_erro: number; resultados: ResultadoLinha[];
} {
  const linhas = lerCsv(csv);
  if (linhas.length < 2) throw new HttpError(422, 'validacao', 'O arquivo precisa ter a linha de cabeçalho e ao menos uma linha de dados.');
  if (linhas.length - 1 > MAX_LINHAS) throw new HttpError(422, 'validacao', `O arquivo tem linhas demais: o limite é ${MAX_LINHAS} por importação.`);

  // Mapeia cada campo para o índice da coluna correspondente no cabeçalho.
  const cabecalho = linhas[0]!.map(normalizar);
  const indice = {} as Record<Campo, number>;
  for (const campo of Object.keys(COLUNAS) as Campo[]) {
    indice[campo] = cabecalho.findIndex((h) => (COLUNAS[campo] as readonly string[]).includes(h));
  }
  const faltando = OBRIGATORIAS.filter((c) => indice[c] === -1);
  if (faltando.length) {
    throw new HttpError(422, 'validacao', `Colunas obrigatórias ausentes no cabeçalho: ${faltando.map((c) => COLUNAS[c][0]).join(', ')}.`);
  }

  const db = ctx.db;
  const projetos = new Map(listar(db, 'SELECT id, codigo FROM projetos').map((p) => [normalizar(p.codigo), p.id as number]));
  const locais = new Map(listar(db, 'SELECT id, nome FROM locais').map((l) => [normalizar(l.nome), l.id as number]));
  const profissionais = new Map(listar(db, 'SELECT id, nome_completo FROM profissionais').map((p) => [normalizar(p.nome_completo), p.id as number]));
  const horarios = new Map(listar(db, 'SELECT id, nome FROM horarios').map((h) => [normalizar(h.nome), h.id as number]));

  const resultados: ResultadoLinha[] = [];
  linhas.slice(1).forEach((celulas, i) => {
    const numero = i + 2; // número da linha no arquivo (cabeçalho = 1)
    const valor = (campo: Campo): string => (indice[campo] === -1 ? '' : (celulas[indice[campo]] ?? '').trim());
    const erros: string[] = [];

    const dataInicial = dataDeBR(valor('data_inicial'));
    const dataFinal = dataDeBR(valor('data_final'));
    if (!dataInicial) erros.push('Data inicial: use o formato DD/MM/AAAA.');
    if (!dataFinal) erros.push('Data final: use o formato DD/MM/AAAA.');

    let projetoId: number | null = null;
    if (valor('projeto')) {
      projetoId = projetos.get(normalizar(valor('projeto'))) ?? null;
      if (projetoId === null) erros.push(`Projeto: o código "${valor('projeto')}" não está cadastrado.`);
    }
    // Mais de um local: separados por "|" (mesmo padrão usado para profissionais).
    const nomesLocais = valor('local').split('|').map((n) => n.trim()).filter(Boolean);
    const localIds: number[] = [];
    const locaisNaoEncontrados: string[] = [];
    for (const nome of nomesLocais) {
      const id = locais.get(normalizar(nome));
      if (id === undefined) locaisNaoEncontrados.push(nome); else localIds.push(id);
    }
    if (locaisNaoEncontrados.length) erros.push(`Local: não está(ão) cadastrado(s) (use o nome exato): ${locaisNaoEncontrados.join(', ')}.`);

    const nomes = valor('profissionais').split('|').map((n) => n.trim()).filter(Boolean);
    const profissionalIds: number[] = [];
    const naoEncontrados: string[] = [];
    for (const nome of nomes) {
      const id = profissionais.get(normalizar(nome));
      if (id === undefined) naoEncontrados.push(nome); else profissionalIds.push(id);
    }
    if (naoEncontrados.length) erros.push(`Profissionais não encontrados (use o nome completo exato): ${naoEncontrados.join(', ')}.`);

    const textoStatus = normalizar(valor('status'));
    const status = textoStatus === '' ? 'planejada' : STATUS_POR_TEXTO[textoStatus];
    if (!status) erros.push(`Situação: "${valor('status')}" não é válida (use Planejada, Confirmada, Em andamento, Concluída ou Cancelada).`);

    const dias = lerDiasSemana(valor('dias_semana'));
    if (dias === null) erros.push('Dias da semana: use abreviações como "Seg, Ter, Qua", "Dias úteis" ou "Todos".');

    const nomeHorario = valor('horario');
    let horarioId: number | null = null;
    if (!nomeHorario) erros.push('Horário: informe o nome de um horário cadastrado (tela de Horários).');
    else {
      horarioId = horarios.get(normalizar(nomeHorario)) ?? null;
      if (horarioId === null) erros.push(`Horário: "${nomeHorario}" não está cadastrado.`);
    }

    if (erros.length) { resultados.push({ linha: numero, ok: false, titulo: valor('titulo'), erros }); return; }

    // A grade: o mesmo horário, para todos os profissionais da linha, em cada data do período que
    // casar com os dias da semana informados (todas, se em branco) — reproduz o padrão único por
    // linha que a importação sempre ofereceu; para padrões diferentes por profissional dentro de uma
    // mesma escala, use o cadastro manual (tela de Escalas) ou uma linha de CSV por padrão.
    const datas = expandirDatas(dataInicial!, dataFinal!, dias ?? undefined);
    const grade = profissionalIds.flatMap((profissionalId) => datas.map((data) => ({ profissional_id: profissionalId, data, horario_id: horarioId })));

    const corpo = {
      titulo: valor('titulo'), projeto_id: projetoId, local_ids: localIds,
      data_inicial: dataInicial, data_final: dataFinal, status, dias: grade,
      descricao: valor('descricao') || null, forcar: forcarConflitos,
    };
    try {
      const id = salvar(escalas, ctx, null, corpo);
      resultados.push({ linha: numero, ok: true, id, titulo: corpo.titulo, erros: [] });
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      const msgs: string[] = [];
      const campos = e.extra.campos as Record<string, string> | undefined;
      const conflitos = e.extra.conflitos as { mensagem: string }[] | undefined;
      if (campos) msgs.push(...Object.values(campos));
      else if (conflitos) msgs.push(...conflitos.map((c) => `Conflito de agenda — ${c.mensagem}`));
      else msgs.push(e.message);
      resultados.push({ linha: numero, ok: false, titulo: valor('titulo'), erros: msgs });
    }
  });

  const criadas = resultados.filter((r) => r.ok).length;
  return { total: resultados.length, criadas, com_erro: resultados.length - criadas, resultados };
}

export function registrarImportacao(roteador: Roteador): void {
  roteador.post('/api/escalas/importar', 'admin', (ctx) => {
    const csv = ctx.body?.csv;
    if (typeof csv !== 'string' || csv.trim() === '') throw new HttpError(422, 'validacao', 'Envie o conteúdo do arquivo CSV.');
    return importarEscalas(ctx, csv, ctx.body?.forcar_conflitos === true);
  });
}
