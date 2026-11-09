import { paraBR } from './datahora.js';

function achatar(lista, saida = []) {
  for (const item of lista) {
    if (item === undefined || item === null || item === false) continue;
    if (Array.isArray(item)) achatar(item, saida);
    else saida.push(item);
  }
  return saida;
}

export function el(tag, atributos = {}, filhos = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(atributos)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const f of achatar([].concat(filhos))) {
    n.appendChild(typeof f === 'string' || typeof f === 'number' ? document.createTextNode(String(f)) : f);
  }
  return n;
}

export function limpar(no) { while (no.firstChild) no.removeChild(no.firstChild); }
export function montar(no, ...filhos) { limpar(no); for (const f of achatar(filhos)) no.appendChild(f); }

// ---------------------------------------------------------------- Toasts
let areaToasts = null;
export function toast(mensagem, tipo = 'info') {
  if (!areaToasts) {
    areaToasts = el('div', { class: 'area-toasts' });
    document.body.appendChild(areaToasts);
  }
  const t = el('div', { class: `toast ${tipo}` }, mensagem);
  areaToasts.appendChild(t);
  setTimeout(() => t.remove(), 5000);
}

// ---------------------------------------------------------------- Modal
export function abrirModal(conteudoFn) {
  const sobreposicao = el('div', { class: 'sobreposicao', onclick: (e) => { if (e.target === sobreposicao) fechar(); } });
  const modal = el('div', { class: 'modal' });
  function fechar() { sobreposicao.remove(); document.removeEventListener('keydown', aoEsc); }
  function aoEsc(e) { if (e.key === 'Escape') fechar(); }
  document.addEventListener('keydown', aoEsc);
  montar(modal, conteudoFn(fechar));
  sobreposicao.appendChild(modal);
  document.body.appendChild(sobreposicao);
  return fechar;
}

export function confirmar(mensagem, { titulo = 'Confirmar', textoBotao = 'Confirmar', perigo = false } = {}) {
  return new Promise((resolver) => {
    const fechar = abrirModal((fechar) => [
      el('h2', {}, titulo),
      el('p', {}, mensagem),
      el('div', { class: 'acoes-form' }, [
        el('button', { class: 'botao', onclick: () => { fechar(); resolver(false); } }, 'Cancelar'),
        el('button', { class: `botao primario ${perigo ? 'perigo' : ''}`, onclick: () => { fechar(); resolver(true); } }, textoBotao),
      ]),
    ]);
    void fechar;
  });
}

/** Modal de conflitos de agenda: mostra a lista e pergunta se deve salvar mesmo assim (regra 8). */
export function confirmarConflitos(conflitos) {
  return new Promise((resolver) => {
    abrirModal((fechar) => [
      el('h2', {}, 'Conflitos de agenda'),
      el('p', {}, `Foram encontrados ${conflitos.length === 1 ? '1 conflito' : `${conflitos.length} conflitos`}:`),
      el('ul', { class: 'lista-conflitos' }, conflitos.map((c) => el('li', {}, c.mensagem))),
      el('p', {}, 'Deseja salvar mesmo assim?'),
      el('div', { class: 'acoes-form' }, [
        el('button', { class: 'botao', onclick: () => { fechar(); resolver(false); } }, 'Cancelar'),
        el('button', { class: 'botao primario perigo', onclick: () => { fechar(); resolver(true); } }, 'Salvar mesmo assim'),
      ]),
    ]);
  });
}

// ---------------------------------------------------------------- Selo de situação
// `extra` permite uma variação de cor específica de uma tela (ex.: Projetos usa azul/laranja em
// vez do verde/amarelo padrão para os mesmos valores "ativo"/"pausado").
const ROTULOS_SELO = {
  planejamento: 'Planejado', em_andamento: 'Em andamento', concluido: 'Concluído', concluida: 'Concluída',
  pausado: 'Pausado', cancelado: 'Cancelado', cancelada: 'Cancelada', planejado: 'Planejado', planejada: 'Planejada',
  confirmado: 'Confirmado', confirmada: 'Confirmada', ativo: 'Ativo', inativo: 'Inativo',
};
export function selo(valor, rotulo, extra) {
  return el('span', { class: extra ? `selo ${valor} ${extra}` : `selo ${valor}` }, rotulo ?? ROTULOS_SELO[valor] ?? valor);
}

