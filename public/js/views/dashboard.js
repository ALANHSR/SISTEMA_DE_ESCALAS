import { el, montar, selo, fmtData } from '../ui.js';
import { api } from '../api.js';
import { navegarPara } from '../roteador.js';
import { renderizarLayout } from './shell.js';
import { diaDaSemanaAbrev, dataPorExtenso } from '../datahora.js';

// Ícones minúsculos em SVG inline (sem biblioteca/fonte externa — o app continua autossuficiente).
const svg = (d) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICONES = {
  calendario: svg('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>'),
  alerta: svg('<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>'),
  praia: svg('<path d="M12 22a1 1 0 0 1-1-1V13H3a1 1 0 0 1-.83-1.56C4.5 8 8 4.5 12 2c4 2.5 7.5 6 9.83 9.44A1 1 0 0 1 21 13h-8v8a1 1 0 0 1-1 1Z"/>'),
  formatura: svg('<path d="m22 10-10-5L2 10l10 5 10-5Z"/><path d="M6 12v5c0 1 2.5 2 6 2s6-1 6-2v-5"/>'),
  check: svg('<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>'),
};
const icone = (nome) => el('span', { html: ICONES[nome] });

function metrica(numero, rotulo) {
  return el('div', { class: 'metrica' }, [el('div', { class: 'numero' }, String(numero)), el('div', { class: 'rotulo' }, rotulo)]);
}

function linhaEscala(e) {
  return el('div', { class: 'linha-item' }, [
    el('span', { class: 'quando' }, e.vira_dia ? `${e.hora_inicio}–${e.hora_fim} (+1)` : `${e.hora_inicio}–${e.hora_fim}`),
    el('span', {}, [
      `${e.titulo}`, ' ', selo(e.status),
      e.profissionais?.length ? el('span', {}, ` — ${e.profissionais.join(', ')}`) : null,
      e.local_nome ? ` · ${e.local_nome}` : (e.remoto ? ' · Remoto' : ''),
    ]),
  ]);
}

function secaoVazia(texto) { return el('p', { class: 'vazio-secao' }, texto); }

