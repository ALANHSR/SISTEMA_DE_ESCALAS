import { api, paraQuery, ErroApi } from '../api.js';
import { el, montar, tabela, paginacao, selo, toast, confirmar, confirmarConflitos, construirFormulario, fmtData, mensagemDeErro, abrirModal } from '../ui.js';
import { navegarPara } from '../roteador.js';
import { obterOpcoes, ehAdmin } from '../estado.js';
import { renderizarLayout } from './shell.js';
import { dataParaDias, diasParaData, diaDaSemanaAbrev, ehFimDeSemana } from '../datahora.js';

const STATUS = {
  escalas: [{ id: 'planejada', nome: 'Planejada' }, { id: 'confirmada', nome: 'Confirmada' }, { id: 'em_andamento', nome: 'Em andamento' }, { id: 'concluida', nome: 'Concluída' }, { id: 'cancelada', nome: 'Cancelada' }],
  folgas: [{ id: 'solicitada', nome: 'Solicitada' }, { id: 'aprovada', nome: 'Aprovada' }, { id: 'recusada', nome: 'Recusada' }, { id: 'cancelada', nome: 'Cancelada' }],
  treinamentos: [{ id: 'planejado', nome: 'Planejado' }, { id: 'confirmado', nome: 'Confirmado' }, { id: 'concluido', nome: 'Concluído' }, { id: 'cancelado', nome: 'Cancelado' }],
};
const TIPOS_FOLGA = [
  { id: 'folga_compensatoria', nome: 'Folga compensatória' }, { id: 'folga_semanal', nome: 'Folga semanal' }, { id: 'ferias', nome: 'Férias' },
  { id: 'licenca', nome: 'Licença' }, { id: 'banco_de_horas', nome: 'Banco de horas' }, { id: 'outro', nome: 'Outro' },
];
// Quinto pedido de ajustes (outubro): tipo do local (mesma lista do cadastro de Locais/Projetos),
// usado para filtrar o seletor de locais aqui também.
const TIPOS_LOCAL = [{ id: 'hospital', nome: 'Hospital' }, { id: 'clinica', nome: 'Clínica' }, { id: 'pronto_atendimento', nome: 'Pronto atendimento' }];

const NOMES_DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const textoDiasSemana = (dias) => (dias && dias.length ? dias.map((d) => NOMES_DIAS[d]).join(', ') : 'Todos os dias');
const textoDuracao = (min) => { const m = Number(min) || 0; const h = Math.floor(m / 60); const r = m % 60; return h ? (r ? `${h}h${r}min` : `${h}h`) : `${r}min`; };
const MESES_ABREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

// ---------------------------------------------------------------- Grade de dias da escala
// Quarto pedido de ajustes (outubro): a escala não tem mais um horário/recorrência único para todos
// os profissionais vinculados — cada célula (profissional × data) tem seu próprio horário, montada
// numa grade igual ao modelo enviado (profissionais nas linhas, datas nas colunas). Isso permite uma
// mesma escala reunir profissionais com dias e horários bem diferentes entre si.

/** Lista de datas ISO entre `de` e `ate` (inclusive), ou [] se o período ainda não foi preenchido/é inválido. */
function datasDoPeriodo(de, ate) {
  if (!de || !ate) return [];
  const ini = dataParaDias(de);
  const fim = dataParaDias(ate);
  if (!Number.isFinite(ini) || !Number.isFinite(fim) || fim < ini || fim - ini > 366) return [];
  const saida = [];
  for (let d = ini; d <= fim; d++) saida.push(diasParaData(d));
  return saida;
}

const rotuloColunaData = (iso) => {
  const [, m, d] = iso.split('-');
  return `${d}/${MESES_ABREV[Number(m) - 1]}`;
};

// Quinto pedido de ajustes (outubro): ao passar o mouse numa célula preenchida da grade (cadastro ou
// detalhe), mostra o horário cadastrado (início–término, com aviso de virada de dia).
function tituloHorario(h) {
  if (!h || !h.hora_inicio) return '';
  return `${h.nome ? `${h.nome}: ` : ''}${h.hora_inicio}–${h.hora_fim}${h.vira_dia ? ' (vira o dia)' : ''}`;
}

/**
 * Constrói o widget de grade (profissional × data → horário). `valoresIniciais.dias` (ao editar) é uma
 * lista de {profissional_id, data, horario_id}; `opcoes.profissionais`/`opcoes.horarios` vêm do /api/opcoes.
 * Devolve `{ no, ler(), atualizarPeriodo(de, ate) }`; `ler()` devolve a lista de células preenchidas.
 */
