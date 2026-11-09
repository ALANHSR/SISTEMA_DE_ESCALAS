// Horários de treinamento por profissional (sexto pedido de ajustes): cada participante tem os seus
// dias da semana e horários de início; o treinamento tem só a duração de cada encontro. Este módulo
// concentra a conta (fim do encontro, nº de encontros, ocupações para conflito/linha do tempo) para
// que conflitos, linha do tempo e "Horas por projeto" usem exatamente a mesma regra.
import type { DB, Linha } from './db.ts';
import { listar, marcadores } from './db.ts';
import { dataParaDias, horaParaMinutos, minutosParaHora } from '../shared/datetime.ts';
import type { Ocupacao } from './conflitos.ts';

export interface SlotTreinamento {
  profissional_id: number;
  dias_semana: number[] | null;
  hora_inicio: string;
}

const diaDaSemanaDoIndice = (n: number): number => ((n % 7) + 11) % 7;

export const parseDias = (t: string | null | undefined): number[] | null => (t ? t.split(',').map(Number) : null);

/** Horário de término de um encontro que começa em `horaInicio` e dura `duracaoMin` (com virada de dia, se passar da meia-noite). */
export function fimDoEncontro(horaInicio: string, duracaoMin: number): { hora_fim: string; vira_dia: boolean } {
  const total = horaParaMinutos(horaInicio) + duracaoMin;
  return { hora_fim: minutosParaHora(total % 1440), vira_dia: total >= 1440 };
}

/** Quantas datas do período [ini, fim] (recortado por `de`/`ate`, se houver) caem nos dias da semana informados (null = todas). */
export function contarEncontros(ini: string, fim: string, dias: number[] | null, recorte?: { de?: string | null; ate?: string | null }): number {
  const a = Math.max(dataParaDias(ini), recorte?.de ? dataParaDias(recorte.de) : -Infinity);
  const b = Math.min(dataParaDias(fim), recorte?.ate ? dataParaDias(recorte.ate) : Infinity);
  let n = 0;
  for (let d = a; d <= b; d++) if (!dias || dias.length === 0 || dias.includes(diaDaSemanaDoIndice(d))) n += 1;
  return n;
}

export function carregarSlots(db: DB, treinamentoIds: number[]): Map<number, Linha[]> {
  const mapa = new Map<number, Linha[]>();
  if (!treinamentoIds.length) return mapa;
  for (const l of listar(
    db,
    `SELECT treinamento_id, profissional_id, dias_semana, hora_inicio FROM treinamento_horarios
      WHERE treinamento_id IN (${marcadores(treinamentoIds.length)}) ORDER BY profissional_id, hora_inicio`,
    ...treinamentoIds,
  )) mapa.set(l.treinamento_id, [...(mapa.get(l.treinamento_id) ?? []), { ...l, dias_semana: parseDias(l.dias_semana) }]);
  return mapa;
}

/** Uma ocupação por (profissional, dias, horário de início) — é o que entra na detecção de conflitos. */
export function ocupacoesDoTreinamento(
  t: { id: number; nome: string; status: string; data_inicial: string; data_final: string; duracao_minutos: number },
  slots: { profissional_id: number; dias_semana: number[] | null; hora_inicio: string }[],
  restringir: (ids: number[]) => number[] = (ids) => ids,
): Ocupacao[] {
  const saida: Ocupacao[] = [];
  for (const s of slots) {
    const ids = restringir([s.profissional_id]);
    if (!ids.length) continue;
    const { hora_fim, vira_dia } = fimDoEncontro(s.hora_inicio, t.duracao_minutos);
    saida.push({
      tipo: 'treinamento', id: t.id, titulo: t.nome, status: t.status, profissional_ids: ids,
      data_inicial: t.data_inicial, data_final: t.data_final, hora_inicio: s.hora_inicio, hora_fim, vira_dia,
      dias_semana: s.dias_semana && s.dias_semana.length ? s.dias_semana : null,
    });
  }
  return saida;
}
