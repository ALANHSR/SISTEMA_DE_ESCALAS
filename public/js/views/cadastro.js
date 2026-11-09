import { api, paraQuery, ErroApi } from '../api.js';
import { el, montar, tabela, paginacao, selo, toast, confirmar, construirFormulario, fmtData, mensagemDeErro } from '../ui.js';
import { navegarPara } from '../roteador.js';
import { ENTIDADES } from '../entidades.js';
import { obterOpcoes, ehAdmin } from '../estado.js';
import { renderizarLayout } from './shell.js';

const MAPA_FONTE_OPCOES = { locais: 'locais', profissionais: 'profissionais', projetos: 'projetos', horarios: 'horarios' };

async function opcoesPorCampo(cfg) {
  const precisa = cfg.campos.some((c) => c.fonteOpcoes);
  if (!precisa) return {};
  const opcoes = await obterOpcoes(api);
  const saida = {};
  for (const c of cfg.campos) if (c.fonteOpcoes) saida[c.nome] = opcoes[MAPA_FONTE_OPCOES[c.fonteOpcoes]] ?? [];
  return saida;
}

function campoStatus(cfg) { return cfg.campos.find((c) => c.nome === 'status'); }

// ---------------------------------------------------------------- Listagem
export async function viewListaEntidade(chave, params, query) {
  const cfg = ENTIDADES[chave];
  if (cfg.somenteAdmin && !ehAdmin()) { navegarPara('/dashboard'); return; }

  renderizarLayout(cfg.tituloPlural, async (miolo) => {
    const estadoLista = {
      pagina: Number(query.get('pagina')) || 1,
      ordenar: query.get('ordenar') || null,
      dir: query.get('dir') || 'asc',
      q: query.get('q') || '',
      filtros: Object.fromEntries((cfg.filtros ?? []).map((f) => [f.nome, query.get(f.nome) || ''])),
    };

    const painel = el('div', { class: 'painel' });
    montar(miolo, painel);

    async function recarregar() {
      montar(painel, el('p', {}, 'Carregando…'));
      let resp;
      try {
        resp = await api.get(`/api/${chave}${paraQuery({ pagina: estadoLista.pagina, porPagina: 20, ordenar: estadoLista.ordenar, dir: estadoLista.dir, q: estadoLista.q, ...estadoLista.filtros })}`);
      } catch (e) {
        montar(painel, el('p', { class: 'mensagem-erro-geral' }, e.message));
        return;
      }
      renderizar(resp);
    }

    function renderizar(resp) {
      const barra = el('div', { class: 'barra-ferramentas' }, [
        cfg.busca ? el('input', {
          type: 'search', placeholder: 'Buscar…', value: estadoLista.q,
          oninput: debounce((e) => { estadoLista.q = e.target.value; estadoLista.pagina = 1; recarregar(); }, 350),
        }) : null,
        ...(cfg.filtros ?? []).map((f) => el('select', {
          onchange: (e) => { estadoLista.filtros[f.nome] = e.target.value; estadoLista.pagina = 1; recarregar(); },
        }, [
          el('option', { value: '' }, f.rotulo),
          ...f.opcoes.map((o) => el('option', { value: o.id, selected: estadoLista.filtros[f.nome] === String(o.id) || undefined }, o.nome)),
        ])),
        el('div', { class: 'espaco' }),
        ehAdmin() ? el('button', { class: 'botao', onclick: () => api.baixarCsv(`/api/${chave}/exportar${paraQuery({ q: estadoLista.q, ...estadoLista.filtros })}`, `${chave}.csv`) }, 'Exportar CSV') : null,
        ehAdmin() ? el('button', { class: 'botao primario', onclick: () => navegarPara(`/${chave}/novo`) }, `+ Novo ${cfg.tituloSingular.toLowerCase()}`) : null,
      ]);

      const colunas = [...cfg.colunas, {
        chave: '_acoes', titulo: '', acoes: true,
        render: (l) => el('div', {}, [
          el('button', { class: 'botao pequeno texto', onclick: () => navegarPara(`/${chave}/${l.id}`) }, 'Ver'),
          ehAdmin() ? el('button', { class: 'botao pequeno texto', onclick: () => navegarPara(`/${chave}/${l.id}/editar`) }, 'Editar') : null,
        ]),
      }];
      const t = tabela({
        colunas: colunas.map((c) => (c.chave === 'status' ? { ...c, render: (l) => selo(l.status, undefined, cfg.classeSeloStatus) } : c)),
        linhas: resp.dados, chaveOrdenar: estadoLista.ordenar, direcao: estadoLista.dir,
        aoOrdenar: (chaveCol) => {
          estadoLista.dir = estadoLista.ordenar === chaveCol && estadoLista.dir === 'asc' ? 'desc' : 'asc';
          estadoLista.ordenar = chaveCol;
          recarregar();
        },
      });
      montar(painel, barra, t, paginacao({
        pagina: resp.pagina, porPagina: resp.porPagina, total: resp.total,
        aoMudar: (p) => { estadoLista.pagina = p; recarregar(); },
      }));
    }

    await recarregar();
  });
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ---------------------------------------------------------------- Detalhe
export async function viewDetalheEntidade(chave, { id }) {
  const cfg = ENTIDADES[chave];
  if (cfg.somenteAdmin && !ehAdmin()) { navegarPara('/dashboard'); return; }

  renderizarLayout(cfg.tituloSingular, async (miolo) => {
    let dado;
    try {
      dado = (await api.get(`/api/${chave}/${id}`)).dado;
    } catch (e) {
      montar(miolo, el('div', { class: 'mensagem-erro-geral' }, e.message));
      return;
    }
    render(dado);

    function itemDetalhe(rotulo, valor) {
      return el('div', { class: 'item-detalhe' }, [el('div', { class: 'rotulo' }, rotulo), el('div', { class: 'valor' }, valor ?? '—')]);
    }

    function render(d) {
      const grade = el('div', { class: 'grade-detalhe' });
      for (const c of cfg.colunas) {
        if (c.chave === '_acoes' || c.chave === 'locais_nomes') continue;
        const v = c.chave === 'status' ? selo(d.status, undefined, cfg.classeSeloStatus) : (c.render ? c.render(d) : d[c.chave]);
        grade.appendChild(itemDetalhe(c.titulo, v));
      }
      if (chave === 'projetos' && d.locais?.length) grade.appendChild(itemDetalhe('Locais associados', d.locais.map((l) => l.nome).join(', ')));
      grade.appendChild(itemDetalhe('Observações', d.observacoes || d.descricao));
      grade.appendChild(itemDetalhe('Criado por', d.criado_por_nome ? `${d.criado_por_nome} em ${fmtData((d.criado_em || '').slice(0, 10))}` : '—'));
      grade.appendChild(itemDetalhe('Última atualização', d.atualizado_por_nome ? `${d.atualizado_por_nome} em ${fmtData((d.atualizado_em || '').slice(0, 10))}` : '—'));

      const acoes = el('div', { class: 'acoes-form' }, [
        el('button', { class: 'botao', onclick: () => navegarPara(`/${chave}`) }, '← Voltar'),
        ehAdmin() ? el('button', { class: 'botao primario', onclick: () => navegarPara(`/${chave}/${id}/editar`) }, 'Editar') : null,
      ]);
      const campoSt = campoStatus(cfg);
      if (ehAdmin() && campoSt) {
        const sel = el('select', {}, campoSt.opcoes.map((o) => el('option', { value: o.id, selected: o.id === d.status || undefined }, o.nome)));
        acoes.appendChild(sel);
        acoes.appendChild(el('button', {
          class: 'botao', onclick: async () => {
            if (sel.value === d.status) return;
            if (!(await confirmar(`Alterar a situação para "${sel.options[sel.selectedIndex].text}"?`))) return;
            try {
              const r = await api.post(`/api/${chave}/${id}/status`, { status: sel.value });
              toast('Situação atualizada.', 'sucesso');
              render(r.dado);
            } catch (e) { toast(mensagemDeErro(e), 'erro'); }
          },
        }, 'Alterar situação'));
      }

      const painelHist = [];
      if (ehAdmin() && d.historico?.length) {
        painelHist.push(el('div', { class: 'painel' }, [
          el('h2', {}, 'Histórico'),
          ...d.historico.map((h) => el('div', { class: 'linha-historico' }, [
            el('span', { class: 'quando' }, fmtData((h.criado_em || '').slice(0, 10))),
            el('span', {}, `${h.usuario_nome ?? 'Sistema'} — ${h.acao}`),
          ])),
        ]));
      }

      montar(miolo, el('div', { class: 'painel' }, [grade, acoes]), ...painelHist);
    }
  });
}

// ---------------------------------------------------------------- Formulário (criar/editar)
export async function viewFormularioEntidade(chave, { id }) {
  const cfg = ENTIDADES[chave];
  if (!ehAdmin()) { navegarPara('/dashboard'); return; }
  const editando = Boolean(id);

  renderizarLayout(`${editando ? 'Editar' : 'Novo'} ${cfg.tituloSingular.toLowerCase()}`, async (miolo) => {
    const [opcoes, valoresIniciais] = await Promise.all([
      opcoesPorCampo(cfg),
      editando ? api.get(`/api/${chave}/${id}`).then((r) => r.dado) : Promise.resolve({}),
    ]);

    let erroGeral = null;
    let erros = {};
    const form = construirFormulario({ campos: cfg.campos, valores: valoresIniciais, erros, opcoesPorCampo: opcoes });
    desenhar();

    function desenhar() {
      const conteudo = [
        erroGeral ? el('div', { class: 'mensagem-erro-geral' }, erroGeral) : null,
        form.no,
        el('div', { class: 'acoes-form' }, [
          el('button', { class: 'botao primario', onclick: salvar }, editando ? 'Salvar alterações' : 'Criar'),
          el('button', { class: 'botao', onclick: () => navegarPara(editando ? `/${chave}/${id}` : `/${chave}`) }, 'Cancelar'),
        ]),
      ];
      montar(miolo, el('div', { class: 'painel' }, conteudo));
    }

    async function salvar() {
      const dados = form.ler();
      try {
        const r = editando ? await api.put(`/api/${chave}/${id}`, dados) : await api.post(`/api/${chave}`, dados);
        toast(editando ? 'Alterações salvas.' : `${cfg.tituloSingular} criado.`, 'sucesso');
        navegarPara(`/${chave}/${r.dado.id}`);
      } catch (e) {
        if (e instanceof ErroApi && e.campos) {
          erros = e.campos;
          erroGeral = e.message;
          Object.assign(valoresIniciais, dados);
          const novo = construirFormulario({ campos: cfg.campos, valores: valoresIniciais, erros, opcoesPorCampo: opcoes });
          form.no = novo.no; form.ler = novo.ler;
          desenhar();
        } else {
          toast(e.message, 'erro');
        }
      }
    }
  });
}