function construirGradeEscala({ profissionaisOpcoes, horariosOpcoes, profissionaisIniciais, celulasIniciais }) {
  // célula -> horario_id, chave `${profissional_id}|${data}`
  const celulas = new Map(celulasIniciais.map((c) => [`${c.profissional_id}|${c.data}`, c.horario_id]));
  const profissionaisSelecionados = [...profissionaisIniciais];
  let periodo = [];

  const container = el('div', { class: 'grade-escala-campo' });
  const areaAdicionar = el('div', { class: 'grade-escala-add' });
  const areaScroll = el('div', { class: 'grade-escala-scroll' });
  montar(container, el('label', {}, 'Profissionais/escala'), areaAdicionar, areaScroll);

  function profissionalNome(id) { return profissionaisOpcoes.find((p) => String(p.id) === String(id))?.nome ?? `Profissional ${id}`; }

  function desenharAdicionar() {
    const disponiveis = profissionaisOpcoes.filter((p) => !profissionaisSelecionados.includes(p.id));
    const sel = el('select', {}, [
      el('option', { value: '' }, 'Adicionar profissional…'),
      ...disponiveis.map((p) => el('option', { value: p.id }, `${p.nome}${p.status && p.status !== 'ativo' ? ' (inativo)' : ''}`)),
    ]);
    sel.addEventListener('change', () => {
      if (!sel.value) return;
      profissionaisSelecionados.push(Number(sel.value));
      desenhar();
    });
    montar(areaAdicionar, el('span', {}, `${profissionaisSelecionados.length} profissional${profissionaisSelecionados.length === 1 ? '' : 'is'} na grade`), sel);
  }

  function desenharGrade() {
    if (!periodo.length) {
      montar(areaScroll, el('div', { class: 'grade-escala-vazia' }, 'Informe a data de início e a data de término para montar a grade de dias.'));
      return;
    }
    if (!profissionaisSelecionados.length) {
      montar(areaScroll, el('div', { class: 'grade-escala-vazia' }, 'Adicione ao menos um profissional acima para preencher a grade.'));
      return;
    }
    const thead = el('thead', {}, el('tr', {}, [
      el('th', { class: 'col-profissional' }, 'Profissional'),
      ...periodo.map((iso) => el('th', { class: ehFimDeSemana(iso) ? 'fim-de-semana' : '' }, [rotuloColunaData(iso), el('br'), diaDaSemanaAbrev(iso).replace(/^./, (c) => c.toUpperCase())])),
    ]));
    const linhas = profissionaisSelecionados.map((pid) => {
      const selosData = {};
      const fillHorario = el('select', {}, [el('option', { value: '' }, 'horário…'), ...horariosOpcoes.map((h) => el('option', { value: h.id }, h.nome))]);
      const fillIntervalo = el('input', { type: 'number', min: '1', max: '31', value: '1', title: 'Repetir a cada quantos dias (1 = todo dia)' });
      // Quinto pedido de ajustes (outubro): condição de dia par/ímpar (baseada na data, não na posição
      // dentro do período — facilita montar escalas 12x36) e opção de pular finais de semana.
      const fillParidade = el('select', { title: 'Condição de dia par/ímpar baseada na data' }, [
        el('option', { value: '' }, 'par ou ímpar: todos'),
        el('option', { value: 'par' }, 'somente dias pares'),
        el('option', { value: 'impar' }, 'somente dias ímpares'),
      ]);
      const fillSemFinalDeSemana = el('input', { type: 'checkbox', id: `fds-${pid}` });
      const fillBtn = el('button', { type: 'button', class: 'botao pequeno' }, 'Preencher');
      fillBtn.addEventListener('click', () => {
        if (!fillHorario.value) { toast('Escolha um horário para preencher.', 'erro'); return; }
        const passo = Math.max(1, Number(fillIntervalo.value) || 1);
        periodo.forEach((iso, i) => {
          if (i % passo !== 0) return;
          if (fillSemFinalDeSemana.checked && ehFimDeSemana(iso)) return;
          if (fillParidade.value === 'par' && dataParaDias(iso) % 2 !== 0) return;
          if (fillParidade.value === 'impar' && dataParaDias(iso) % 2 === 0) return;
          celulas.set(`${pid}|${iso}`, Number(fillHorario.value));
          const s = selosData[iso];
          if (s) { s.value = fillHorario.value; s.title = tituloHorario(horariosOpcoes.find((h) => String(h.id) === fillHorario.value)); }
        });
      });
      const limparBtn = el('button', { type: 'button', class: 'botao pequeno' }, 'Limpar linha');
      limparBtn.addEventListener('click', () => { periodo.forEach((iso) => { celulas.delete(`${pid}|${iso}`); const s = selosData[iso]; if (s) { s.value = ''; s.title = ''; } }); });
      const removerBtn = el('button', { type: 'button', class: 'botao pequeno texto' }, 'Remover');
      removerBtn.addEventListener('click', () => {
        periodo.forEach((iso) => celulas.delete(`${pid}|${iso}`));
        profissionaisSelecionados.splice(profissionaisSelecionados.indexOf(pid), 1);
        desenhar();
      });
      const nomeCel = el('td', { class: 'col-profissional' }, [
        el('div', { class: 'grade-escala-linha-nome' }, [profissionalNome(pid), removerBtn]),
        el('div', { class: 'grade-escala-preencher' }, [
          'a cada', fillIntervalo, 'dia(s),', fillParidade, 'horário', fillHorario,
          el('label', { for: `fds-${pid}`, class: 'grade-escala-fds' }, [fillSemFinalDeSemana, ' pular fim de semana']),
          fillBtn, limparBtn,
        ]),
      ]);
      const cels = periodo.map((iso) => {
        const chave = `${pid}|${iso}`;
        const horarioAtual = () => horariosOpcoes.find((h) => String(h.id) === String(celulas.get(chave) ?? ''));
        const sel = el('select', { title: tituloHorario(horarioAtual()) }, [
          el('option', { value: '' }, '—'),
          ...horariosOpcoes.map((h) => el('option', { value: h.id, selected: String(celulas.get(chave) ?? '') === String(h.id) || undefined }, h.nome)),
        ]);
        sel.addEventListener('change', () => {
          if (sel.value) celulas.set(chave, Number(sel.value)); else celulas.delete(chave);
          sel.title = tituloHorario(horarioAtual());
        });
        selosData[iso] = sel;
        return el('td', { class: `col-celula ${ehFimDeSemana(iso) ? 'fim-de-semana' : ''}` }, sel);
      });
      return el('tr', {}, [nomeCel, ...cels]);
    });
    montar(areaScroll, el('table', { class: 'tabela-grade-escala' }, [thead, el('tbody', {}, linhas)]));
  }

  function desenhar() { desenharAdicionar(); desenharGrade(); }
  desenhar();

  return {
    no: container,
    atualizarPeriodo(de, ate) { periodo = datasDoPeriodo(de, ate); desenhar(); },
    ler() {
      const saida = [];
      for (const [chave, horario_id] of celulas) {
        const [profissional_id, data] = chave.split('|');
        if (periodo.includes(data)) saida.push({ profissional_id: Number(profissional_id), data, horario_id });
      }
      return saida;
    },
  };
}

