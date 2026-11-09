import { api, paraQuery } from '../api.js';
import { el, montar, tabela, selo, fmtData } from '../ui.js';
import { navegarPara } from '../roteador.js';
import { obterOpcoes, ehAdmin } from '../estado.js';
import { renderizarLayout } from './shell.js';

// Mesmo formato da planilha de planejamento de horas: "4h4min", "195h", "40min".
export function fmtHoras(min) {
  const h = Math.floor(min / 60);
  const m = Math.round(min - h * 60);
  if (h === 0 && m === 0) return '0h';
  if (h === 0) return `${m}min`;
  return m === 0 ? `${h}h` : `${h}h${m}min`;
}

/** Horas e pessoal por projeto: treinamento + operação assistida (escalas), com detalhe por profissional. */
export function viewHorasProjetos() {
  if (!ehAdmin()) { navegarPara('/dashboard'); return; }
  renderizarLayout('Horas por projeto', async (miolo) => {
    const opcoes = await obterOpcoes(api);
    const filtro = { inicio: '', fim: '', projeto_id: '', considerar: 'todas' };
    const areaFiltros = el('div', {});
    const areaResultado = el('div', {});
    montar(miolo, areaFiltros, areaResultado);

    const query = () => ({ ...filtro });

    function desenharFiltros() {
      montar(areaFiltros, el('div', { class: 'painel' }, [
        el('div', { class: 'barra-ferramentas' }, [
          el('label', {}, 'De '), el('input', { type: 'date', value: filtro.inicio, onchange: (e) => { filtro.inicio = e.target.value; recarregar(); } }),
          el('label', {}, ' até '), el('input', { type: 'date', value: filtro.fim, onchange: (e) => { filtro.fim = e.target.value; recarregar(); } }),
          el('select', { onchange: (e) => { filtro.projeto_id = e.target.value; recarregar(); } }, [
            el('option', { value: '' }, 'Todos os projetos'),
            ...opcoes.projetos.map((p) => el('option', { value: p.id, selected: String(filtro.projeto_id) === String(p.id) || undefined }, p.nome)),
          ]),
          el('select', { onchange: (e) => { filtro.considerar = e.target.value; recarregar(); } }, [
            el('option', { value: 'todas', selected: filtro.considerar === 'todas' || undefined }, 'Planejadas e confirmadas'),
            el('option', { value: 'firmes', selected: filtro.considerar === 'firmes' || undefined }, 'Só confirmadas/concluídas'),
          ]),
          el('button', { class: 'botao pequeno', onclick: () => { Object.assign(filtro, { inicio: '', fim: '', projeto_id: '', considerar: 'todas' }); desenharFiltros(); recarregar(); } }, 'Limpar filtros'),
          el('div', { class: 'espaco' }),
          el('button', { class: 'botao', onclick: () => api.baixarCsv(`/api/horas-projetos/exportar${paraQuery(query())}`, 'horas-por-projeto.csv') }, 'Exportar CSV'),
        ]),
        el('p', { class: 'dica-campo' }, 'Treinamento = duração de cada encontro × participantes. Op. assistida = horas previstas do horário de cada dia preenchido na grade das escalas. Em branco, soma todo o período cadastrado.'),
      ]));
    }

    async function recarregar() {
      montar(areaResultado, el('p', {}, 'Carregando…'));
      let r;
      try { r = await api.get(`/api/horas-projetos${paraQuery(query())}`); } catch (e) {
        montar(areaResultado, el('div', { class: 'mensagem-erro-geral' }, e.message));
        return;
      }
      const cartao = (titulo, valor) => el('div', { class: 'cartao-metrica' }, [el('div', { class: 'valor' }, valor), el('div', { class: 'rotulo' }, titulo)]);
      const resumo = el('div', { class: 'grade-metricas' }, [
        cartao('Projetos', String(r.projetos.length)),
        cartao('Profissionais envolvidos', String(r.totais.profissionais)),
        cartao('Treinamento', fmtHoras(r.totais.treinamento_min)),
        cartao('Op. assistida', fmtHoras(r.totais.operacao_min)),
        cartao('Total de horas', fmtHoras(r.totais.total_min)),
      ]);
      const blocos = r.projetos.length ? r.projetos.map((p) => {
        const linhas = r.detalhe.filter((d) => d.projeto_id === p.id);
        return el('div', { class: 'painel' }, [
          el('div', { class: 'barra-ferramentas' }, [
            el('strong', {}, p.nome),
            el('span', {}, `${p.data_inicial ? fmtData(p.data_inicial) : '—'} a ${p.data_final ? fmtData(p.data_final) : '—'}`),
            selo(p.status, undefined, 'selo-projeto'),
            el('div', { class: 'espaco' }),
            el('span', {}, `${p.total_profissionais} profissional(is) · Treinamento ${fmtHoras(p.treinamento_min)} · Op. assistida ${fmtHoras(p.operacao_min)} · `),
            el('strong', {}, `Total ${fmtHoras(p.total_min)}`),
          ]),
          tabela({
            colunas: [
              { chave: 'profissional_nome', titulo: 'Profissional' }, { chave: 'funcao', titulo: 'Função', render: (l) => l.funcao ?? '—' },
              { chave: 'treinamento_min', titulo: 'Treinamento', render: (l) => (l.treinamento_min ? fmtHoras(l.treinamento_min) : 'N/A') },
              { chave: 'operacao_min', titulo: 'Op. assistida', render: (l) => (l.operacao_min ? fmtHoras(l.operacao_min) : 'N/A') },
              { chave: 'total_min', titulo: 'Total de horas', render: (l) => fmtHoras(l.total_min) },
            ],
            linhas, vazio: 'Nenhuma hora lançada neste projeto no período.',
          }),
        ]);
      }) : [el('div', { class: 'vazio' }, 'Nenhuma hora lançada em projetos no período/filtros escolhidos.')];
      montar(areaResultado, resumo, ...blocos);
    }

    desenharFiltros();
    await recarregar();
  });
}
