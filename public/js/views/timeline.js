import { el, montar } from '../ui.js';
import { api, paraQuery } from '../api.js';
import { navegarPara } from '../roteador.js';
import { renderizarLayout } from './shell.js';
import { obterOpcoes, ehAdmin } from '../estado.js';
import { dataParaDias, diasParaData, diaDaSemana, diaDaSemanaAbrev, ehFimDeSemana, paraBR, hojeSaoPaulo, somarDias } from '../datahora.js';

const ALTURA_FAIXA = 22;
const ALTURA_MIN_LINHA = 40;
const ROTA_POR_TIPO = { escala: 'escalas', folga: 'folgas', treinamento: 'treinamentos' };

function primeiroDoMes(iso) { return `${iso.slice(0, 7)}-01`; }
function ultimoDoMes(iso) {
  const [a, m] = iso.split('-').map(Number);
  return diasParaData(Date.UTC(a, m, 1) / 86400000 - 1);
}
function listaDeDias(de, ate) {
  const dias = [];
  for (let d = dataParaDias(de); d <= dataParaDias(ate); d++) dias.push(diasParaData(d));
  return dias;
}

function atribuirFaixas(itens) {
  const ordenados = [...itens].sort((a, b) => a._ini - b._ini || a._fim - b._fim);
  const finsPorFaixa = [];
  for (const item of ordenados) {
    let faixa = finsPorFaixa.findIndex((fim) => fim < item._ini);
    if (faixa === -1) { faixa = finsPorFaixa.length; finsPorFaixa.push(item._fim); }
    else finsPorFaixa[faixa] = item._fim;
    item._faixa = faixa;
  }
  return finsPorFaixa.length || 1;
}

/** Trechos contíguos de dias em que o item realmente ocorre. Escala (quarto pedido de ajustes) já
 *  chega como uma ocorrência por célula da grade (um dia só, sem recorrência); folga e treinamento
 *  ainda podem ter `dias_semana` marcado. */
function segmentosAtivos(item, dias) {
  if (!item.dias_semana) return [{ ini: item._ini, fim: item._fim }];
  const permitidos = new Set(item.dias_semana);
  const ocorreNoDia = (iso) => permitidos.has(diaDaSemana(iso));
  const segmentos = [];
  let atual = null;
  for (let i = item._ini; i <= item._fim; i++) {
    if (ocorreNoDia(dias[i])) {
      if (atual) atual.fim = i; else atual = { ini: i, fim: i };
    } else if (atual) {
      segmentos.push(atual);
      atual = null;
    }
  }
  if (atual) segmentos.push(atual);
  return segmentos;
}

/** Escala (quarto pedido de ajustes) chega da API como um item por célula da grade — um profissional,
 *  um único dia. Sem isso, cada dia vira uma barra de um dia só e a dica ao passar o mouse mostra
 *  "dia a dia" em vez do período real da sequência (bug reportado no quinto pedido de ajustes). Aqui
 *  mescla dias consecutivos da MESMA escala, MESMO profissional e MESMO horário (hora_inicio/hora_fim/
 *  vira_dia) num único item contínuo antes de calcular faixas/segmentos/dica. `itens` já deve vir
 *  ordenado por `_ini`. Folga e treinamento não são células diárias — passam direto, sem mudança. */
function mesclarCelulasDeEscala(itens) {
  const outros = itens.filter((i) => i.tipo !== 'escala');
  const mesclados = [];
  for (const item of itens) {
    if (item.tipo !== 'escala') continue;
    const anterior = mesclados.at(-1);
    const mesmaSequencia = anterior && anterior.id === item.id
      && anterior.hora_inicio === item.hora_inicio && anterior.hora_fim === item.hora_fim && anterior.vira_dia === item.vira_dia
      && item._ini === anterior._fim + 1;
    if (mesmaSequencia) {
      anterior._fim = item._fim;
      anterior.data_final = item.data_final;
      anterior.conflitos = [...anterior.conflitos, ...item.conflitos];
    } else {
      mesclados.push({ ...item, conflitos: [...item.conflitos] });
    }
  }
  return [...outros, ...mesclados];
}

