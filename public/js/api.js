// Cliente HTTP para /api/*. Mantém o token CSRF em memória e trata sessão expirada.
let csrfToken = null;
let aoExpirar = null;
let aoExigirTrocaSenha = null;

export function definirAoExpirar(fn) { aoExpirar = fn; }
export function definirAoExigirTrocaSenha(fn) { aoExigirTrocaSenha = fn; }
export function definirCsrf(token) { csrfToken = token; }

export class ErroApi extends Error {
  constructor(status, corpo) {
    super(corpo?.erro?.mensagem || 'Ocorreu um erro inesperado.');
    this.status = status;
    this.codigo = corpo?.erro?.codigo ?? null;
    this.campos = corpo?.erro?.campos ?? null;
    this.conflitos = corpo?.erro?.conflitos ?? null;
    this.podeForcar = corpo?.erro?.pode_forcar ?? false;
  }
}

async function chamar(metodo, caminho, corpo) {
  const cabecalhos = {};
  if (corpo !== undefined) cabecalhos['content-type'] = 'application/json';
  if (metodo !== 'GET' && csrfToken) cabecalhos['x-csrf-token'] = csrfToken;
  const res = await fetch(caminho, {
    method: metodo, headers: cabecalhos, credentials: 'same-origin',
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });

  const tipo = res.headers.get('content-type') || '';
  const dado = tipo.includes('text/csv') ? await res.blob() : tipo.includes('application/json') ? await res.json() : await res.text();

  if (!res.ok) {
    if (res.status === 401 && aoExpirar) aoExpirar();
    if (res.status === 403 && dado?.erro?.codigo === 'deve_trocar_senha' && aoExigirTrocaSenha) aoExigirTrocaSenha();
    throw new ErroApi(res.status, dado);
  }
  return dado;
}

export const api = {
  get: (caminho) => chamar('GET', caminho),
  post: (caminho, corpo) => chamar('POST', caminho, corpo ?? {}),
  put: (caminho, corpo) => chamar('PUT', caminho, corpo ?? {}),
  async baixarCsv(caminho, nomeArquivo) {
    const blob = await chamar('GET', caminho);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nomeArquivo;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  },
};

/** Monta querystring a partir de um objeto, ignorando valores vazios. */
export function paraQuery(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) { if (v.length) q.set(k, v.join(',')); } else q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}
