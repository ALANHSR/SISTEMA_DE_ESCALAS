import type { Roteador } from '../http.ts';
import { obter } from '../db.ts';
import type { Definicao } from '../recursos.ts';
import { registrarRecurso } from '../recursos.ts';
import { hashSenha, encerrarSessoesDoUsuario, problemaNaSenha } from '../auth.ts';
import {
  checarReferencia, duracaoMinutos, lancarValidacao, regrasDeHorario, regrasDePeriodo, temErros,
} from '../regras.ts';
import type { Erros } from '../validacao.ts';

const STATUS_ATIVO = ['ativo', 'inativo'] as const;

// Quinto pedido de ajustes (outubro): tipo do estabelecimento (local).
const TIPO_LOCAL = ['hospital', 'clinica', 'pronto_atendimento'] as const;

const EXPORT_STATUS = { campo: 'status', rotulo: 'Situação', tipo: 'rotulo' } as const;

// Trimestre(s) cobertos por um período (data_inicial..data_final), no formato "1º/2026". Não é
// guardado em coluna: é recalculado a cada leitura a partir das datas do projeto (ver ganchos de
// `projetos` abaixo), então nunca fica desatualizado se o período do projeto mudar.
const TRIMESTRE_ROMANO = ['1º', '2º', '3º', '4º'];
function trimestresDoPeriodo(dataInicial: string | null, dataFinal: string | null): string[] {
  if (!dataInicial || !dataFinal) return [];
  const [anoI, mesI] = dataInicial.split('-').map(Number);
  const [anoF, mesF] = dataFinal.split('-').map(Number);
  if (!Number.isInteger(anoI) || !Number.isInteger(mesI) || !Number.isInteger(anoF) || !Number.isInteger(mesF)) return [];
  const vistos = new Set<string>();
  const saida: string[] = [];
  let ano = anoI;
  let mes = mesI;
  let protecao = 0;
  while ((ano < anoF || (ano === anoF && mes <= mesF)) && protecao < 400) {
    protecao += 1;
    const trimestre = Math.floor((mes - 1) / 3);
    const chave = `${ano}-${trimestre}`;
    if (!vistos.has(chave)) {
      vistos.add(chave);
      saida.push(`${TRIMESTRE_ROMANO[trimestre]}/${ano}`);
    }
    mes += 1;
    if (mes > 12) { mes = 1; ano += 1; }
  }
  return saida;
}

// ---------------------------------------------------------------- Profissionais
export const profissionais: Definicao = {
  nome: 'profissionais',
  tabela: 'profissionais',
  rotulo: 'Profissional',
  esquema: {
    nome_completo: { tipo: 'string', rotulo: 'Nome completo', obrigatorio: true, min: 3, max: 120 },
    telefone: { tipo: 'telefone', rotulo: 'Telefone' },
    cidade: { tipo: 'string', rotulo: 'Cidade', max: 100 },
    uf: { tipo: 'uf', rotulo: 'Estado (UF)', obrigatorio: true },
    email: { tipo: 'email', rotulo: 'E-mail' },
    cargo: { tipo: 'string', rotulo: 'Cargo ou função', max: 100 },
    status: { tipo: 'enum', rotulo: 'Situação', valores: STATUS_ATIVO, padrao: 'ativo' },
    observacoes: { tipo: 'texto', rotulo: 'Observações' },
  },
  relacoes: [],
  colunasBool: [],
  busca: ['t.nome_completo', 't.email', 't.cargo', 't.telefone', 't.cidade'],
  ordenaveis: {
    nome_completo: 't.nome_completo COLLATE NOCASE', cargo: 't.cargo COLLATE NOCASE', uf: 't.uf', cidade: 't.cidade COLLATE NOCASE', status: 't.status',
  },
  ordemPadrao: 'nome_completo',
  filtros: { status: 't.status', uf: 't.uf' },
  exportacao: [
    { campo: 'nome_completo', rotulo: 'Nome completo' }, { campo: 'cargo', rotulo: 'Cargo ou função' },
    { campo: 'telefone', rotulo: 'Telefone' }, { campo: 'email', rotulo: 'E-mail' }, { campo: 'cidade', rotulo: 'Cidade' },
    { campo: 'uf', rotulo: 'UF' }, EXPORT_STATUS, { campo: 'observacoes', rotulo: 'Observações' },
  ],
  // Cadastros agora são exclusivos do administrador (ver registrarCadastros), que sempre vê
  // ativos e inativos; não há mais um perfil de leitura parcial a filtrar aqui.
  ganchos: {},
};

