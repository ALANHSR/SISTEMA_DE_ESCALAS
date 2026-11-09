// Utilitários de data e hora. Datas: 'AAAA-MM-DD'. Horários: 'HH:MM' (24 h).
// Todo o sistema opera no relógio local de America/Sao_Paulo (sem horário de verão desde 2019),
// por isso datas e horários são guardados como "relógio de parede", sem conversão de fuso.

export const TIMEZONE = 'America/Sao_Paulo';

const DATA_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const HORA_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MS_DIA = 86_400_000;

export function dataValida(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  const m = DATA_RE.exec(s);
  if (!m) return false;
  const a = Number(m[1]);
  const mes = Number(m[2]);
  const d = Number(m[3]);
  if (a < 1900 || a > 2200) return false;
  const dt = new Date(Date.UTC(a, mes - 1, d));
  return dt.getUTCFullYear() === a && dt.getUTCMonth() === mes - 1 && dt.getUTCDate() === d;
}

export function horaValida(s: unknown): s is string {
  return typeof s === 'string' && HORA_RE.test(s);
}

/** Número de dias desde 1970-01-01 (inteiro). */
export function dataParaDias(s: string): number {
  const m = DATA_RE.exec(s);
  if (!m) throw new Error(`Data inválida: ${s}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / MS_DIA;
}

export function diasParaData(n: number): string {
  return new Date(n * MS_DIA).toISOString().slice(0, 10);
}

export function somarDias(s: string, n: number): string {
  return diasParaData(dataParaDias(s) + n);
}

/** Quantidade de dias do período, contando início e fim. */
export function duracaoEmDias(inicio: string, fim: string): number {
  return dataParaDias(fim) - dataParaDias(inicio) + 1;
}

export function horaParaMinutos(s: string): number {
  const [h, m] = s.split(':');
  return Number(h) * 60 + Number(m);
}

export function minutosParaHora(n: number): string {
  const h = Math.floor(n / 60);
  const m = n % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Data e hora atuais no fuso America/Sao_Paulo. */
export function agoraSaoPaulo(agora: Date = new Date()): { data: string; hora: string } {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(agora);
  const v = (tipo: string): string => partes.find((p) => p.type === tipo)?.value ?? '00';
  return { data: `${v('year')}-${v('month')}-${v('day')}`, hora: `${v('hour')}:${v('minute')}` };
}

export function hojeSaoPaulo(): string {
  return agoraSaoPaulo().data;
}

export function formatarDataBR(s: string): string {
  const [a, m, d] = s.split('-');
  return `${d}/${m}/${a}`;
}

/** Converte 'DD/MM/AAAA' para 'AAAA-MM-DD'. Retorna null se o formato ou a data forem inválidos. */
export function dataDeBR(br: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(br.trim());
  if (!m) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  return dataValida(iso) ? iso : null;
}

/** Dia da semana de uma data ISO: 0=domingo, 1=segunda, ..., 6=sábado (mesma convenção de Date.getDay()). */
export function diaDaSemana(iso: string): number {
  return (dataParaDias(iso) + 4) % 7;
}

/** Número da semana ISO-8601 (1-53) a partir do índice de dias desde 1970-01-01 (algoritmo padrão:
 *  semana da quinta-feira "dona" daquela semana). Usado para alternância de escala par/ímpar. */
export function semanaIsoDoIndice(diasDesdeEpoca: number): number {
  const d = new Date(diasDesdeEpoca * MS_DIA);
  const diaIso = d.getUTCDay() || 7; // 1=segunda..7=domingo
  d.setUTCDate(d.getUTCDate() + 4 - diaIso); // quinta-feira da mesma semana ISO
  const inicioAno = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - inicioAno) / MS_DIA + 1) / 7);
}

/** Converte um carimbo ISO (UTC) para 'DD/MM/AAAA HH:MM' em America/Sao_Paulo. */
export function isoParaSaoPaulo(iso: string): string {
  const { data, hora } = agoraSaoPaulo(new Date(iso));
  return `${formatarDataBR(data)} ${hora}`;
}