export function viewDashboard() {
  renderizarLayout('Painel', async (miolo) => {
    const d = await api.get('/api/dashboard');

    const avisoDemo = d.demo ? el('div', { class: 'mensagem-aviso' }, 'Este ambiente contém dados de demonstração para fins de avaliação do sistema.') : null;

    const cabecalho = el('div', { class: 'painel-cabecalho' }, [
      el('h2', {}, 'Visão geral'),
      el('span', { class: 'data-hoje' }, dataPorExtenso(d.hoje)),
    ]);

    // O número de conflitos é o único elemento "ousado" da tela — é para onde o olho deve ir primeiro.
    const semConflito = d.contagens.conflitos === 0;
    const metricaConflitos = el('div', { class: `metrica metrica-urgente ${semConflito ? 'sem-conflito' : ''}` }, [
      el('div', {}, [
        el('div', { class: 'numero' }, String(d.contagens.conflitos)),
        el('div', { class: 'rotulo' }, semConflito ? 'Nenhum conflito nos próximos 30 dias' : 'Conflito(s) de agenda nos próximos 30 dias'),
      ]),
      icone(semConflito ? 'check' : 'alerta'),
    ]);

    const cartoes = el('div', { class: 'grade-metricas' }, [
      metricaConflitos,
      metrica(d.contagens.profissionais_ativos, 'Profissionais ativos'),
      metrica(d.contagens.projetos_ativos, 'Projetos ativos'),
      metrica(d.contagens.escalas_hoje, 'Escalas hoje'),
      metrica(d.contagens.folgas_aprovadas_periodo, 'Folgas aprovadas no mês'),
      metrica(d.contagens.treinamentos_proximos, 'Treinamentos próximos'),
    ]);

    function secao(categoria, iconeNome, titulo, contagemTexto, conteudo) {
      return el('div', { class: `secao secao--${categoria}` }, [
        el('div', { class: 'secao-cabecalho' }, [icone(iconeNome), el('h2', {}, titulo), contagemTexto ? el('span', { class: 'contagem' }, contagemTexto) : null]),
        ...conteudo,
      ]);
    }

    const secaoHoje = secao('escalas', 'calendario', `Escalas de hoje — ${fmtData(d.hoje)}`, null,
      [d.escalas_hoje.length ? el('div', {}, d.escalas_hoje.map(linhaEscala)) : secaoVazia('Nenhuma escala para hoje.')]);

    const secaoProximos = secao('escalas', 'calendario', 'Próximos 7 dias', null, [
      el('div', {}, d.proximos_dias.map((p) => el('div', { class: 'linha-item' }, [
        el('span', { class: 'quando' }, `${diaDaSemanaAbrev(p.data)} ${fmtData(p.data)}`),
        el('span', {}, p.total ? `${p.total} escala${p.total > 1 ? 's' : ''}: ${p.escalas.map((e) => e.titulo).join(', ')}` : 'Sem escalas'),
      ]))),
    ]);

    const secaoFeriados = secao('feriados', 'praia', 'Próximos feriados e recessos', `${d.feriados_proximos?.length ?? 0} em 60 dias`, [
      d.feriados_proximos?.length
        ? el('div', {}, d.feriados_proximos.map((f) => el('div', { class: 'linha-item' }, [
            el('span', { class: 'quando' }, f.data_inicial === f.data_final ? fmtData(f.data_inicial) : `${fmtData(f.data_inicial)} a ${fmtData(f.data_final)}`),
            el('span', {}, [`${f.nome} `, el('span', { class: `selo-uf ${f.uf ? '' : 'nacional'}` }, f.cidade ? `${f.cidade}/${f.uf}` : (f.uf || 'Nacional'))]),
          ])))
        : secaoVazia('Nenhum feriado ou recesso nos próximos 60 dias.'),
    ]);

    const secaoFolgas = secao('folgas', 'praia', 'Folgas aprovadas no período', `${d.folgas_periodo.length}`, [
      d.folgas_periodo.length
        ? el('div', {}, d.folgas_periodo.map((f) => el('div', { class: 'linha-item' }, [
            el('span', { class: 'quando' }, `${fmtData(f.data_inicial)} a ${fmtData(f.data_final)}`),
            el('span', {}, `${f.profissional_nome} — ${f.tipo}`),
          ])))
        : secaoVazia('Nenhuma folga aprovada no período.'),
    ]);

    const secaoTreinamentos = secao('treinamentos', 'formatura', 'Treinamentos próximos', `${d.treinamentos_proximos.length}`, [
      d.treinamentos_proximos.length
        ? el('div', {}, d.treinamentos_proximos.map((t) => el('div', { class: 'linha-item' }, [
            el('span', { class: 'quando' }, fmtData(t.data_inicial)),
            el('span', {}, [`${t.nome} `, selo(t.status), ` — ${t.local_nome ?? (t.remoto ? 'Remoto' : '')}`]),
          ])))
        : secaoVazia('Nenhum treinamento nos próximos 30 dias.'),
    ]);

    const secaoConflitos = secao('conflitos', 'alerta', 'Conflitos de agenda (30 dias)', `${d.conflitos.length}`, [
      d.conflitos.length
        ? el('div', {}, [
            ...d.conflitos.map((c) => el('div', { class: 'linha-item' }, [
              el('span', { class: 'quando' }, fmtData(c.data)),
              el('span', {}, `${c.profissional_nome}: ${c.a.titulo} × ${c.b.titulo}`),
            ])),
            el('button', { class: 'botao pequeno', style: 'margin-top:8px', onclick: () => navegarPara('/linha-do-tempo') }, 'Ver na linha do tempo'),
          ])
        : secaoVazia('Nenhum conflito nos próximos 30 dias.'),
    ]);

    montar(miolo, avisoDemo, cabecalho, cartoes, secaoHoje, secaoProximos, secaoFeriados, secaoFolgas, secaoTreinamentos, secaoConflitos);
  });
}