// ---------------------------------------------------------------- Locais
export const locais: Definicao = {
  nome: 'locais',
  tabela: 'locais',
  rotulo: 'Local',
  esquema: {
    nome: { tipo: 'string', rotulo: 'Nome do local', obrigatorio: true, min: 2, max: 120 },
    endereco: { tipo: 'string', rotulo: 'Endereço', max: 200 },
    cidade: { tipo: 'string', rotulo: 'Cidade', max: 100 },
    uf: { tipo: 'uf', rotulo: 'Estado (UF)' },
    complemento: { tipo: 'string', rotulo: 'Complemento', max: 100 },
    responsavel: { tipo: 'string', rotulo: 'Responsável ou contato', max: 120 },
    telefone_contato: { tipo: 'telefone', rotulo: 'Telefone de contato' },
    // Quinto pedido de ajustes (outubro): tipo do estabelecimento, usado para filtrar/identificar o
    // local ao vinculá-lo a um projeto.
    tipo: { tipo: 'enum', rotulo: 'Tipo', valores: TIPO_LOCAL },
    status: { tipo: 'enum', rotulo: 'Situação', valores: STATUS_ATIVO, padrao: 'ativo' },
    observacoes: { tipo: 'texto', rotulo: 'Observações' },
  },
  relacoes: [],
  colunasBool: [],
  busca: ['t.nome', 't.endereco', 't.cidade', 't.responsavel'],
  ordenaveis: { nome: 't.nome COLLATE NOCASE', cidade: 't.cidade COLLATE NOCASE', uf: 't.uf', tipo: 't.tipo', status: 't.status' },
  ordemPadrao: 'nome',
  filtros: { status: 't.status', uf: 't.uf', tipo: 't.tipo' },
  exportacao: [
    { campo: 'nome', rotulo: 'Nome' }, { campo: 'tipo', rotulo: 'Tipo', tipo: 'rotulo' }, { campo: 'endereco', rotulo: 'Endereço' }, { campo: 'cidade', rotulo: 'Cidade' },
    { campo: 'uf', rotulo: 'UF' }, { campo: 'responsavel', rotulo: 'Responsável' },
    { campo: 'telefone_contato', rotulo: 'Telefone' }, EXPORT_STATUS,
  ],
  ganchos: {},
};