// ---------------------------------------------------------------- Tabela genérica
export function tabela({ colunas, linhas, chaveOrdenar, direcao, aoOrdenar, vazio = 'Nenhum registro encontrado.' }) {
  const wrap = el('div', { class: 'wrap-tabela' });
  if (!linhas.length) {
    wrap.appendChild(el('div', { class: 'vazio' }, vazio));
    return wrap;
  }
  const thead = el('thead', {}, el('tr', {}, colunas.map((c) => el('th', {
    class: c.ordenavel ? 'ordenavel' : '',
    onclick: c.ordenavel ? () => aoOrdenar(c.chave) : undefined,
  }, c.titulo + (chaveOrdenar === c.chave ? (direcao === 'desc' ? ' ↓' : ' ↑') : '')))));
  const tbody = el('tbody', {}, linhas.map((linha) => el('tr', {}, colunas.map((c) =>
    el('td', { class: c.acoes ? 'acoes' : '' }, c.render ? c.render(linha) : (linha[c.chave] ?? ''))))));
  wrap.appendChild(el('table', { class: 'tabela' }, [thead, tbody]));
  return wrap;
}

export function paginacao({ pagina, porPagina, total, aoMudar }) {
  const totalPaginas = Math.max(1, Math.ceil(total / porPagina));
  return el('div', { class: 'paginacao' }, [
    el('span', {}, `${total} registro${total === 1 ? '' : 's'} — página ${pagina} de ${totalPaginas}`),
    el('button', { class: 'botao pequeno', disabled: pagina <= 1, onclick: () => aoMudar(pagina - 1) }, 'Anterior'),
    el('button', { class: 'botao pequeno', disabled: pagina >= totalPaginas, onclick: () => aoMudar(pagina + 1) }, 'Próxima'),
  ]);
}