function iniciaisNome(nome) {
  const p = String(nome ?? '').trim().split(/\s+/).filter(Boolean);
  return p.length ? (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase() : '?';
}

export function viewLinhaDoTempo() {
  renderizarLayout('Linha do tempo', async (miolo) => {
    const hoje = hojeSaoPaulo();
    const opcoes = await obterOpcoes(api);
    const filtro = {
      inicio: primeiroDoMes(hoje), fim: ultimoDoMes(hoje),
      tipos: new Set(), status: '', profissional_id: '', projeto_id: '', local_id: '', q: '', cancelados: false,
    };

    const areaFiltros = el('div', {});
    const areaGrade = el('div', {});
    const contadorConflitos = el('span', {});
    montar(miolo, areaFiltros, areaGrade);
    desenharFiltros();
    await recarregar();

    function desenharFiltros() {
      const chk = (tipo, rotulo) => el('label', { class: 'campo-checkbox', style: 'display:inline-flex;margin-right:10px' }, [
        el('input', {
          type: 'checkbox', checked: filtro.tipos.has(tipo) || undefined,
          onchange: (e) => { e.target.checked ? filtro.tipos.add(tipo) : filtro.tipos.delete(tipo); recarregar(); },
        }), rotulo,
      ]);
      const selecao = (valor, aoMudar, opcoesLista, rotuloVazio) => el('select', { onchange: (e) => aoMudar(e.target.value) }, [
        el('option', { value: '' }, rotuloVazio),
        ...opcoesLista.map((o) => el('option', { value: o.id, selected: String(valor) === String(o.id) || undefined }, o.nome)),
      ]);

      montar(areaFiltros, el('div', { class: 'painel' }, [
        el('div', { class: 'timeline-cabecalho' }, [
          el('button', { class: 'botao pequeno', onclick: () => mudarPeriodo(-1) }, '← Mês anterior'),
          el('input', { type: 'date', value: filtro.inicio, onchange: (e) => { filtro.inicio = e.target.value; recarregar(); } }),
          el('span', {}, 'até'),
          el('input', { type: 'date', value: filtro.fim, onchange: (e) => { filtro.fim = e.target.value; recarregar(); } }),
          el('button', { class: 'botao pequeno', onclick: () => mudarPeriodo(1) }, 'Próximo mês →'),
          el('button', { class: 'botao pequeno', onclick: () => { filtro.inicio = primeiroDoMes(hojeSaoPaulo()); filtro.fim = ultimoDoMes(hojeSaoPaulo()); desenharFiltros(); recarregar(); } }, 'Hoje'),
          el('div', { class: 'espaco' }),
          contadorConflitos,
          ehAdmin() ? el('button', { class: 'botao', onclick: exportar }, 'Exportar CSV') : null,
        ]),
        el('div', { class: 'barra-ferramentas' }, [
          chk('escala', 'Escalas'), chk('folga', 'Folgas'), chk('treinamento', 'Treinamentos'),
          selecao(filtro.profissional_id, (v) => { filtro.profissional_id = v; recarregar(); }, opcoes.profissionais.map((p) => ({ id: p.id, nome: p.nome })), 'Todos os profissionais'),
          selecao(filtro.projeto_id, (v) => { filtro.projeto_id = v; recarregar(); }, opcoes.projetos.map((p) => ({ id: p.id, nome: p.nome })), 'Todos os projetos'),
          selecao(filtro.local_id, (v) => { filtro.local_id = v; recarregar(); }, opcoes.locais.map((l) => ({ id: l.id, nome: l.nome })), 'Todos os locais'),
          el('input', { type: 'search', placeholder: 'Buscar…', value: filtro.q, oninput: debounce((e) => { filtro.q = e.target.value; recarregar(); }, 350) }),
          el('label', { class: 'campo-checkbox', style: 'display:inline-flex' }, [
            el('input', { type: 'checkbox', checked: filtro.cancelados || undefined, onchange: (e) => { filtro.cancelados = e.target.checked; recarregar(); } }),
            'Mostrar cancelados/recusados',
          ]),
        ]),
        el('div', { class: 'timeline-legenda' }, [
          el('span', {}, [el('span', { class: 'marca', style: 'background:var(--cor-primaria)' }), 'Escala']),
          el('span', {}, [el('span', { class: 'marca', style: 'background:#8a6d00' }), 'Folga']),
          el('span', {}, [el('span', { class: 'marca', style: 'background:#4a7c3f' }), 'Treinamento']),
          el('span', {}, [el('span', { class: 'marca', style: 'background:repeating-linear-gradient(45deg,#9aa,#9aa 3px,#ccd 3px,#ccd 6px)' }), 'Planejado/solicitado']),
          el('span', {}, [el('span', { class: 'marca', style: 'border:2px solid var(--cor-perigo)' }), 'Em conflito']),
          el('span', {}, [el('span', { class: 'marca feriado-n' }), 'Feriado nacional']),
          el('span', {}, [el('span', { class: 'marca feriado-r' }), 'Estadual (mesma UF)']),
          el('span', {}, [el('span', { class: 'marca feriado-m' }), 'Municipal (mesma cidade)']),
        ]),
      ]));
    }

    function mudarPeriodo(delta) {
      filtro.inicio = somarDias(primeiroDoMes(filtro.inicio), delta > 0 ? 32 : -1);
      filtro.inicio = primeiroDoMes(filtro.inicio);
      filtro.fim = ultimoDoMes(filtro.inicio);
      desenharFiltros();
      recarregar();
    }

    function query() {
      return { inicio: filtro.inicio, fim: filtro.fim, tipo: [...filtro.tipos], profissional_id: filtro.profissional_id, projeto_id: filtro.projeto_id, local_id: filtro.local_id, q: filtro.q, cancelados: filtro.cancelados ? '1' : '' };
    }

    async function exportar() {
      await api.baixarCsv(`/api/timeline/exportar${paraQuery(query())}`, `linha-do-tempo-${filtro.inicio}-a-${filtro.fim}.csv`);
    }

    async function recarregar() {
      montar(areaGrade, el('p', {}, 'Carregando…'));
      let resp;
      try {
        resp = await api.get(`/api/timeline${paraQuery(query())}`);
      } catch (e) {
        montar(areaGrade, el('div', { class: 'mensagem-erro-geral' }, e.message));
        return;
      }
      montar(areaGrade, construirGrade(resp));
      montar(contadorConflitos, resp.total_conflitos > 0
        ? el('span', { style: 'color:var(--cor-perigo);font-weight:600' }, `⚠ ${resp.total_conflitos} conflito${resp.total_conflitos > 1 ? 's' : ''} no período`)
        : el('span', { style: 'color:var(--cor-sucesso)' }, 'Sem conflitos no período'));
    }

    function construirGrade(resp) {
      const dias = listaDeDias(resp.periodo.inicio, resp.periodo.fim);
      const idxPorData = new Map(dias.map((d, i) => [d, i]));
      const totalDias = dias.length;

      if (!resp.profissionais.length) {
        return el('div', { class: 'painel vazio' }, 'Nenhum profissional corresponde aos filtros selecionados.');
      }

      // Feriados/recessos por dia. Nacional (sem UF) vale para todos; regional só para o estado indicado.
      const periodosPorDia = new Map(dias.map((d) => [d, []]));
      for (const per of resp.periodos ?? []) {
        for (const d of dias) if (d >= per.data_inicial && d <= per.data_final) periodosPorDia.get(d).push(per);
      }
      const rotuloPeriodo = (per) => `${per.nome} (${per.cidade ? `${per.cidade}/${per.uf}` : per.uf ? per.uf : 'Nacional'})`;

      const grade = el('div', { class: 'timeline-grade', style: `--dias:${totalDias}` });
      grade.appendChild(el('div', { class: 'tl-canto', style: 'grid-row:1;grid-column:1' }));
      dias.forEach((d, i) => {
        const classes = ['tl-dia-cab'];
        if (d === resp.hoje) classes.push('hoje');
        if (ehFimDeSemana(d)) classes.push('fim-de-semana');
        const dosDia = periodosPorDia.get(d);
        if (dosDia.some((p) => !p.uf)) classes.push('feriado-nacional');
        if (dosDia.some((p) => p.uf && !p.cidade)) classes.push('feriado-regional');
        if (dosDia.some((p) => p.cidade)) classes.push('feriado-municipal');
        const ufsDoDia = [...new Set(dosDia.map((p) => (p.cidade ? `${p.cidade}/${p.uf}` : p.uf || 'BR')))];
        grade.appendChild(el('div', { class: classes.join(' '), title: dosDia.map(rotuloPeriodo).join('\n') || undefined, style: `grid-row:1;grid-column:${i + 2}` }, [
          diaDaSemanaAbrev(d), el('span', { class: 'dia-num' }, d.slice(8, 10)),
          dosDia.length ? el('span', { class: 'marca-feriado' }, ufsDoDia.join('/')) : null,
        ]));
      });

      resp.profissionais.forEach((prof, linhaIdx) => {
        const linha = linhaIdx + 2;
        const itensDoProf = mesclarCelulasDeEscala(resp.itens
          .filter((i) => i.profissional_ids.includes(prof.id))
          .map((i) => {
            const iniClamp = i.data_inicial < resp.periodo.inicio ? resp.periodo.inicio : i.data_inicial;
            const fimClamp = i.data_final > resp.periodo.fim ? resp.periodo.fim : i.data_final;
            return { ...i, _ini: idxPorData.get(iniClamp), _fim: idxPorData.get(fimClamp) };
          })
          .sort((a, b) => a._ini - b._ini));
        const faixas = atribuirFaixas(itensDoProf);
        const alturaLinha = Math.max(ALTURA_MIN_LINHA, faixas * ALTURA_FAIXA + 10);

        grade.appendChild(el('div', {
          class: `tl-linha-nome ${prof.status !== 'ativo' ? 'inativo' : ''}`,
          style: `grid-row:${linha};grid-column:1;min-height:${alturaLinha}px`,
        }, [el('span', { class: 'avatar-mini' }, iniciaisNome(prof.nome_completo)), el('span', { class: 'nome-bloco' }, [el('span', { class: 'nome-prof' }, prof.nome_completo), prof.cargo ? el('span', { class: 'cargo' }, prof.cargo) : null])]));

        for (let i = 0; i < totalDias; i++) {
          const classes = ['tl-celula'];
          if (ehFimDeSemana(dias[i])) classes.push('fim-de-semana');
          if (dias[i] === resp.hoje) classes.push('hoje-col');
          // Vale para esta linha: nacional (sempre), estadual (mesma UF) ou municipal (mesma UF e cidade).
          const valem = periodosPorDia.get(dias[i]).filter((p) => !p.uf || (p.uf === prof.uf && (!p.cidade || p.cidade === prof.cidade)));
          if (valem.some((p) => !p.uf)) classes.push('feriado-nacional');
          else if (valem.some((p) => p.cidade)) classes.push('feriado-municipal');
          else if (valem.length) classes.push('feriado-regional');
          grade.appendChild(el('div', { class: classes.join(' '), title: valem.map(rotuloPeriodo).join('\n') || undefined, style: `grid-row:${linha};grid-column:${i + 2};min-height:${alturaLinha}px` }));
        }

        const camada = el('div', { style: `grid-row:${linha};grid-column:2 / -1;position:relative;pointer-events:none` });
        for (const item of itensDoProf) {
          const emConflito = item.conflitos.some((c) => c.profissional_id === prof.id);
          const rotulo = item.hora_inicio ? `${item.titulo} (${item.hora_inicio}–${item.hora_fim})` : item.titulo;
          // Quinto pedido de ajustes (outubro): a dica mostra o período CADASTRADO da escala (campo
          // "Data inicial"/"Data final" do registro), não o dia da célula nem o trecho visual da
          // barra — que pode ser menor que o período se houver dias sem preenchimento no meio.
          const periodoIni = item.escala_data_inicial ?? item.data_inicial;
          const periodoFim = item.escala_data_final ?? item.data_final;
          const dica = `${item.titulo} — ${paraBR(periodoIni)} a ${paraBR(periodoFim)}${item.horario_nome ? ` — horário: ${item.horario_nome} (${item.hora_inicio}–${item.hora_fim})` : ''}${emConflito ? ' — CONFLITO DE AGENDA' : ''}`;
          // Uma barra por trecho contínuo de dias ativos: dias fora da recorrência ficam vazios.
          for (const seg of segmentosAtivos(item, dias)) {
            const largura = ((seg.fim - seg.ini + 1) / totalDias) * 100;
            const esquerda = (seg.ini / totalDias) * 100;
            // Feriado vinculado automaticamente (id negativo e "virtual": não existe cadastro de folga
            // por trás dele) não tem para onde navegar — mostra só a barra, sem clique.
            const ehFeriadoAutomatico = item.tipo === 'folga' && item.tipo_folga === 'feriado';
            camada.appendChild(el('div', {
              class: `tl-barra tipo-${item.tipo} status-${item.status} ${ehFeriadoAutomatico ? 'feriado-automatico' : ''} ${emConflito ? 'conflito' : ''}`,
              style: `left:${esquerda}%;width:${largura}%;top:${item._faixa * ALTURA_FAIXA + 4}px;height:${ALTURA_FAIXA - 4}px;pointer-events:auto`,
              title: dica,
              onclick: ehFeriadoAutomatico ? undefined : () => navegarPara(`/${ROTA_POR_TIPO[item.tipo]}/${item.id}`),
            }, rotulo));
          }
        }
        grade.appendChild(camada);
      });

      return el('div', { class: 'timeline-scroll' }, grade);
    }
  });
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