// ---------------------------------------------------------------- Projetos
export const projetos: Definicao = {
  nome: 'projetos',
  tabela: 'projetos',
  rotulo: 'Projeto',
  esquema: {
    nome: { tipo: 'string', rotulo: 'Nome', obrigatorio: true, min: 2, max: 120 },
    codigo: { tipo: 'string', rotulo: 'Código', obrigatorio: true, min: 2, max: 30, maiusculas: true },
    descricao: { tipo: 'texto', rotulo: 'Descrição' },
    solicitante: { tipo: 'string', rotulo: 'Solicitante', max: 120 },
    data_inicial: { tipo: 'data', rotulo: 'Data inicial' },
    data_final: { tipo: 'data', rotulo: 'Data final' },
    status: {
      tipo: 'enum', rotulo: 'Situação', valores: ['planejamento', 'ativo', 'pausado', 'concluido', 'cancelado'], padrao: 'planejamento',
    },
    // Quinto pedido de ajustes (outubro): classificação, matrícula e porte do projeto.
    classificacao: { tipo: 'enum', rotulo: 'Classificação', valores: ['melhoria', 'projeto'] },
    matriculado: { tipo: 'bool', rotulo: 'Matriculado' },
    tamanho: { tipo: 'enum', rotulo: 'Tamanho do projeto', valores: ['pequeno', 'medio', 'grande'] },
    remoto: { tipo: 'bool', rotulo: 'Remoto ou sem local definido' },
    local_ids: { tipo: 'listaIds', rotulo: 'Locais associados' },
    observacoes: { tipo: 'texto', rotulo: 'Observações' },
  },
  relacoes: [{
    campo: 'local_ids', tabela: 'projeto_locais', fkPropria: 'projeto_id', fkOutra: 'local_id',
    tabelaOutra: 'locais', colunaNome: 'nome', chaveDetalhe: 'locais',
  }],
  colunasBool: ['remoto', 'matriculado'],
  busca: ['t.nome', 't.codigo', 't.solicitante'],
  ordenaveis: {
    nome: 't.nome COLLATE NOCASE', codigo: 't.codigo COLLATE NOCASE', status: 't.status', data_inicial: 't.data_inicial', data_final: 't.data_final',
    solicitante: 't.solicitante COLLATE NOCASE', classificacao: 't.classificacao', tamanho: 't.tamanho',
  },
  ordemPadrao: 'nome',
  filtros: { status: 't.status', remoto: 't.remoto', classificacao: 't.classificacao', tamanho: 't.tamanho', matriculado: 't.matriculado' },
  selectExtra: `(SELECT group_concat(l.nome, ', ') FROM projeto_locais pl JOIN locais l ON l.id = pl.local_id WHERE pl.projeto_id = t.id) AS locais_nomes`,
  exportacao: [
    { campo: 'codigo', rotulo: 'Código' }, { campo: 'nome', rotulo: 'Nome' }, { campo: 'solicitante', rotulo: 'Solicitante' },
    { campo: 'classificacao', rotulo: 'Classificação', tipo: 'rotulo' }, { campo: 'tamanho', rotulo: 'Tamanho', tipo: 'rotulo' },
    { campo: 'matriculado', rotulo: 'Matriculado', tipo: 'bool' },
    { campo: 'data_inicial', rotulo: 'Data inicial', tipo: 'data' }, { campo: 'data_final', rotulo: 'Data final', tipo: 'data' },
    { campo: 'trimestres', rotulo: 'Trimestre(s)' },
    EXPORT_STATUS, { campo: 'remoto', rotulo: 'Remoto', tipo: 'bool' }, { campo: 'locais_nomes', rotulo: 'Locais' },
  ],
  ganchos: {
    negocio: ({ ctx, dados, existente }) => {
      const erros: Erros = {};
      regrasDePeriodo(dados, erros);
      const igual = obter(ctx.db, 'SELECT id FROM projetos WHERE codigo = ? AND id <> ?', dados.codigo, existente?.id ?? 0);
      if (igual) erros.codigo = 'Código: já existe um projeto com este código.';
      const anteriores = (existente?.local_ids as number[] | undefined) ?? [];
      for (const lid of dados.local_ids as number[]) {
        checarReferencia(ctx.db, erros, { tabela: 'locais', campo: 'local_ids', id: lid, rotulo: 'Locais associados', novoVinculo: !anteriores.includes(lid) });
      }
      if (temErros(erros)) lancarValidacao(erros);
    },
    // O(s) trimestre(s) não ficam guardados: são calculados a partir de data_inicial/data_final a
    // cada leitura (listagem, detalhe e exportação), então nunca ficam desatualizados se as datas
    // do projeto mudarem.
    transformarLinha: (_ctx, l) => ({ ...l, trimestres: trimestresDoPeriodo(l.data_inicial as string | null, l.data_final as string | null) }),
  },
};