/** Mesma grade, mas só para leitura — usada na tela de detalhe de uma escala já salva. */
function renderizarGradeEscalaSomenteLeitura(d) {
  const periodo = datasDoPeriodo(d.data_inicial, d.data_final);
  const profissionais = d.profissionais ?? [];
  if (!periodo.length || !profissionais.length) {
    return el('div', { class: 'grade-detalhe-escala grade-escala-vazia' }, 'Nenhum dia preenchido na grade desta escala.');
  }
  const porCelula = new Map((d.dias ?? []).map((c) => [`${c.profissional_id}|${c.data}`, c]));
  const thead = el('thead', {}, el('tr', {}, [
    el('th', { class: 'col-profissional' }, 'Profissional'),
    ...periodo.map((iso) => el('th', { class: ehFimDeSemana(iso) ? 'fim-de-semana' : '' }, [rotuloColunaData(iso), el('br'), diaDaSemanaAbrev(iso).replace(/^./, (c) => c.toUpperCase())])),
  ]));
  const linhas = profissionais.map((p) => el('tr', {}, [
    el('td', { class: 'col-profissional' }, p.nome),
    ...periodo.map((iso) => {
      const c = porCelula.get(`${p.id}|${iso}`);
      return el('td', { class: `col-celula ${ehFimDeSemana(iso) ? 'fim-de-semana' : ''}`, title: c ? tituloHorario(c) : undefined }, c ? c.horario_nome : '');
    }),
  ]));
  return el('div', { class: 'grade-detalhe-escala' }, [
    el('div', { class: 'item-detalhe rotulo' }, 'Grade de dias'),
    el('div', { class: 'grade-escala-scroll' }, el('table', { class: 'tabela-grade-escala' }, [thead, el('tbody', {}, linhas)])),
  ]);
}

const CONFIGS = {
  escalas: {
    titulo: 'Escala', tituloPlural: 'Escalas',
    colunas: [
      { chave: 'titulo', titulo: 'Título', ordenavel: true },
      { chave: 'projeto_nome', titulo: 'Projeto' },
      { chave: 'locais_nomes', titulo: 'Locais' },
      { chave: 'data_inicial', titulo: 'Início', ordenavel: true, render: (l) => fmtData(l.data_inicial) },
      { chave: 'data_final', titulo: 'Término', render: (l) => fmtData(l.data_final) },
      { chave: 'total_dias', titulo: 'Dias na grade' },
      { chave: 'profissionais_nomes', titulo: 'Profissionais' },
      { chave: 'status', titulo: 'Situação', render: (l) => selo(l.status) },
    ],
    filtros: [{ nome: 'status', rotulo: 'Situação', opcoes: STATUS.escalas }],
    // A grade de dias (profissional × data × horário) não é um campo do formulário genérico — é
    // montada à parte por construirGradeEscala() e anexada ao formulário em viewFormularioAgenda.
    campos: (opcoes) => [
      { nome: 'titulo', rotulo: 'Título', tipo: 'texto', largo: true },
      { nome: 'projeto_id', rotulo: 'Projeto', tipo: 'selecao', opcoes: opcoes.projetos.map((p) => ({ id: p.id, nome: `${p.codigo} — ${p.nome}` })) },
      { nome: 'local_ids', rotulo: 'Locais', tipo: 'multisselecao', largo: true, comAtalhos: true, comBusca: true, opcoes: opcoes.locais.map((l) => ({ id: l.id, nome: l.nome, status: l.status, tipo: l.tipo })), filtroFonte: { campo: 'tipo', opcoes: TIPOS_LOCAL } },
      { nome: 'data_inicial', rotulo: 'Data inicial', tipo: 'data' },
      { nome: 'data_final', rotulo: 'Data final', tipo: 'data' },
      { nome: 'status', rotulo: 'Situação', tipo: 'selecao', opcoes: STATUS.escalas, opcaoVazia: null },
      { nome: 'descricao', rotulo: 'Descrição', tipo: 'textoLongo', largo: true },
      { nome: 'observacoes', rotulo: 'Observações', tipo: 'textoLongo', largo: true },
    ],
  },
  folgas: {
    titulo: 'Folga', tituloPlural: 'Folgas',
    colunas: [
      { chave: 'profissional_nome', titulo: 'Profissional', ordenavel: true },
      { chave: 'tipo', titulo: 'Tipo', render: (l) => TIPOS_FOLGA.find((t) => t.id === l.tipo)?.nome ?? l.tipo },
      { chave: 'data_inicial', titulo: 'Início', ordenavel: true, render: (l) => fmtData(l.data_inicial) },
      { chave: 'data_final', titulo: 'Término', render: (l) => fmtData(l.data_final) },
      { chave: 'status', titulo: 'Situação', render: (l) => selo(l.status) },
    ],
    filtros: [
      { nome: 'status', rotulo: 'Situação', opcoes: STATUS.folgas },
      { nome: 'tipo', rotulo: 'Tipo', opcoes: TIPOS_FOLGA },
    ],
    campos: (opcoes) => [
      { nome: 'profissional_id', rotulo: 'Profissional', tipo: 'selecao', opcoes: opcoes.profissionais.map((p) => ({ id: p.id, nome: p.nome })) },
      { nome: 'tipo', rotulo: 'Tipo de folga', tipo: 'selecao', opcoes: TIPOS_FOLGA },
      { nome: 'data_inicial', rotulo: 'Data inicial', tipo: 'data' },
      { nome: 'data_final', rotulo: 'Data final', tipo: 'data' },
      { nome: 'dias_semana', rotulo: 'Dias da semana em que vale', tipo: 'diasSemana', largo: true },
      { nome: 'status', rotulo: 'Situação', tipo: 'selecao', opcoes: STATUS.folgas, opcaoVazia: null },
      { nome: 'motivo', rotulo: 'Motivo ou observação', tipo: 'textoLongo', largo: true },
    ],
  },
  treinamentos: {
    titulo: 'Treinamento', tituloPlural: 'Treinamentos',
    colunas: [
      { chave: 'nome', titulo: 'Nome', ordenavel: true },
      { chave: 'instrutor', titulo: 'Instrutor' },
      { chave: 'projeto_nome', titulo: 'Projeto', render: (l) => l.projeto_nome ?? '—' },
      { chave: 'local_nome', titulo: 'Local', render: (l) => l.local_nome ?? (l.remoto ? 'Remoto' : '—') },
      { chave: 'data_inicial', titulo: 'Início', ordenavel: true, render: (l) => fmtData(l.data_inicial) },
      { chave: 'duracao_minutos', titulo: 'Duração', render: (l) => textoDuracao(l.duracao_minutos) },
      { chave: 'profissionais_nomes', titulo: 'Participantes' },
      { chave: 'status', titulo: 'Situação', render: (l) => selo(l.status) },
    ],
    filtros: [{ nome: 'status', rotulo: 'Situação', opcoes: STATUS.treinamentos }],
    campos: (opcoes) => [
      { nome: 'nome', rotulo: 'Nome', tipo: 'texto', largo: true },
      { nome: 'instrutor', rotulo: 'Instrutor ou responsável', tipo: 'texto' },
      { nome: 'projeto_id', rotulo: 'Projeto (opcional)', tipo: 'selecao', opcoes: opcoes.projetos.map((p) => ({ id: p.id, nome: `${p.codigo} — ${p.nome}` })) },
      { nome: 'remoto', rotulo: 'Treinamento remoto', tipo: 'booleano' },
      { nome: 'local_id', rotulo: 'Local', tipo: 'selecao', opcoes: opcoes.locais.map((l) => ({ id: l.id, nome: l.nome, tipo: l.tipo })), filtroFonte: { campo: 'tipo', opcoes: TIPOS_LOCAL }, exibirSe: (v) => !v.remoto },
      { nome: 'data_inicial', rotulo: 'Data inicial', tipo: 'data' },
      { nome: 'data_final', rotulo: 'Data final', tipo: 'data' },
      { nome: 'duracao_minutos', rotulo: 'Duração de cada encontro (minutos)', tipo: 'numero', min: 1, max: 1439 },
      { nome: 'status', rotulo: 'Situação', tipo: 'selecao', opcoes: STATUS.treinamentos, opcaoVazia: null },
      { nome: 'observacoes', rotulo: 'Observações', tipo: 'textoLongo', largo: true },
    ],
  },
};

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

