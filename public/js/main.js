import { rota, iniciarRoteador, navegarPara } from './roteador.js';
import { el, montar } from './ui.js';
import { api, definirCsrf, definirAoExpirar, definirAoExigirTrocaSenha } from './api.js';
import { definirUsuario, estado } from './estado.js';
import { definirRaiz, registrarRotasDeCadastros } from './views/shell.js';
import { viewLogin } from './views/login.js';
import { viewDashboard } from './views/dashboard.js';
import { viewLinhaDoTempo } from './views/timeline.js';
import { viewHorasProjetos } from './views/horas.js';
import { viewTrocarSenhaObrigatoria } from './views/trocar-senha-obrigatoria.js';
import { viewListaEntidade, viewDetalheEntidade, viewFormularioEntidade } from './views/cadastro.js';
import { viewListaAgenda, viewDetalheAgenda, viewFormularioAgenda } from './views/agenda.js';

const raiz = document.getElementById('app');
const carregando = document.getElementById('app-carregando');
definirRaiz(raiz);

function exigirSessao(renderizar) {
  return async (raizEl, params, query) => {
    if (!estado.usuario) { navegarPara('/login'); return; }
    if (estado.usuario.deveTrocarSenha) { navegarPara('/trocar-senha-obrigatoria'); return; }
    await renderizar(raizEl, params, query);
  };
}

rota('/login', async (raizEl) => {
  if (estado.usuario) { navegarPara('/dashboard'); return; }
  viewLogin(raizEl);
});
rota('/trocar-senha-obrigatoria', async (raizEl) => {
  if (!estado.usuario) { navegarPara('/login'); return; }
  viewTrocarSenhaObrigatoria(raizEl);
});
rota('/dashboard', exigirSessao(() => viewDashboard()));
rota('/linha-do-tempo', exigirSessao(() => viewLinhaDoTempo()));
rota('/horas-projetos', exigirSessao(() => viewHorasProjetos()));

for (const chave of ['escalas', 'folgas', 'treinamentos']) {
  rota(`/${chave}`, exigirSessao(() => viewListaAgenda(chave)));
  rota(`/${chave}/novo`, exigirSessao(() => viewFormularioAgenda(chave, {})));
  rota(`/${chave}/:id/editar`, exigirSessao((raizEl, params) => viewFormularioAgenda(chave, params)));
  rota(`/${chave}/:id`, exigirSessao((raizEl, params) => viewDetalheAgenda(chave, params)));
}

registrarRotasDeCadastros(
  (padrao, render) => rota(padrao, exigirSessao(render)),
  viewListaEntidade, viewDetalheEntidade, viewFormularioEntidade,
);

function naoEncontrada(raizEl) {
  montar(raizEl, el('div', { style: 'padding:40px;text-align:center' }, [
    el('h1', {}, 'Página não encontrada'),
    el('a', { href: '#/dashboard' }, 'Voltar ao painel'),
  ]));
}

definirAoExpirar(() => {
  definirUsuario(null);
  navegarPara('/login');
});
definirAoExigirTrocaSenha(() => navegarPara('/trocar-senha-obrigatoria'));

async function iniciar() {
  try {
    const r = await api.get('/api/auth/me');
    definirCsrf(r.csrf_token);
    definirUsuario(r.usuario);
  } catch {
    definirUsuario(null);
  }

  carregando.hidden = true;
  raiz.hidden = false;

  if (!estado.usuario && (location.hash === '' || location.hash === '#/')) navegarPara('/login');
  else if (estado.usuario?.deveTrocarSenha && location.hash !== '#/trocar-senha-obrigatoria') navegarPara('/trocar-senha-obrigatoria');
  else if (estado.usuario && !estado.usuario.deveTrocarSenha && (location.hash === '' || location.hash === '#/' || location.hash === '#/login')) navegarPara('/dashboard');

  await iniciarRoteador(raiz, naoEncontrada);
}

iniciar();