// ---------------------------------------------------------------- Horários (modelos)
export const horarios: Definicao = {
  nome: 'horarios',
  tabela: 'horarios',
  rotulo: 'Horário',
  esquema: {
    nome: { tipo: 'string', rotulo: 'Nome do horário', obrigatorio: true, min: 2, max: 80 },
    hora_inicio: { tipo: 'hora', rotulo: 'Hora de início', obrigatorio: true },
    hora_fim: { tipo: 'hora', rotulo: 'Hora de término', obrigatorio: true },
    vira_dia: { tipo: 'bool', rotulo: 'Virada de dia' },
    intervalo_minutos: { tipo: 'inteiro', rotulo: 'Intervalo (minutos)', min: 0, max: 600, padrao: 0 },
    status: { tipo: 'enum', rotulo: 'Situação', valores: STATUS_ATIVO, padrao: 'ativo' },
    observacoes: { tipo: 'texto', rotulo: 'Observações' },
  },
  relacoes: [],
  colunasBool: ['vira_dia'],
  busca: ['t.nome'],
  ordenaveis: { nome: 't.nome COLLATE NOCASE', hora_inicio: 't.hora_inicio', horas_previstas: 't.horas_previstas', status: 't.status' },
  ordemPadrao: 'hora_inicio',
  filtros: { status: 't.status', vira_dia: 't.vira_dia' },
  exportacao: [
    { campo: 'nome', rotulo: 'Nome' }, { campo: 'hora_inicio', rotulo: 'Início' }, { campo: 'hora_fim', rotulo: 'Término' },
    { campo: 'vira_dia', rotulo: 'Virada de dia', tipo: 'bool' }, { campo: 'intervalo_minutos', rotulo: 'Intervalo (min)' },
    { campo: 'horas_previstas', rotulo: 'Horas previstas' }, EXPORT_STATUS,
  ],
  ganchos: {
    negocio: ({ dados }) => {
      const erros: Erros = {};
      regrasDeHorario(dados, erros);
      if (!temErros(erros)) {
        const total = duracaoMinutos(dados.hora_inicio, dados.hora_fim, dados.vira_dia);
        if (dados.intervalo_minutos >= total) erros.intervalo_minutos = 'Intervalo (minutos): deve ser menor que a duração do horário.';
      }
      if (temErros(erros)) lancarValidacao(erros);
    },
    colunasExtras: ({ dados }) => ({
      horas_previstas: Math.round(((duracaoMinutos(dados.hora_inicio, dados.hora_fim, dados.vira_dia) - dados.intervalo_minutos) / 60) * 100) / 100,
    }),
  },
};

// ---------------------------------------------------------------- Períodos (calendário operacional)
export const periodos: Definicao = {
  nome: 'periodos',
  tabela: 'periodos',
  rotulo: 'Período',
  esquema: {
    nome: { tipo: 'string', rotulo: 'Nome', obrigatorio: true, min: 2, max: 120 },
    tipo: { tipo: 'enum', rotulo: 'Tipo', obrigatorio: true, valores: ['feriado', 'recesso', 'operacional', 'outro'] },
    // Vazio = nacional (vale para todos); só UF = estadual; UF + cidade = municipal (mais específico).
    uf: { tipo: 'uf', rotulo: 'Estado (UF)' },
    cidade: { tipo: 'string', rotulo: 'Cidade', max: 100 },
    data_inicial: { tipo: 'data', rotulo: 'Data inicial', obrigatorio: true },
    data_final: { tipo: 'data', rotulo: 'Data final', obrigatorio: true },
    status: { tipo: 'enum', rotulo: 'Situação', valores: STATUS_ATIVO, padrao: 'ativo' },
    observacoes: { tipo: 'texto', rotulo: 'Observações' },
  },
  relacoes: [],
  colunasBool: [],
  busca: ['t.nome'],
  ordenaveis: { nome: 't.nome COLLATE NOCASE', data_inicial: 't.data_inicial', tipo: 't.tipo', uf: 't.uf', cidade: 't.cidade COLLATE NOCASE', status: 't.status' },
  ordemPadrao: 'data_inicial',
  filtros: { status: 't.status', tipo: 't.tipo', uf: 't.uf' },
  exportacao: [
    { campo: 'nome', rotulo: 'Nome' }, { campo: 'tipo', rotulo: 'Tipo', tipo: 'rotulo' }, { campo: 'uf', rotulo: 'Estado (vazio = nacional)' },
    { campo: 'cidade', rotulo: 'Cidade (vazio = todo o estado)' },
    { campo: 'data_inicial', rotulo: 'Data inicial', tipo: 'data' }, { campo: 'data_final', rotulo: 'Data final', tipo: 'data' }, EXPORT_STATUS,
  ],
  ganchos: {
    negocio: ({ dados }) => {
      const erros: Erros = {};
      regrasDePeriodo(dados, erros);
      if (dados.cidade && !dados.uf) erros.cidade = 'Cidade: só faz sentido com um estado selecionado (sem estado, o feriado já é nacional).';
      if (temErros(erros)) lancarValidacao(erros);
    },
  },
};

