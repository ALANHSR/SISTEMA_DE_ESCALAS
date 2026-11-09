import { selo, fmtData } from './ui.js';

const SITUACAO_ATIVO = [{ id: 'ativo', nome: 'Ativo' }, { id: 'inativo', nome: 'Inativo' }];
const UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']
  .map((uf) => ({ id: uf, nome: uf }));

const colSituacao = { chave: 'status', titulo: 'Situação', ordenavel: true, render: (l) => selo(l.status) };

// Quinto pedido de ajustes (outubro).
const TIPO_LOCAL = [{ id: 'hospital', nome: 'Hospital' }, { id: 'clinica', nome: 'Clínica' }, { id: 'pronto_atendimento', nome: 'Pronto atendimento' }];
const CLASSIFICACAO_PROJETO = [{ id: 'melhoria', nome: 'Melhoria' }, { id: 'projeto', nome: 'Projeto' }];
const TAMANHO_PROJETO = [{ id: 'pequeno', nome: 'Pequeno' }, { id: 'medio', nome: 'Médio' }, { id: 'grande', nome: 'Grande' }];

export const ENTIDADES = {
  profissionais: {
    tituloSingular: 'Profissional', tituloPlural: 'Profissionais', icone: '👤', somenteAdmin: true,
    busca: true,
    filtros: [{ nome: 'status', rotulo: 'Situação', opcoes: SITUACAO_ATIVO }, { nome: 'uf', rotulo: 'UF', opcoes: UFS }],
    colunas: [
      { chave: 'nome_completo', titulo: 'Nome', ordenavel: true },
      { chave: 'cargo', titulo: 'Cargo' },
      { chave: 'telefone', titulo: 'Telefone' },
      { chave: 'cidade', titulo: 'Cidade' },
      { chave: 'uf', titulo: 'UF', ordenavel: true },
      colSituacao,
    ],
    campos: [
      { nome: 'nome_completo', rotulo: 'Nome completo', tipo: 'texto', largo: true },
      { nome: 'cargo', rotulo: 'Cargo ou função', tipo: 'texto' },
      { nome: 'telefone', rotulo: 'Telefone', tipo: 'telefone' },
      { nome: 'email', rotulo: 'E-mail', tipo: 'email' },
      { nome: 'cidade', rotulo: 'Cidade', tipo: 'texto' },
      { nome: 'uf', rotulo: 'Estado (UF)', tipo: 'selecao', opcoes: UFS },
      { nome: 'status', rotulo: 'Situação', tipo: 'selecao', opcoes: SITUACAO_ATIVO, opcaoVazia: null },
      { nome: 'observacoes', rotulo: 'Observações', tipo: 'textoLongo', largo: true },
    ],
  },

  locais: {
    tituloSingular: 'Local', tituloPlural: 'Locais', icone: '📍', somenteAdmin: true,
    busca: true,
    filtros: [
      { nome: 'tipo', rotulo: 'Tipo', opcoes: TIPO_LOCAL },
      { nome: 'status', rotulo: 'Situação', opcoes: SITUACAO_ATIVO },
    ],
    colunas: [
      { chave: 'nome', titulo: 'Nome', ordenavel: true }, { chave: 'cidade', titulo: 'Cidade', ordenavel: true },
      { chave: 'uf', titulo: 'UF' },
      { chave: 'tipo', titulo: 'Tipo', ordenavel: true, render: (l) => (l.tipo ? selo(l.tipo) : '—') },
      { chave: 'responsavel', titulo: 'Responsável' }, colSituacao,
    ],
    campos: [
      { nome: 'nome', rotulo: 'Nome do local', tipo: 'texto', largo: true },
      { nome: 'tipo', rotulo: 'Tipo', tipo: 'selecao', opcoes: TIPO_LOCAL, opcaoVazia: null },
      { nome: 'endereco', rotulo: 'Endereço', tipo: 'texto', largo: true },
      { nome: 'cidade', rotulo: 'Cidade', tipo: 'texto' },
      { nome: 'uf', rotulo: 'Estado (UF)', tipo: 'selecao', opcoes: UFS },
      { nome: 'complemento', rotulo: 'Complemento', tipo: 'texto' },
      { nome: 'responsavel', rotulo: 'Responsável ou contato', tipo: 'texto' },
      { nome: 'telefone_contato', rotulo: 'Telefone de contato', tipo: 'telefone' },
      { nome: 'status', rotulo: 'Situação', tipo: 'selecao', opcoes: SITUACAO_ATIVO, opcaoVazia: null },
      { nome: 'observacoes', rotulo: 'Observações', tipo: 'textoLongo', largo: true },
    ],
  },

  projetos: {
    tituloSingular: 'Projeto', tituloPlural: 'Projetos', icone: '📁', somenteAdmin: true,
    // Situação com cores próprias nesta tela (ativo = azul, pausado = laranja) — ver `selo-projeto`
    // em estilos.css e o uso de `classeSeloStatus` em cadastro.js (listagem e detalhe).
    classeSeloStatus: 'selo-projeto',
    busca: true,
    filtros: [{ nome: 'status', rotulo: 'Situação', opcoes: [
      { id: 'planejamento', nome: 'Planejado' }, { id: 'ativo', nome: 'Ativo' }, { id: 'pausado', nome: 'Pausado' },
      { id: 'concluido', nome: 'Concluído' }, { id: 'cancelado', nome: 'Cancelado' },
    ] }],
    colunas: [
      { chave: 'codigo', titulo: 'Código', ordenavel: true }, { chave: 'nome', titulo: 'Nome', ordenavel: true },
      { chave: 'solicitante', titulo: 'Solicitante' },
      { chave: 'classificacao', titulo: 'Classificação', ordenavel: true, render: (l) => (l.classificacao ? selo(l.classificacao) : '—') },
      { chave: 'tamanho', titulo: 'Tamanho', ordenavel: true, render: (l) => (l.tamanho ? selo(l.tamanho) : '—') },
      { chave: 'data_inicial', titulo: 'Início', ordenavel: true, render: (l) => fmtData(l.data_inicial) },
      { chave: 'data_final', titulo: 'Término', ordenavel: true, render: (l) => fmtData(l.data_final) },
      { chave: 'trimestres', titulo: 'Trimestre(s)', render: (l) => ((l.trimestres && l.trimestres.length) ? l.trimestres.join(', ') : '—') },
      { chave: 'locais_nomes', titulo: 'Locais' },
      colSituacao,
    ],
    campos: [
      { nome: 'nome', rotulo: 'Nome', tipo: 'texto' },
      { nome: 'codigo', rotulo: 'Código', tipo: 'texto' },
      { nome: 'solicitante', rotulo: 'Solicitante', tipo: 'texto' },
      { nome: 'classificacao', rotulo: 'Classificação', tipo: 'selecao', opcoes: CLASSIFICACAO_PROJETO, opcaoVazia: null },
      { nome: 'tamanho', rotulo: 'Tamanho do projeto', tipo: 'selecao', opcoes: TAMANHO_PROJETO, opcaoVazia: null },
      { nome: 'matriculado', rotulo: 'Matriculado', tipo: 'booleanoSelecao' },
      { nome: 'status', rotulo: 'Situação', tipo: 'selecao', opcoes: [
        { id: 'planejamento', nome: 'Planejado' }, { id: 'ativo', nome: 'Ativo' }, { id: 'pausado', nome: 'Pausado' },
        { id: 'concluido', nome: 'Concluído' }, { id: 'cancelado', nome: 'Cancelado' },
      ], opcaoVazia: null },
      { nome: 'data_inicial', rotulo: 'Data inicial', tipo: 'data' },
      { nome: 'data_final', rotulo: 'Data final', tipo: 'data' },
      { nome: 'remoto', rotulo: 'Remoto ou sem local definido', tipo: 'booleano' },
      { nome: 'local_ids', rotulo: 'Locais associados', tipo: 'multisselecao', largo: true, fonteOpcoes: 'locais', comAtalhos: true, comBusca: true, filtroFonte: { campo: 'tipo', opcoes: TIPO_LOCAL } },
      { nome: 'descricao', rotulo: 'Descrição', tipo: 'textoLongo', largo: true },
      { nome: 'observacoes', rotulo: 'Observações', tipo: 'textoLongo', largo: true },
    ],
  },

  horarios: {
    tituloSingular: 'Horário', tituloPlural: 'Horários', icone: '🕒', somenteAdmin: true,
    busca: true,
    filtros: [{ nome: 'status', rotulo: 'Situação', opcoes: SITUACAO_ATIVO }],
    colunas: [
      { chave: 'nome', titulo: 'Nome', ordenavel: true },
      { chave: 'hora_inicio', titulo: 'Início', ordenavel: true }, { chave: 'hora_fim', titulo: 'Término' },
      { chave: 'vira_dia', titulo: 'Virada de dia', render: (l) => (l.vira_dia ? 'Sim' : 'Não') },
      { chave: 'horas_previstas', titulo: 'Horas previstas' }, colSituacao,
    ],
    campos: [
      { nome: 'nome', rotulo: 'Nome do horário', tipo: 'texto', largo: true },
      { nome: 'hora_inicio', rotulo: 'Hora de início', tipo: 'hora' },
      { nome: 'hora_fim', rotulo: 'Hora de término', tipo: 'hora' },
      { nome: 'vira_dia', rotulo: 'Virada de dia (o término é no dia seguinte)', tipo: 'booleano' },
      { nome: 'intervalo_minutos', rotulo: 'Intervalo (minutos)', tipo: 'numero' },
      { nome: 'status', rotulo: 'Situação', tipo: 'selecao', opcoes: SITUACAO_ATIVO, opcaoVazia: null },
      { nome: 'observacoes', rotulo: 'Observações', tipo: 'textoLongo', largo: true },
    ],
  },

  periodos: {
    tituloSingular: 'Período', tituloPlural: 'Feriados e recessos', icone: '📅', somenteAdmin: true,
    busca: true,
    filtros: [
      { nome: 'status', rotulo: 'Situação', opcoes: SITUACAO_ATIVO },
      { nome: 'tipo', rotulo: 'Tipo', opcoes: [{ id: 'feriado', nome: 'Feriado' }, { id: 'recesso', nome: 'Recesso' }, { id: 'operacional', nome: 'Operacional' }, { id: 'outro', nome: 'Outro' }] },
      { nome: 'uf', rotulo: 'Região (UF)', opcoes: UFS },
    ],
    colunas: [
      { chave: 'nome', titulo: 'Nome', ordenavel: true }, { chave: 'tipo', titulo: 'Tipo' },
      { chave: 'uf', titulo: 'Região', ordenavel: true, render: (l) => (l.uf ? `${l.cidade ? `${l.cidade}/` : ''}${l.uf}` : 'Nacional') },
      { chave: 'data_inicial', titulo: 'Início', ordenavel: true, render: (l) => fmtData(l.data_inicial) },
      { chave: 'data_final', titulo: 'Término', render: (l) => fmtData(l.data_final) }, colSituacao,
    ],
    campos: [
      { nome: 'nome', rotulo: 'Nome', tipo: 'texto', largo: true },
      { nome: 'tipo', rotulo: 'Tipo', tipo: 'selecao', opcoes: [{ id: 'feriado', nome: 'Feriado' }, { id: 'recesso', nome: 'Recesso' }, { id: 'operacional', nome: 'Operacional' }, { id: 'outro', nome: 'Outro' }] },
      { nome: 'uf', rotulo: 'Região (estado)', tipo: 'selecao', opcoes: UFS, opcaoVazia: 'Nacional (todos os estados)' },
      { nome: 'cidade', rotulo: 'Cidade (deixe em branco para valer o estado inteiro)', tipo: 'texto' },
      { nome: 'data_inicial', rotulo: 'Data inicial', tipo: 'data' },
      { nome: 'data_final', rotulo: 'Data final', tipo: 'data' },
      { nome: 'status', rotulo: 'Situação', tipo: 'selecao', opcoes: SITUACAO_ATIVO, opcaoVazia: null },
      { nome: 'observacoes', rotulo: 'Observações', tipo: 'textoLongo', largo: true },
    ],
  },

  usuarios: {
    tituloSingular: 'Usuário', tituloPlural: 'Usuários do sistema', icone: '🔐', somenteAdmin: true,
    busca: true,
    filtros: [
      { nome: 'status', rotulo: 'Situação', opcoes: SITUACAO_ATIVO },
      { nome: 'perfil', rotulo: 'Perfil', opcoes: [{ id: 'administrador', nome: 'Administrador' }, { id: 'usuario', nome: 'Usuário' }] },
    ],
    colunas: [
      { chave: 'nome', titulo: 'Nome', ordenavel: true }, { chave: 'email', titulo: 'E-mail' },
      { chave: 'perfil', titulo: 'Perfil', render: (l) => (l.perfil === 'administrador' ? 'Administrador' : 'Usuário') },
      colSituacao,
    ],
    campos: [
      { nome: 'nome', rotulo: 'Nome', tipo: 'texto' },
      { nome: 'email', rotulo: 'E-mail', tipo: 'email' },
      { nome: 'senha', rotulo: 'Senha', tipo: 'senha', dicas: 'Deixe em branco para manter a senha atual (ao editar).' },
      { nome: 'perfil', rotulo: 'Perfil', tipo: 'selecao', opcoes: [{ id: 'administrador', nome: 'Administrador' }, { id: 'usuario', nome: 'Usuário' }] },
      { nome: 'status', rotulo: 'Situação', tipo: 'selecao', opcoes: SITUACAO_ATIVO, opcaoVazia: null },
    ],
  },
};

export const CAMINHO_ENTIDADE = Object.fromEntries(Object.keys(ENTIDADES).map((k) => [k, k]));
