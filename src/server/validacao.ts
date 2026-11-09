// Validação de esquemas (equivalente enxuto a Zod, sem dependências).
// Mensagens em português, neutras quanto a gênero, sempre iniciando pelo nome do campo.
import { dataValida, horaValida } from '../shared/datetime.ts';

export type Erros = Record<string, string>;

export type TipoCampo =
  | 'string' | 'texto' | 'email' | 'telefone' | 'uf' | 'data' | 'hora'
  | 'inteiro' | 'numero' | 'bool' | 'enum' | 'id' | 'listaIds' | 'diasSemana' | 'json';

export interface Campo {
  tipo: TipoCampo;
  rotulo: string;
  obrigatorio?: boolean;
  min?: number;
  max?: number;
  valores?: readonly string[];
  padrao?: unknown;
  maiusculas?: boolean;
  /** Não remove espaços das pontas (usado em senhas). */
  semTrim?: boolean;
}
export type Esquema = Record<string, Campo>;

export const UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
  'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
] as const;

/** Normaliza telefones brasileiros para "(DD) 9XXXX-XXXX" ou "(DD) XXXX-XXXX". Retorna null se inválido. */
export function formatarTelefone(bruto: string): string | null {
  let d = bruto.replace(/\D/g, '');
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function vazio(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

export function validar(
  esquema: Esquema,
  entrada: unknown,
): { dados: Record<string, unknown>; erros: Erros } {
  const origem = (entrada && typeof entrada === 'object' ? entrada : {}) as Record<string, unknown>;
  const dados: Record<string, unknown> = {};
  const erros: Erros = {};

  for (const [chave, c] of Object.entries(esquema)) {
    const bruto = origem[chave];

    if (c.tipo === 'listaIds') {
      const lista = Array.isArray(bruto) ? bruto : bruto === undefined || bruto === null ? [] : null;
      if (lista === null) { erros[chave] = `${c.rotulo}: envie uma lista de identificadores.`; continue; }
      const ids = [...new Set(lista.map(Number))];
      if (ids.some((n) => !Number.isInteger(n) || n <= 0)) { erros[chave] = `${c.rotulo}: identificadores inválidos.`; continue; }
      if (ids.length > 200) { erros[chave] = `${c.rotulo}: no máximo 200 itens.`; continue; }
      if (c.obrigatorio && ids.length === 0) { erros[chave] = `${c.rotulo}: selecione ao menos um.`; continue; }
      dados[chave] = ids;
      continue;
    }

    if (c.tipo === 'json') {
      // Estrutura livre (ex.: a grade de dias de uma escala), sem validação profunda aqui — cada
      // recurso que usa este tipo valida o conteúdo em sua própria regra de negócio (`ganchos.negocio`),
      // porque exige consultas ao banco (datas dentro do período, referências existentes etc.).
      dados[chave] = Array.isArray(bruto) ? bruto : [];
      continue;
    }

    if (c.tipo === 'diasSemana') {
      // Ausente = sem restrição (todos os dias, e mantém compatibilidade com registros antigos).
      if (bruto === undefined || bruto === null) { dados[chave] = null; continue; }
      if (!Array.isArray(bruto)) { erros[chave] = `${c.rotulo}: envie uma lista de dias.`; continue; }
      const lista = [...new Set(bruto.map(Number))];
      if (lista.some((n) => !Number.isInteger(n) || n < 0 || n > 6)) {
        erros[chave] = `${c.rotulo}: dia inválido — use números de 0 (domingo) a 6 (sábado).`;
        continue;
      }
      if (lista.length === 0) { erros[chave] = `${c.rotulo}: selecione ao menos um dia da semana.`; continue; }
      lista.sort((a, b) => a - b);
      // Todos os 7 dias marcados equivale a "sem restrição": grava null para tratar igual aos
      // registros antigos (mesmo caminho de código em toda a detecção de conflitos).
      dados[chave] = lista.length === 7 ? null : lista.join(',');
      continue;
    }

    if (c.tipo === 'bool') {
      if (bruto === undefined || bruto === null) { dados[chave] = c.padrao ?? false; continue; }
      if (typeof bruto !== 'boolean') { erros[chave] = `${c.rotulo}: valor deve ser verdadeiro ou falso.`; continue; }
      dados[chave] = bruto;
      continue;
    }

    if (vazio(bruto)) {
      if (c.obrigatorio) erros[chave] = `${c.rotulo}: campo obrigatório.`;
      else dados[chave] = c.padrao ?? null;
      continue;
    }

    switch (c.tipo) {
      case 'string':
      case 'texto':
      case 'email':
      case 'telefone':
      case 'uf': {
        if (typeof bruto !== 'string') { erros[chave] = `${c.rotulo}: informe um texto.`; break; }
        let s = c.semTrim ? bruto : bruto.trim();
        const max = c.max ?? (c.tipo === 'texto' ? 2000 : 200);
        const min = c.min ?? 0;
        if (s.length < min) { erros[chave] = `${c.rotulo}: mínimo de ${min} caracteres.`; break; }
        if (s.length > max) { erros[chave] = `${c.rotulo}: máximo de ${max} caracteres.`; break; }
        if (c.tipo === 'email') {
          s = s.toLowerCase();
          if (s.length > 254 || !EMAIL_RE.test(s)) { erros[chave] = `${c.rotulo}: informe um e-mail válido.`; break; }
        }
        if (c.tipo === 'telefone') {
          const f = formatarTelefone(s);
          if (!f) { erros[chave] = `${c.rotulo}: informe DDD e número, por exemplo (11) 91234-5678.`; break; }
          s = f;
        }
        if (c.tipo === 'uf') {
          s = s.toUpperCase();
          if (!(UFS as readonly string[]).includes(s)) { erros[chave] = `${c.rotulo}: selecione um estado válido.`; break; }
        }
        if (c.maiusculas) s = s.toUpperCase();
        dados[chave] = s;
        break;
      }
      case 'data':
        if (!dataValida(bruto)) erros[chave] = `${c.rotulo}: informe uma data válida (DD/MM/AAAA).`;
        else dados[chave] = bruto;
        break;
      case 'hora':
        if (!horaValida(bruto)) erros[chave] = `${c.rotulo}: informe um horário válido (HH:MM, 24 horas).`;
        else dados[chave] = bruto;
        break;
      case 'inteiro':
      case 'numero': {
        const n = typeof bruto === 'number' ? bruto : Number(bruto);
        if (!Number.isFinite(n) || (c.tipo === 'inteiro' && !Number.isInteger(n))) {
          erros[chave] = `${c.rotulo}: informe um número${c.tipo === 'inteiro' ? ' inteiro' : ''}.`;
          break;
        }
        if ((c.min !== undefined && n < c.min) || (c.max !== undefined && n > c.max)) {
          erros[chave] = `${c.rotulo}: informe um valor entre ${c.min ?? '-∞'} e ${c.max ?? '∞'}.`;
          break;
        }
        dados[chave] = n;
        break;
      }
      case 'enum':
        if (typeof bruto !== 'string' || !c.valores?.includes(bruto)) erros[chave] = `${c.rotulo}: selecione uma opção válida.`;
        else dados[chave] = bruto;
        break;
      case 'id': {
        const n = Number(bruto);
        if (!Number.isInteger(n) || n <= 0) erros[chave] = `${c.rotulo}: seleção inválida.`;
        else dados[chave] = n;
        break;
      }
    }
  }
  return { dados, erros };
}