// ---------------------------------------------------------------- Formulário genérico orientado a esquema
// Tipos de campo suportados: texto, textoLongo, email, telefone, data, hora, numero, selecao,
// booleano (caixa de marcar), booleanoSelecao (seleção Sim/Não), multisselecao (com
// {opcoes:[{id,nome,status}]}).
export function construirFormulario({ campos, valores = {}, erros = {}, opcoesPorCampo = {} }) {
  const nos = {};
  const grade = el('div', { class: 'form-grade' });
  for (const campo of campos) {
    if (campo.exibirSe && !campo.exibirSe(valores)) continue;
    const wrap = el('div', { class: `campo ${campo.largo ? 'largo' : ''} ${erros[campo.nome] ? 'invalido' : ''}` });
    const idCampo = `campo-${campo.nome}`;
    let controle;

    if (campo.tipo === 'booleano') {
      wrap.className += ' campo-checkbox';
      controle = el('input', { type: 'checkbox', id: idCampo, checked: Boolean(valores[campo.nome]) || undefined });
      wrap.appendChild(controle);
      wrap.appendChild(el('label', { for: idCampo }, campo.rotulo));
    } else if (campo.tipo === 'booleanoSelecao') {
      // Como "checkbox", mas como campo de seleção Sim/Não (em vez de caixa de marcar) — usado onde
      // o pedido foi por um campo de seleção mesmo para um dado sim/não (ex.: Projetos → Matriculado).
      const atual = Boolean(valores[campo.nome]);
      controle = el('select', { id: idCampo }, [
        el('option', { value: 'nao', selected: !atual || undefined }, 'Não'),
        el('option', { value: 'sim', selected: atual || undefined }, 'Sim'),
      ]);
      wrap.appendChild(el('label', { for: idCampo }, campo.rotulo));
      wrap.appendChild(controle);
    } else if (campo.tipo === 'selecao') {
      const opcoesTodas = campo.opcoes ?? opcoesPorCampo[campo.nome] ?? [];
      const valorAtual = valores[campo.nome];
      controle = el('select', { id: idCampo });
      const redesenharOpcoes = (tipo) => {
        const filtradas = !tipo ? opcoesTodas : opcoesTodas.filter((o) => String(o[campo.filtroFonte?.campo] ?? '') === tipo);
        montar(controle, el('option', { value: '' }, campo.opcaoVazia ?? 'Selecione…'),
          ...filtradas.map((o) => el('option', { value: o.id, selected: String(valorAtual) === String(o.id) || undefined }, o.rotuloOpcao ?? o.nome)));
      };
      redesenharOpcoes('');
      wrap.appendChild(el('label', { for: idCampo }, campo.rotulo));
      // Quinto pedido de ajustes (outubro): filtro por tipo (ex.: Local → hospital/clínica/pronto
      // atendimento) acima da própria seleção, igual ao usado nos campos de múltipla seleção.
      if (campo.filtroFonte) {
        const filtro = el('select', { class: 'selecao-filtro-tipo' }, [
          el('option', { value: '' }, campo.filtroFonte.rotuloTodos ?? 'Todos os tipos'),
          ...campo.filtroFonte.opcoes.map((o) => el('option', { value: o.id }, o.nome)),
        ]);
        filtro.addEventListener('change', () => redesenharOpcoes(filtro.value));
        wrap.appendChild(filtro);
      }
      wrap.appendChild(controle);
    } else if (campo.tipo === 'multisselecao') {
      const selecionados = new Set((valores[campo.nome] ?? []).map(String));
      const opcoes = campo.opcoes ?? opcoesPorCampo[campo.nome] ?? [];
      const caixasOpcao = opcoes.map((o) => {
        const inativo = o.status && o.status !== 'ativo';
        const cb = el('input', { type: 'checkbox', value: o.id, checked: selecionados.has(String(o.id)) || undefined });
        const rot = el('label', { class: inativo ? 'inativo' : '' }, [cb, el('span', { class: 'rotulo-opcao' }, `${o.nome}${inativo ? ' (inativo)' : ''}`)]);
        rot.dataset.textoBusca = o.nome.toLowerCase();
        rot.dataset.tipo = o[campo.filtroFonte?.campo ?? ''] ?? '';
        return rot;
      });
      controle = el('div', { class: 'lista-multisel', 'data-multisel': campo.nome }, caixasOpcao);
      wrap.appendChild(el('label', {}, campo.rotulo));
      // Ponto 3 do segundo pedido de ajustes: lista extensa de locais fica difícil de achar um item —
      // uma caixa de busca filtra as opções visíveis sem mexer no que já está marcado.
      const estadoFiltro = { termo: '', tipo: '' };
      const aplicarFiltro = () => caixasOpcao.forEach((rot) => {
        const bateTexto = estadoFiltro.termo === '' || rot.dataset.textoBusca.includes(estadoFiltro.termo);
        const bateTipo = estadoFiltro.tipo === '' || rot.dataset.tipo === estadoFiltro.tipo;
        rot.hidden = !bateTexto || !bateTipo;
      });
      if (campo.comBusca ?? opcoes.length > 6) {
        const busca = el('input', { type: 'text', class: 'multisel-busca', placeholder: 'Buscar…' });
        busca.addEventListener('input', () => { estadoFiltro.termo = busca.value.trim().toLowerCase(); aplicarFiltro(); });
        wrap.appendChild(busca);
      }
      // Quinto pedido de ajustes (outubro): filtra os locais por tipo (hospital, clínica, pronto
      // atendimento) ao vincular locais a um projeto.
      if (campo.filtroFonte) {
        const filtro = el('select', { class: 'multisel-filtro-tipo' }, [
          el('option', { value: '' }, campo.filtroFonte.rotuloTodos ?? 'Todos os tipos'),
          ...campo.filtroFonte.opcoes.map((o) => el('option', { value: o.id }, o.nome)),
        ]);
        filtro.addEventListener('change', () => { estadoFiltro.tipo = filtro.value; aplicarFiltro(); });
        wrap.appendChild(filtro);
      }
      if (campo.comAtalhos) {
        wrap.appendChild(el('div', { class: 'multisel-atalhos' }, [
          el('button', { type: 'button', class: 'botao pequeno', onclick: () => caixasOpcao.forEach((l) => { if (!l.hidden) l.querySelector('input').checked = true; }) }, 'Selecionar todos'),
          el('button', { type: 'button', class: 'botao pequeno', onclick: () => caixasOpcao.forEach((l) => { if (!l.hidden) l.querySelector('input').checked = false; }) }, 'Limpar seleção'),
        ]));
      }
      wrap.appendChild(controle);
    } else if (campo.tipo === 'diasSemana') {
      const NOMES = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
      const inicial = new Set(valores[campo.nome] ?? [0, 1, 2, 3, 4, 5, 6]);
      const caixas = NOMES.map((nome, i) => {
        const cb = el('input', { type: 'checkbox', value: i, checked: inicial.has(i) || undefined });
        const rot = el('label', { class: `dia-semana-caixa ${inicial.has(i) ? 'marcado' : ''}` }, [cb, nome]);
        cb.addEventListener('change', () => rot.classList.toggle('marcado', cb.checked));
        return rot;
      });
      const definir = (fn) => caixas.forEach((rot, i) => {
        const cb = rot.querySelector('input');
        cb.checked = fn(i);
        rot.classList.toggle('marcado', cb.checked);
      });
      controle = el('div', { class: 'campo-dias-semana' }, [
        el('div', { class: 'dias-semana-presets' }, [
          el('button', { type: 'button', class: 'botao pequeno', onclick: () => definir(() => true) }, 'Todos os dias'),
          el('button', { type: 'button', class: 'botao pequeno', onclick: () => definir((i) => i >= 1 && i <= 5) }, 'Dias úteis'),
        ]),
        el('div', { class: 'dias-semana-caixas' }, caixas),
      ]);
      wrap.appendChild(el('label', {}, campo.rotulo));
      wrap.appendChild(controle);
    } else if (campo.tipo === 'textoLongo') {
      controle = el('textarea', { id: idCampo }, valores[campo.nome] ?? '');
      wrap.appendChild(el('label', { for: idCampo }, campo.rotulo));
      wrap.appendChild(controle);
    } else {
      const tipoHtml = { texto: 'text', email: 'email', telefone: 'tel', data: 'date', hora: 'time', numero: 'number', senha: 'password' }[campo.tipo] ?? 'text';
      controle = el('input', {
        type: tipoHtml, id: idCampo,
        value: campo.tipo === 'data' ? (valores[campo.nome] ?? '') : (valores[campo.nome] ?? ''),
        placeholder: campo.placeholder,
        autocomplete: campo.tipo === 'senha' ? 'new-password' : undefined,
      });
      wrap.appendChild(el('label', { for: idCampo }, campo.rotulo));
      wrap.appendChild(controle);
    }

    if (campo.dicas) wrap.appendChild(el('div', { class: 'dica-campo' }, campo.dicas));
    if (erros[campo.nome]) wrap.appendChild(el('div', { class: 'erro-campo' }, erros[campo.nome]));
    nos[campo.nome] = controle;
    grade.appendChild(wrap);
  }

  return {
    no: grade,
    ler() {
      const saida = {};
      for (const campo of campos) {
        const n = nos[campo.nome];
        if (!n) continue;
        if (campo.tipo === 'booleano') saida[campo.nome] = n.checked;
        else if (campo.tipo === 'booleanoSelecao') saida[campo.nome] = n.value === 'sim';
        else if (campo.tipo === 'diasSemana') saida[campo.nome] = [...n.querySelectorAll('input:checked')].map((i) => Number(i.value));
        else if (campo.tipo === 'multisselecao') saida[campo.nome] = [...n.querySelectorAll('input:checked')].map((i) => Number(i.value));
        else if (campo.tipo === 'numero') saida[campo.nome] = n.value === '' ? null : Number(n.value);
        else saida[campo.nome] = n.value === '' ? null : n.value;
      }
      return saida;
    },
  };
}

export const fmtData = paraBR;

/** Mensagem amigável para toasts: junta a mensagem geral com os erros de campo, quando houver. */
export function mensagemDeErro(e) {
  if (e?.campos && Object.keys(e.campos).length) return Object.values(e.campos).join(' ');
  return e?.message ?? 'Ocorreu um erro inesperado.';
}
