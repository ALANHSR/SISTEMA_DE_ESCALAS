// Utilitários de data/hora para o navegador (equivalentes a src/shared/datetime.ts, sem dependências).
// Datas de entrada/saída da API: 'AAAA-MM-DD'. Exibição: 'DD/MM/AAAA'. Fuso: America/Sao_Paulo.
export const FUSO = 'America/Sao_Paulo';

export function paraBR(iso) {
  if (!iso) return '';
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

export function paraISO(br) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((br || '').trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

export function dataValidaISO(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  if (!m) return false;
  const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return dt.getUTCFullYear() === +m[1] && dt.getUTCMonth() === +m[2] - 1 && dt.getUTCDate() === +m[3];
}

export function dataParaDias(iso) {
  const [a, m, d] = iso.split('-').map(Number);
  return Date.UTC(a, m - 1, d) / 86400000;
}
export function diasParaData(n) {
  return new Date(n * 86400000).toISOString().slice(0, 10);
}
export function somarDias(iso, n) {
  return diasParaData(dataParaDias(iso) + n);
}

export function hojeSaoPaulo() {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const v = (t) => p.find((x) => x.type === t)?.value ?? '00';
  return `${v('year')}-${v('month')}-${v('day')}`;
}

export function agoraHoraSaoPaulo() {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
}

const DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
export function diaDaSemanaAbrev(iso) {
  // dataParaDias é dias desde 1970-01-01, uma quinta-feira (índice 4).
  return DIAS_SEMANA[(dataParaDias(iso) + 4) % 7];
}
/** 0=domingo ... 6=sábado (mesma convenção do servidor). */
export function diaDaSemana(iso) {
  return (dataParaDias(iso) + 4) % 7;
}
export function ehFimDeSemana(iso) {
  const dow = (dataParaDias(iso) + 4) % 7;
  return dow === 0 || dow === 6;
}

/** Número da semana ISO-8601 (1-53) a partir do índice de dias desde 1970-01-01. Espelha
 *  src/shared/datetime.ts (usado pela linha do tempo para a recorrência de semana par/ímpar). */
export function semanaIsoDoIndice(diasDesdeEpoca) {
  const d = new Date(diasDesdeEpoca * 86400000);
  const diaIso = d.getUTCDay() || 7; // 1=segunda..7=domingo
  d.setUTCDate(d.getUTCDate() + 4 - diaIso); // quinta-feira da mesma semana ISO
  const inicioAno = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - inicioAno) / 86400000 + 1) / 7);
}

/** 'segunda-feira, 5 de outubro de 2026' a partir de uma data ISO. */
export function dataPorExtenso(iso) {
  const [a, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(a, m - 1, d)));
}

export function formatarDataHoraBR(iso) {
  if (!iso) return '';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
}