// ---------------------------------------------------------------- Usuários (somente administradores)
export const usuarios: Definicao = {
  nome: 'usuarios',
  tabela: 'usuarios',
  rotulo: 'Usuário',
  esquema: {
    nome: { tipo: 'string', rotulo: 'Nome', obrigatorio: true, min: 2, max: 120 },
    email: { tipo: 'email', rotulo: 'E-mail', obrigatorio: true },
    senha: { tipo: 'string', rotulo: 'Senha', max: 128, semTrim: true },
    perfil: { tipo: 'enum', rotulo: 'Perfil', obrigatorio: true, valores: ['administrador', 'usuario'] },
    status: { tipo: 'enum', rotulo: 'Situação', valores: STATUS_ATIVO, padrao: 'ativo' },
    deve_trocar_senha: { tipo: 'bool', rotulo: 'Exigir troca de senha no próximo acesso' },
  },
  relacoes: [],
  colunasBool: ['deve_trocar_senha'],
  ignorarNaPersistencia: ['senha'],
  busca: ['t.nome', 't.email'],
  ordenaveis: { nome: 't.nome COLLATE NOCASE', email: 't.email', perfil: 't.perfil', ultimo_acesso: 't.ultimo_acesso', status: 't.status' },
  ordemPadrao: 'nome',
  filtros: { status: 't.status', perfil: 't.perfil' },
  exportacao: [
    { campo: 'nome', rotulo: 'Nome' }, { campo: 'email', rotulo: 'E-mail' }, { campo: 'perfil', rotulo: 'Perfil', tipo: 'rotulo' }, EXPORT_STATUS,
  ],
  ganchos: {
    negocio: ({ ctx, dados, existente }) => {
      const erros: Erros = {};
      const senha = typeof dados.senha === 'string' ? dados.senha : '';
      if (!existente && !senha) erros.senha = 'Senha: campo obrigatório para novos usuários.';
      else if (senha) { const p = problemaNaSenha(senha); if (p) erros.senha = p; }

      if (obter(ctx.db, 'SELECT id FROM usuarios WHERE email = ? AND id <> ?', dados.email, existente?.id ?? 0)) {
        erros.email = 'E-mail: já existe um usuário com este e-mail.';
      }
      if (existente && existente.id === ctx.user!.id && (dados.perfil !== 'administrador' || dados.status !== 'ativo')) {
        erros.perfil = 'Você não pode remover o próprio acesso de administrador nem inativar a própria conta.';
      }
      if (existente && existente.perfil === 'administrador' && existente.status === 'ativo' && (dados.perfil !== 'administrador' || dados.status !== 'ativo')) {
        const outros = Number(obter(ctx.db, "SELECT COUNT(*) AS n FROM usuarios WHERE perfil = 'administrador' AND status = 'ativo' AND id <> ?", existente.id)!.n);
        if (outros === 0) erros.perfil = 'É necessário manter ao menos um administrador ativo.';
      }
      if (temErros(erros)) lancarValidacao(erros);
    },
    colunasExtras: ({ dados }) => (dados.senha ? { senha_hash: hashSenha(String(dados.senha)) } : {}),
    posSalvar: ({ ctx, dados, existente, id }) => {
      // Senha redefinida ou conta inativada: derruba as sessões abertas (exceto a de quem está editando).
      const mudouSenha = Boolean(dados.senha);
      const inativou = dados.status === 'inativo' && existente?.status !== 'inativo';
      if ((mudouSenha || inativou) && id !== ctx.user!.id) encerrarSessoesDoUsuario(ctx.db, id);
    },
  },
};

export function registrarCadastros(roteador: Roteador): void {
  // Cadastros são de uso exclusivo do administrador — o perfil usuário não lê nem lista nada
  // aqui (mesmo profissionais/projetos/locais já inativos). O que o usuário comum precisa ver
  // (nomes de profissionais/projetos/locais embutidos na agenda, opções de filtro) continua vindo
  // de /api/opcoes e dos próprios detalhes de escala/folga/treinamento, não destas rotas.
  registrarRecurso(roteador, profissionais, 'admin');
  registrarRecurso(roteador, locais, 'admin');
  registrarRecurso(roteador, projetos, 'admin');
  registrarRecurso(roteador, horarios, 'admin');
  registrarRecurso(roteador, periodos, 'admin');
  registrarRecurso(roteador, usuarios, 'admin');
}