/** POST/PUT com tratamento do 409 de conflito: pergunta se deve salvar mesmo assim (regra 8). */
async function salvarComConflito(chamar, corpo) {
  try {
    return await chamar(corpo);
  } catch (e) {
    if (e instanceof ErroApi && e.status === 409 && e.podeForcar) {
      const forcar = await confirmarConflitos(e.conflitos);
      if (!forcar) throw e;
      return chamar({ ...corpo, forcar: true });
    }
    throw e;
  }
}


// ---------------------------------------------------------------- Importação em massa (CSV)
const MODELO_CSV = [
  'Título;Código do projeto;Local;Data inicial;Data final;Horário;Situação;Dias da semana;Profissionais;Descrição',
  'Plantão manhã;MSL-01;Base São Paulo – Barra Funda;05/10/2026;30/10/2026;D1;Planejada;Seg, Ter, Qua, Qui, Sex;Marina Albuquerque | Juliana Matos;Escala de exemplo',
  'Plantão noturno;;;05/10/2026;09/10/2026;Noturno;Confirmada;Todos;Rafael Nogueira;',
].join('\r\n');

function baixarModelo() {
  const blob = new Blob(['\uFEFF' + MODELO_CSV], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'modelo-importacao-escalas.csv';
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

function abrirImportacao(aoConcluir) {
  abrirModal((fechar) => {
    const arquivo = el('input', { type: 'file', accept: '.csv,text/csv' });
    const forcar = el('input', { type: 'checkbox' });
    const resultado = el('div', {});
    const botao = el('button', { class: 'botao primario' }, 'Importar');

    botao.addEventListener('click', async () => {
      const f = arquivo.files?.[0];
      if (!f) { toast('Selecione um arquivo CSV.', 'erro'); return; }
      botao.disabled = true;
      montar(resultado, el('p', {}, 'Importando…'));
      try {
        const texto = await f.text();
        const r = await api.post('/api/escalas/importar', { csv: texto, forcar_conflitos: forcar.checked });
        const falhas = r.resultados.filter((x) => !x.ok);
        montar(resultado,
          el('div', { class: falhas.length ? 'mensagem-aviso' : 'painel', style: 'margin-top:12px' },
            `${r.criadas} de ${r.total} escala${r.total === 1 ? '' : 's'} importada${r.criadas === 1 ? '' : 's'}${falhas.length ? `; ${falhas.length} com erro (abaixo).` : '.'}`),
          falhas.length ? el('ul', { class: 'lista-conflitos' }, falhas.map((x) => el('li', {}, `Linha ${x.linha}${x.titulo ? ` (${x.titulo})` : ''}: ${x.erros.join(' ')}`))) : null);
        if (r.criadas > 0) aoConcluir();
      } catch (e) {
        montar(resultado, el('div', { class: 'mensagem-erro-geral' }, mensagemDeErro(e)));
      } finally {
        botao.disabled = false;
      }
    });

    return [
      el('h2', {}, 'Importar escalas por CSV'),
      el('p', {}, 'Cada linha do arquivo vira uma escala, com as mesmas validações e verificação de conflitos do cadastro manual. Linhas com problema são listadas ao final e não impedem as demais.'),
      el('p', {}, [el('button', { class: 'botao pequeno', onclick: baixarModelo }, 'Baixar modelo CSV')]),
      el('p', { style: 'font-size:0.83rem;color:var(--cor-texto-suave)' },
        'Use o nome completo exato dos profissionais (vários separados por "|"), o código do projeto, o nome exato do local e o nome de um horário já cadastrado (tela de Horários). Datas em DD/MM/AAAA; dias da semana como "Seg, Ter, Qua", "Dias úteis" ou "Todos". O horário e os dias valem para todos os profissionais da linha; para um mesmo posto com profissionais em dias/horários diferentes, use o cadastro manual (tela de Escalas) ou uma linha por padrão.'),
      el('div', { class: 'campo' }, [arquivo]),
      el('label', { class: 'campo-checkbox', style: 'margin-top:10px;display:flex' }, [forcar, 'Importar mesmo havendo conflitos de agenda']),
      resultado,
      el('div', { class: 'acoes-form' }, [botao, el('button', { class: 'botao', onclick: fechar }, 'Fechar')]),
    ];
  });
}

// ---------------------------------------------------------------- Listagem
export function viewListaAgenda(chave) {
  const cfg = CONFIGS[chave];
  renderizarLayout(cfg.tituloPlural, async (miolo) => {
    const estadoLista = { pagina: 1, ordenar: null, dir: 'asc', q: '', filtros: Object.fromEntries(cfg.filtros.map((f) => [f.nome, ''])) };
    const painel = el('div', { class: 'painel' });
    montar(miolo, painel);

    async function recarregar() {
      montar(painel, el('p', {}, 'Carregando…'));
      let resp;
      try {
        resp = await api.get(`/api/${chave}${paraQuery({ pagina: estadoLista.pagina, porPagina: 20, ordenar: estadoLista.ordenar, dir: estadoLista.dir, q: estadoLista.q, ...estadoLista.filtros })}`);
      } catch (e) { montar(painel, el('p', { class: 'mensagem-erro-geral' }, e.message)); return; }
      renderizar(resp);
    }

    function renderizar(resp) {
      const barra = el('div', { class: 'barra-ferramentas' }, [
        el('input', { type: 'search', placeholder: 'Buscar…', value: estadoLista.q, oninput: debounce((e) => { estadoLista.q = e.target.value; estadoLista.pagina = 1; recarregar(); }, 350) }),
        ...cfg.filtros.map((f) => el('select', { onchange: (e) => { estadoLista.filtros[f.nome] = e.target.value; estadoLista.pagina = 1; recarregar(); } }, [
          el('option', { value: '' }, f.rotulo),
          ...f.opcoes.map((o) => el('option', { value: o.id, selected: estadoLista.filtros[f.nome] === String(o.id) || undefined }, o.nome)),
        ])),
        el('div', { class: 'espaco' }),
        ehAdmin() ? el('button', { class: 'botao', onclick: () => api.baixarCsv(`/api/${chave}/exportar${paraQuery({ q: estadoLista.q, ...estadoLista.filtros })}`, `${chave}.csv`) }, 'Exportar CSV') : null,
        chave === 'escalas' && ehAdmin() ? el('button', { class: 'botao', onclick: () => abrirImportacao(recarregar) }, 'Importar CSV') : null,
        ehAdmin() ? el('button', { class: 'botao primario', onclick: () => navegarPara(`/${chave}/novo`) }, `+ Novo${chave === 'folgas' ? 'a' : ''} ${cfg.titulo.toLowerCase()}`) : null,
      ]);
      const colunas = [...cfg.colunas, {
        chave: '_acoes', titulo: '', acoes: true,
        render: (l) => el('div', {}, [
          el('button', { class: 'botao pequeno texto', onclick: () => navegarPara(`/${chave}/${l.id}`) }, 'Ver'),
          ehAdmin() ? el('button', { class: 'botao pequeno texto', onclick: () => navegarPara(`/${chave}/${l.id}/editar`) }, 'Editar') : null,
        ]),
      }];
      const t = tabela({
        colunas, linhas: resp.dados, chaveOrdenar: estadoLista.ordenar, direcao: estadoLista.dir,
        aoOrdenar: (c) => { estadoLista.dir = estadoLista.ordenar === c && estadoLista.dir === 'asc' ? 'desc' : 'asc'; estadoLista.ordenar = c; recarregar(); },
      });
      montar(painel, barra, t, paginacao({ pagina: resp.pagina, porPagina: resp.porPagina, total: resp.total, aoMudar: (p) => { estadoLista.pagina = p; recarregar(); } }));
    }
    await recarregar();
  });
}

// ---------------------------------------------------------------- Detalhe
function tabelaParticipantes(d) {
  if (!d.participantes?.length) return null;
  return el('div', { class: 'tabela-rolavel', style: 'margin-top:1rem' }, el('table', { class: 'tabela' }, [
    el('thead', {}, el('tr', {}, ['Participante', 'Dias e horários', 'Encontros', 'Horas'].map((t) => el('th', {}, t)))),
    el('tbody', {}, d.participantes.map((p) => el('tr', {}, [
      el('td', {}, p.profissional_nome),
      el('td', {}, p.horarios.map((h) => `${textoDiasSemana(h.dias_semana)} — ${h.hora_inicio} às ${h.hora_fim}`).join(' · ')),
      el('td', {}, String(p.encontros)),
      el('td', {}, textoDuracao(p.minutos)),
    ]))),
  ]));
}

export function viewDetalheAgenda(chave, { id }) {
  const cfg = CONFIGS[chave];
  renderizarLayout(cfg.titulo, async (miolo) => {
    let d;
    try { d = (await api.get(`/api/${chave}/${id}`)).dado; }
    catch (e) { montar(miolo, el('div', { class: 'mensagem-erro-geral' }, e.message)); return; }
    render(d);

    function item(rotulo, valor) { return el('div', { class: 'item-detalhe' }, [el('div', { class: 'rotulo' }, rotulo), el('div', { class: 'valor' }, valor ?? '—')]); }

    function render(d) {
      const grade = el('div', { class: 'grade-detalhe' });
      let gradeEscala = null;
      if (chave === 'escalas') {
        grade.append(item('Título', d.titulo), item('Projeto', d.projeto?.nome ?? '—'), item('Locais', d.locais?.length ? d.locais.map((l) => l.nome).join(', ') : (d.projeto?.remoto ? 'Remoto' : '—')),
          item('Período', `${fmtData(d.data_inicial)} a ${fmtData(d.data_final)}`), item('Situação', selo(d.status)),
          item('Profissionais', d.profissionais?.map((p) => p.nome).join(', ') || '—'));
        gradeEscala = renderizarGradeEscalaSomenteLeitura(d);
      } else if (chave === 'folgas') {
        grade.append(item('Profissional', d.profissional?.nome ?? '—'), item('Tipo', TIPOS_FOLGA.find((t) => t.id === d.tipo)?.nome ?? d.tipo),
          item('Período', `${fmtData(d.data_inicial)} a ${fmtData(d.data_final)}`), item('Dias da semana', textoDiasSemana(d.dias_semana)), item('Situação', selo(d.status)),
          item('Decidido por', d.aprovado_por_nome ? `${d.aprovado_por_nome}` : '—'), item('Motivo', d.motivo));
      } else {
        grade.append(item('Nome', d.nome), item('Instrutor', d.instrutor), item('Projeto', d.projeto?.nome ?? '—'), item('Local', d.local?.nome ?? (d.remoto ? 'Remoto' : '—')),
          item('Período', `${fmtData(d.data_inicial)} a ${fmtData(d.data_final)}`), item('Duração de cada encontro', textoDuracao(d.duracao_minutos)),
          item('Situação', selo(d.status)), item('Total de horas', textoDuracao(d.horas_total_minutos)));
        gradeEscala = tabelaParticipantes(d);
      }

      const painelConflitos = d.conflitos?.length
        ? el('div', { class: 'painel' }, [el('h2', {}, 'Conflitos de agenda'), el('ul', { class: 'lista-conflitos' }, d.conflitos.map((c) => el('li', {}, c.mensagem)))])
        : null;

      const acoes = el('div', { class: 'acoes-form' }, [
        el('button', { class: 'botao', onclick: () => navegarPara(`/${chave}`) }, '← Voltar'),
        ehAdmin() ? el('button', { class: 'botao primario', onclick: () => navegarPara(`/${chave}/${id}/editar`) }, 'Editar') : null,
      ]);
      if (ehAdmin()) {
        const sel = el('select', {}, STATUS[chave].map((o) => el('option', { value: o.id, selected: o.id === d.status || undefined }, o.nome)));
        acoes.append(sel, el('button', {
          class: 'botao', onclick: async () => {
            if (sel.value === d.status) return;
            if (!(await confirmar(`Alterar a situação para "${sel.options[sel.selectedIndex].text}"?`))) return;
            try {
              const r = await salvarComConflito((corpo) => api.post(`/api/${chave}/${id}/status`, corpo), { status: sel.value });
              toast('Situação atualizada.', 'sucesso');
              render(r.dado);
            } catch (e) { toast(mensagemDeErro(e), 'erro'); }
          },
        }, 'Alterar situação'));
      }

      const painelHist = ehAdmin() && d.historico?.length
        ? el('div', { class: 'painel' }, [el('h2', {}, 'Histórico'), ...d.historico.map((h) => el('div', { class: 'linha-historico' }, [
            el('span', { class: 'quando' }, fmtData((h.criado_em || '').slice(0, 10))), el('span', {}, `${h.usuario_nome ?? 'Sistema'} — ${h.acao}`),
          ]))])
        : null;

      montar(miolo, el('div', { class: 'painel' }, [grade, gradeEscala, acoes]), painelConflitos, painelHist);
    }
  });
}


// ---------------------------------------------------------------- Participantes e horários do treinamento
// Cada participante tem seus próprios dias da semana e seus próprios horários de início; a duração do
// encontro é única (campo do treinamento). Ao salvar, cada horário vira uma linha {profissional, dias, hora}.
function construirHorariosTreinamento({ profissionaisOpcoes, slotsIniciais }) {
  // Agrupa os horários iniciais por profissional + dias (ex.: Adriana seg–qui 09:00 e 14:00 = 1 linha, 2 horários).
  const grupos = [];
  for (const sl of slotsIniciais ?? []) {
    const chave = `${sl.profissional_id}|${(sl.dias_semana ?? []).join(',')}`;
    let g = grupos.find((x) => x.chave === chave);
    if (!g) { g = { chave, profissional_id: sl.profissional_id, dias: sl.dias_semana ?? [], horas: [] }; grupos.push(g); }
    g.horas.push(sl.hora_inicio);
  }
  const linhas = [];
  const no = el('div', { class: 'campo largo', id: 'campo-horarios' });
  const lista = el('div', { class: 'lista-horarios-trein' });
  const erroNo = el('div', { class: 'erro-campo' });
  let duracaoMin = null;
  let resumoNo = null;

  function novaLinha(g) {
    const estadoL = { profissional_id: g?.profissional_id ?? '', dias: new Set(g?.dias ?? []), horas: [...(g?.horas ?? ['09:00'])] };
    const raiz = el('div', { class: 'painel linha-trein', style: 'margin:.5rem 0;padding:.75rem' });
    function desenhar() {
      const selProf = el('select', { onchange: (e) => { estadoL.profissional_id = e.target.value ? Number(e.target.value) : ''; } }, [
        el('option', { value: '' }, 'Selecione o profissional…'),
        ...profissionaisOpcoes.filter((p) => p.status === 'ativo' || p.id === estadoL.profissional_id)
          .map((p) => el('option', { value: p.id, selected: p.id === estadoL.profissional_id || undefined }, p.nome)),
      ]);
      const dias = el('div', { style: 'display:flex;gap:.5rem;flex-wrap:wrap' }, NOMES_DIAS.map((nome, i) => el('label', { style: 'display:flex;align-items:center;gap:.25rem' }, [
        el('input', { type: 'checkbox', checked: estadoL.dias.has(i) || undefined, onchange: (e) => { e.target.checked ? estadoL.dias.add(i) : estadoL.dias.delete(i); atualizarResumo(); } }), nome,
      ])));
      const atalhos = el('div', { style: 'display:flex;gap:.5rem;margin:.25rem 0' }, [
        el('button', { type: 'button', class: 'botao pequeno', onclick: () => { estadoL.dias = new Set([1, 2, 3, 4, 5]); desenhar(); atualizarResumo(); } }, 'Seg–Sex'),
        el('button', { type: 'button', class: 'botao pequeno', onclick: () => { estadoL.dias = new Set([0, 1, 2, 3, 4, 5, 6]); desenhar(); atualizarResumo(); } }, 'Todos os dias'),
      ]);
      const horas = el('div', { style: 'display:flex;gap:.5rem;flex-wrap:wrap;align-items:center' }, [
        ...estadoL.horas.map((h, idx) => el('span', { style: 'display:inline-flex;gap:.25rem;align-items:center' }, [
          el('input', { type: 'time', value: h, onchange: (e) => { estadoL.horas[idx] = e.target.value; atualizarResumo(); } }),
          estadoL.horas.length > 1 ? el('button', { type: 'button', class: 'botao pequeno', title: 'Remover horário', onclick: () => { estadoL.horas.splice(idx, 1); desenhar(); atualizarResumo(); } }, '×') : null,
        ])),
        el('button', { type: 'button', class: 'botao pequeno', onclick: () => { estadoL.horas.push(''); desenhar(); } }, '+ horário'),
      ]);
      montar(raiz,
        el('div', { style: 'display:flex;justify-content:space-between;gap:.5rem;align-items:center' }, [
          el('div', { style: 'flex:1' }, selProf),
          el('button', { type: 'button', class: 'botao pequeno perigo', onclick: () => { linhas.splice(linhas.indexOf(estadoL), 1); raiz.remove(); atualizarResumo(); } }, 'Remover participante'),
        ]),
        el('div', { class: 'rotulo', style: 'margin-top:.5rem' }, 'Dias da semana'), dias, atalhos,
        el('div', { class: 'rotulo' }, 'Horários de início'), horas);
    }
    estadoL.no = raiz;
    linhas.push(estadoL);
    desenhar();
    lista.append(raiz);
  }

  function ler() {
    const out = [];
    for (const l of linhas) {
      if (l.profissional_id === '' && l.dias.size === 0 && l.horas.every((h) => !h)) continue;
      const dias = [...l.dias].sort((a, b) => a - b);
      for (const h of l.horas) out.push({ profissional_id: l.profissional_id === '' ? null : l.profissional_id, dias_semana: dias.length ? dias : [], hora_inicio: h });
    }
    return out;
  }

  function atualizarResumo() {
    if (!resumoNo) return;
    const slots = ler().filter((x) => x.profissional_id && x.hora_inicio);
    const dur = Number(duracaoMin) || 0;
    resumoNo.textContent = slots.length && dur ? `${slots.length} horário(s) por semana × ${textoDuracao(dur)} por encontro.` : '';
  }

  resumoNo = el('div', { class: 'ajuda' });
  grupos.forEach((g) => novaLinha(g));
  if (!grupos.length) novaLinha(null);
  no.append(el('label', {}, 'Participantes e horários'),
    el('div', { class: 'ajuda' }, 'Cada participante tem seus próprios dias e horários. Exemplo: Alan — sexta às 09:00 e 14:00; Ivan — seg a sex às 20:00.'),
    lista, el('button', { type: 'button', class: 'botao pequeno', onclick: () => novaLinha(null) }, '+ Adicionar participante'), resumoNo, erroNo);

  return {
    no, ler,
    definirDuracao(v) { duracaoMin = v; atualizarResumo(); },
    mostrarErro(msg) { erroNo.textContent = msg ?? ''; },
  };
}

// ---------------------------------------------------------------- Formulário
export function viewFormularioAgenda(chave, { id }) {
  const cfg = CONFIGS[chave];
  if (!ehAdmin()) { navegarPara('/dashboard'); return; }
  const editando = Boolean(id);

  renderizarLayout(`${editando ? 'Editar' : 'Nov' + (chave === 'folgas' ? 'a' : 'o')} ${cfg.titulo.toLowerCase()}`, async (miolo) => {
    const [opcoes, valoresIniciais] = await Promise.all([obterOpcoes(api), editando ? api.get(`/api/${chave}/${id}`).then((r) => r.dado) : Promise.resolve({})]);
    let erros = {};
    let erroGeral = null;
    let campos = cfg.campos(opcoes);
    let form = construirFormulario({ campos, valores: valoresIniciais, erros, opcoesPorCampo: {} });
    const temCondicionais = campos.some((c) => c.exibirSe);

    // A grade de dias da escala vive fora de construirFormulario (não é um campo simples) e não deve
    // ser recriada a cada redesenho — senão perderia o que já foi marcado nas células.
    let gradeEscala = null;
    if (chave === 'escalas') {
      const celulasIniciais = valoresIniciais.dias ?? [];
      gradeEscala = construirGradeEscala({
        profissionaisOpcoes: opcoes.profissionais, horariosOpcoes: opcoes.horarios,
        profissionaisIniciais: [...new Set(celulasIniciais.map((c) => c.profissional_id))],
        celulasIniciais,
      });
      gradeEscala.atualizarPeriodo(valoresIniciais.data_inicial, valoresIniciais.data_final);
    }

    // A grade fica entre "Situação" e "Descrição" (e não ao final do formulário): insere o nó da
    // grade dentro do grid de campos, logo antes do campo Descrição. Precisa ser chamada de novo
    // sempre que o formulário for reconstruído (construirFormulario devolve um nó novo).
    function inserirGradeNoForm() {
      if (chave !== 'escalas' || !gradeEscala) return;
      const descricaoWrap = form.no.querySelector('#campo-descricao')?.closest('.campo');
      if (descricaoWrap) form.no.insertBefore(gradeEscala.no, descricaoWrap);
      else form.no.appendChild(gradeEscala.no);
    }
    inserirGradeNoForm();

    // Participantes e horários do treinamento: widget fora do construirFormulario (preserva o digitado).
    let horariosTrein = null;
    if (chave === 'treinamentos') {
      horariosTrein = construirHorariosTreinamento({ profissionaisOpcoes: opcoes.profissionais, slotsIniciais: valoresIniciais.horarios });
      horariosTrein.definirDuracao(valoresIniciais.duracao_minutos);
    }
    function inserirHorariosNoForm() {
      if (!horariosTrein) return;
      const obs = form.no.querySelector('#campo-observacoes')?.closest('.campo');
      if (obs) form.no.insertBefore(horariosTrein.no, obs); else form.no.appendChild(horariosTrein.no);
    }
    inserirHorariosNoForm();

    function ligarCondicionais() {
      if (horariosTrein) form.no.addEventListener('input', (e) => { if (e.target.id === 'campo-duracao_minutos') horariosTrein.definirDuracao(e.target.value); });
      if (chave === 'escalas') {
        form.no.addEventListener('change', (e) => {
          if (e.target.id === 'campo-data_inicial' || e.target.id === 'campo-data_final') {
            const v = form.ler();
            gradeEscala.atualizarPeriodo(v.data_inicial, v.data_final);
          }
        });
      }
      if (!temCondicionais) return;
      form.no.addEventListener('change', (e) => {
        if (e.target.type !== 'checkbox' || e.target.closest('.lista-multisel')) return;
        Object.assign(valoresIniciais, form.ler());
        form = construirFormulario({ campos, valores: valoresIniciais, erros, opcoesPorCampo: {} });
        inserirGradeNoForm();
        inserirHorariosNoForm();
        desenhar();
        ligarCondicionais();
      });
    }
    desenhar();
    ligarCondicionais();

    function desenhar() {
      montar(miolo, el('div', { class: 'painel' }, [
        erroGeral ? el('div', { class: 'mensagem-erro-geral' }, erroGeral) : null,
        form.no,
        chave === 'escalas' && erros.dias ? el('div', { class: 'erro-campo' }, erros.dias) : null,
        el('div', { class: 'acoes-form' }, [
          el('button', { class: 'botao primario', onclick: salvar }, editando ? 'Salvar alterações' : 'Criar'),
          el('button', { class: 'botao', onclick: () => navegarPara(editando ? `/${chave}/${id}` : `/${chave}`) }, 'Cancelar'),
        ]),
      ]));
    }

    async function salvar() {
      const dados = form.ler();
      if (chave === 'escalas') dados.dias = gradeEscala.ler();
      if (chave === 'treinamentos') dados.horarios = horariosTrein.ler();
      try {
        const r = await salvarComConflito((corpo) => (editando ? api.put(`/api/${chave}/${id}`, corpo) : api.post(`/api/${chave}`, corpo)), dados);
        toast(editando ? 'Alterações salvas.' : `${cfg.titulo} criad${chave === 'folgas' ? 'a' : 'o'}.`, 'sucesso');
        navegarPara(`/${chave}/${r.dado.id}`);
      } catch (e) {
        if (e instanceof ErroApi && e.campos) {
          erros = e.campos; erroGeral = e.message;
          Object.assign(valoresIniciais, dados);
          form = construirFormulario({ campos, valores: valoresIniciais, erros, opcoesPorCampo: {} });
          inserirGradeNoForm();
          inserirHorariosNoForm();
          if (horariosTrein) horariosTrein.mostrarErro(e.campos.horarios);
          desenhar();
          ligarCondicionais();
        } else if (e instanceof ErroApi) {
          toast(e.message, 'erro');
        } else {
          throw e;
        }
      }
    }
  });
}
