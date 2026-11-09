// Regras de negócio compartilhadas entre os cadastros.
import type { DB, Linha } from './db.ts';
import { listar, marcadores, obter } from './db.ts';
import type { Erros } from './validacao.ts';
import { HttpError } from './http.ts';
import { duracaoEmDias, horaParaMinutos } from '../shared/datetime.ts';

export function lancarValidacao(erros: Erros): never {
  throw new HttpError(422, 'validacao', 'Corrija os campos destacados.', { campos: erros });
}
export function temErros(erros: Erros): boolean {
  return Object.keys(erros).length > 0;
}

/** Regra 9 (data final >= inicial) e limite de tamanho do período. Comparação lexicográfica é segura em ISO. */
export function regrasDePeriodo(d: Linha, erros: Erros, maxDias?: number): void {
  if (!d.data_inicial || !d.data_final || erros.data_inicial || erros.data_final) return;
  if (d.data_final < d.data_inicial) {
    erros.data_final = 'Data final: não pode ser anterior à data inicial.';
  } else if (maxDias && duracaoEmDias(d.data_inicial, d.data_final) > maxDias) {
    erros.data_final = `Período: no máximo ${maxDias} dias por registro. Divida em mais de um registro.`;
  }
}

/**
 * Regra 10: horário final menor que o inicial somente quando marcado como virada de dia.
 * Com virada de dia o término ocorre no dia seguinte (portanto, deve ser menor que o início).
 */
export function regrasDeHorario(d: Linha, erros: Erros): void {
  if (!d.hora_inicio || !d.hora_fim || erros.hora_inicio || erros.hora_fim) return;
  const ini = horaParaMinutos(d.hora_inicio);
  const fim = horaParaMinutos(d.hora_fim);
  if (fim === ini) {
    erros.hora_fim = 'Horário final: não pode ser igual ao inicial.';
  } else if (!d.vira_dia && fim < ini) {
    erros.hora_fim = 'Horário final: só pode ser menor que o inicial quando o registro é marcado como virada de dia.';
  } else if (d.vira_dia && fim > ini) {
    erros.hora_fim = 'Horário final: com virada de dia, o término no dia seguinte deve ser menor que o horário inicial.';
  }
}

/** Duração em minutos de um horário (considerando virada de dia). */
export function duracaoMinutos(horaInicio: string, horaFim: string, viraDia: boolean): number {
  const ini = horaParaMinutos(horaInicio);
  const fim = horaParaMinutos(horaFim);
  return viraDia ? 24 * 60 - ini + fim : fim - ini;
}

interface OpcoesRef {
  tabela: 'projetos' | 'locais' | 'horarios' | 'profissionais';
  campo: string;
  id: number | null;
  rotulo: string;
  /** Vínculo novo (ou alterado): registros inativos não aceitam novos vínculos. */
  novoVinculo: boolean;
}

/** Confere se a referência existe e, quando for um vínculo novo, se ainda pode receber vínculos. */
export function checarReferencia(db: DB, erros: Erros, o: OpcoesRef): Linha | null {
  if (o.id === null) return null;
  const r = obter(db, `SELECT * FROM ${o.tabela} WHERE id = ?`, o.id);
  if (!r) {
    erros[o.campo] = `${o.rotulo}: registro não encontrado.`;
    return null;
  }
  if (o.novoVinculo) {
    const encerrado = o.tabela === 'projetos' ? ['concluido', 'cancelado'].includes(r.status) : r.status !== 'ativo';
    if (encerrado) erros[o.campo] = `${o.rotulo}: registro ${o.tabela === 'projetos' ? `${r.status === 'cancelado' ? 'cancelado' : 'concluído'}` : 'inativo'} não aceita novos vínculos.`;
  }
  return r;
}

/** Regra 1: profissionais inativos não entram em novos vínculos, mas os já vinculados permanecem. */
export function checarProfissionais(db: DB, erros: Erros, campo: string, ids: number[], anteriores: number[]): Linha[] {
  if (ids.length === 0) return [];
  const linhas = listar(db, `SELECT id, nome_completo, status FROM profissionais WHERE id IN (${marcadores(ids.length)})`, ...ids);
  const achados = new Set(linhas.map((l) => l.id));
  if (ids.some((id) => !achados.has(id))) {
    erros[campo] = 'Profissionais: um ou mais registros não foram encontrados.';
    return linhas;
  }
  const inativos = linhas.filter((l) => l.status !== 'ativo' && !anteriores.includes(l.id));
  if (inativos.length) {
    erros[campo] = `Profissionais inativos não aceitam novos vínculos: ${inativos.map((l) => l.nome_completo).join(', ')}.`;
  }
  return linhas;
}
