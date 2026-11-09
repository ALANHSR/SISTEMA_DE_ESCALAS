// Estado global mínimo da sessão (usuário logado + opções compartilhadas), com assinantes simples.
const ouvintes = new Set();
export const estado = { usuario: null, carregado: false };

export function definirUsuario(usuario) {
  estado.usuario = usuario;
  estado.carregado = true;
  for (const fn of ouvintes) fn(estado);
}
export function aoMudarEstado(fn) { ouvintes.add(fn); return () => ouvintes.delete(fn); }
export const ehAdmin = () => estado.usuario?.perfil === 'administrador';

let cacheOpcoes = null;
export async function obterOpcoes(api, forcar = false) {
  if (cacheOpcoes && !forcar) return cacheOpcoes;
  cacheOpcoes = await api.get('/api/opcoes');
  return cacheOpcoes;
}
export function invalidarOpcoes() { cacheOpcoes = null; }
