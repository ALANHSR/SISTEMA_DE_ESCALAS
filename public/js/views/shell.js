import { el, montar, toast } from '../ui.js';
import { api } from '../api.js';
import { estado, ehAdmin } from '../estado.js';
import { navegarPara } from '../roteador.js';
import { ENTIDADES } from '../entidades.js';

// Ícones de linha (24x24) usados no menu lateral.
const ICONES = {
  '/dashboard': '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  '/linha-do-tempo': '<path d="M3 6h9M3 12h14M3 18h7"/><circle cx="16" cy="6" r="1.6"/><circle cx="20" cy="18" r="1.6"/>',
  '/horas-projetos': '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  '/escalas': '<rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M8 3v3M16 3v3"/>',
  '/folgas': '<path d="M3 18h18M5 18c0-4 3-7 7-7s7 3 7 7M12 4v3M5.6 7.6l1.8 1.8M18.4 7.6l-1.8 1.8"/>',
  '/treinamentos': '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11.5V16c0 1.5 3 3 6 3s6-1.5 6-3v-4.5"/>',
  '/profissionais': '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16 4.5a3.5 3.5 0 010 7M18 14.3c2.2.7 3.5 2.6 3.5 5.7"/>',
  '/projetos': '<path d="M3 7a2 2 0 012-2h4l2 2.5h8a2 2 0 012 2V18a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>',
  '/locais': '<path d="M12 21s7-6.2 7-11.5A7 7 0 005 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  '/horarios': '<circle cx="12" cy="12" r="9"/><path d="M12 7v5h4"/>',
  '/periodos': '<path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z"/>',
  '/usuarios': '<rect x="4" y="10.5" width="16" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 018 0v3"/>',
};
function icone(caminho) {
  const no = document.createElement('span');
  no.className = 'nav-icone';
  no.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[caminho] ?? ''}</svg>`;
  return no;
}

function itemNav(caminho, rotulo) {
  const ativo = location.hash === `#${caminho}` || (caminho !== '/dashboard' && location.hash.startsWith(`#${caminho}`));
  return el('a', { href: `#${caminho}`, class: ativo ? 'ativo' : '' }, [icone(caminho), el('span', {}, rotulo)]);
}

function montarNav() {
  const nav = el('nav', {}, [
    itemNav('/dashboard', 'Painel'),
    itemNav('/linha-do-tempo', 'Linha do tempo'),
    ...(ehAdmin() ? [itemNav('/horas-projetos', 'Horas por projeto')] : []),
    el('div', { class: 'grupo-titulo' }, 'Agenda'),
    itemNav('/escalas', 'Escalas'),
    itemNav('/folgas', 'Folgas'),
    itemNav('/treinamentos', 'Treinamentos'),
  ]);
  // Cadastros são de uso exclusivo do administrador — o perfil usuário não vê nem acessa esta seção.
  if (ehAdmin()) {
    nav.append(
      el('div', { class: 'grupo-titulo' }, 'Cadastros'),
      itemNav('/profissionais', 'Profissionais'),
      itemNav('/projetos', 'Projetos'),
      itemNav('/locais', 'Locais'),
      itemNav('/horarios', 'Horários'),
      itemNav('/periodos', 'Feriados e recessos'),
      itemNav('/usuarios', 'Logins/Acesso'),
    );
  }
  return nav;
}

export function iniciais(nome) {
  const p = String(nome ?? '').trim().split(/\s+/).filter(Boolean);
  if (!p.length) return '?';
  return (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
}

let raizGlobal = null;
export function definirRaiz(raiz) { raizGlobal = raiz; }

/** Monta o layout (barra lateral + topo) e chama `preencherMiolo(elementoMiolo)` para a tela atual. */
export function renderizarLayout(tituloTopo, preencherMiolo) {
  const miolo = el('div', { class: 'miolo' }, el('p', {}, 'Carregando…'));
  const barraLateral = el('div', { class: 'barra-lateral' }, [
    el('div', { class: 'marca' }, [el('span', { class: 'marca-logo' }, 'E'), el('span', {}, 'Sistema de Escalas')]),
    montarNav(),
    el('div', { class: 'rodape-usuario' }, [
      el('div', { class: 'avatar' }, iniciais(estado.usuario?.nome)),
      el('div', { class: 'info-usuario' }, [
        el('div', { class: 'nome' }, estado.usuario?.nome ?? ''),
        el('div', { class: 'perfil' }, estado.usuario?.perfil === 'administrador' ? 'Administrador' : 'Usuário (somente leitura)'),
      ]),
      el('button', { class: 'botao pequeno botao-sair', onclick: sair }, 'Sair'),
    ]),
  ]);
  const topo = el('div', { class: 'topo' }, [
    el('button', { class: 'botao botao-menu', onclick: () => barraLateral.classList.toggle('aberta') }, '☰'),
    el('h1', {}, tituloTopo),
  ]);
  const conteudo = el('div', { class: 'conteudo' }, [topo, miolo]);
  montar(raizGlobal, el('div', { class: 'layout' }, [barraLateral, conteudo]));
  Promise.resolve(preencherMiolo(miolo)).catch((e) => {
    console.error(e);
    montar(miolo, el('div', { class: 'mensagem-erro-geral' }, 'Não foi possível carregar esta tela. Tente novamente.'));
  });
}

async function sair() {
  try { await api.post('/api/auth/logout'); } catch { /* mesmo se falhar, seguimos para o login */ }
  toast('Sessão encerrada.', 'info');
  navegarPara('/login');
}

export function registrarRotasDeCadastros(rota, viewLista, viewDetalhe, viewFormulario) {
  for (const chave of Object.keys(ENTIDADES)) {
    rota(`/${chave}`, (raiz, params, query) => viewLista(chave, params, query));
    rota(`/${chave}/novo`, () => viewFormulario(chave, {}));
    rota(`/${chave}/:id/editar`, (raiz, params) => viewFormulario(chave, params));
    rota(`/${chave}/:id`, (raiz, params) => viewDetalhe(chave, params));
  }
}
