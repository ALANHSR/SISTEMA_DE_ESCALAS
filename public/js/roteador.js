// Roteador hash simples: cada rota tem um padrão com :parametros e uma função de renderização.
const rotas = [];
let atual = null;

export function rota(padrao, render) {
  const chaves = [];
  const regex = new RegExp('^' + padrao.replace(/:[a-zA-Z_]+/g, (m) => { chaves.push(m.slice(1)); return '([^/]+)'; }) + '$');
  rotas.push({ regex, chaves, render });
}

function caminhoAtual() {
  const h = location.hash.slice(1) || '/';
  const [caminho, busca] = h.split('?');
  return { caminho, query: new URLSearchParams(busca || '') };
}

export function navegarPara(caminho) { location.hash = caminho; }

export async function despachar(raiz, naoEncontrada) {
  const { caminho, query } = caminhoAtual();
  const chamada = ++despachar._seq;
  for (const r of rotas) {
    const m = r.regex.exec(caminho);
    if (!m) continue;
    const params = {};
    r.chaves.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
    atual = caminho;
    try {
      await r.render(raiz, params, query);
    } catch (e) {
      if (chamada === despachar._seq) throw e;
    }
    return;
  }
  naoEncontrada(raiz);
}
despachar._seq = 0;

export function rotaAtiva(caminho) { return atual === caminho; }
window.addEventListener('hashchange', () => despachar.ultimaRaiz && despachar(despachar.ultimaRaiz, despachar.ultimaNaoEncontrada));
export function iniciarRoteador(raiz, naoEncontrada) {
  despachar.ultimaRaiz = raiz;
  despachar.ultimaNaoEncontrada = naoEncontrada;
  return despachar(raiz, naoEncontrada);
}
