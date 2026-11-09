// Dados de DEMONSTRAÇÃO. Todos os registros levam a observação "Dado de demonstração", os e-mails usam
// o domínio reservado demo.local e a configuração `dados_demo` faz o dashboard exibir um aviso.
// As datas são relativas à segunda-feira da semana atual, para que a demonstração sempre tenha
// registros "de hoje" e dos próximos dias. Nomes e endereços são fictícios.
//
// Uso:  npm run seed            (falha se já houver dados)
//       npm run seed -- --reset (apaga TODOS os dados e recria a demonstração)
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DB } from './db.ts';
import { abrirBanco, executar, obter, transacao } from './db.ts';
import { carregarConfig } from './config.ts';
import { migrar } from './migrate.ts';
import { hashSenha, problemaNaSenha } from './auth.ts';
import { dataParaDias, hojeSaoPaulo, somarDias } from '../shared/datetime.ts';

const DEMO = 'Dado de demonstração';
const TABELAS_EM_ORDEM_DE_LIMPEZA = [
  'auditoria', 'sessoes', 'escala_dias', 'escala_locais', 'treinamento_horarios', 'treinamento_profissionais', 'projeto_locais',
  'escalas', 'treinamentos', 'folgas', 'periodos', 'projetos', 'locais', 'horarios', 'profissionais', 'usuarios', 'configuracoes',
];

export interface OpcoesSeed { senhaAdmin: string; senhaUsuario: string; hoje?: string }

export function limparTudo(db: DB): void {
  transacao(db, () => { for (const t of TABELAS_EM_ORDEM_DE_LIMPEZA) db.exec(`DELETE FROM ${t}`); });
}

export function senhaAleatoria(): string {
  for (;;) {
    const s = randomBytes(12).toString('base64url').slice(0, 14);
    if (!problemaNaSenha(s)) return s;
  }
}

export function semear(db: DB, o: OpcoesSeed): { admin: string; usuario: string } {
  const hoje = o.hoje ?? hojeSaoPaulo();
  // Segunda-feira da semana de "hoje" (1970-01-01 foi quinta-feira).
  const dow = (dataParaDias(hoje) + 3) % 7; // 0 = segunda
  const seg = somarDias(hoje, -dow);
  const d = (n: number): string => somarDias(seg, n);
  const agora = new Date().toISOString();

  return transacao(db, () => {
    let adminId = 0;
    const inserir = (tabela: string, dados: Record<string, unknown>, comSistema = true): number => {
      const linha = comSistema
        ? { ...dados, criado_em: agora, atualizado_em: agora, criado_por: adminId || null, atualizado_por: adminId || null }
        : dados;
      const cols = Object.keys(linha);
      const id = executar(db, `INSERT INTO ${tabela} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, ...Object.values(linha)).id;
      if (comSistema && tabela !== 'usuarios') {
        executar(db, 'INSERT INTO auditoria (entidade, registro_id, acao, usuario_id, usuario_nome, detalhes, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?)',
          tabela, id, 'criou', adminId, 'Administrador (demonstração)', JSON.stringify({ origem: 'seed' }), agora);
      }
      return id;
    };
    const vincular = (tabela: string, fkPropria: string, id: number, profs: number[]): void => {
      for (const p of profs) executar(db, `INSERT INTO ${tabela} (${fkPropria}, profissional_id) VALUES (?, ?)`, id, p);
    };

    adminId = inserir('usuarios', { nome: 'Administrador Demo', email: 'admin@demo.local', senha_hash: hashSenha(o.senhaAdmin), perfil: 'administrador', status: 'ativo' });
    inserir('usuarios', { nome: 'Usuário Demo (somente leitura)', email: 'usuario@demo.local', senha_hash: hashSenha(o.senhaUsuario), perfil: 'usuario', status: 'ativo' });
    executar(db, "INSERT INTO configuracoes (chave, valor) VALUES ('dados_demo', '1')");

    const pessoas: [string, string, string, string, string][] = [
      ['Marina Albuquerque', 'Engenheira de projetos', 'SP', '11', 'São Paulo'], ['Carlos Eduardo Pinheiro', 'Técnico de campo', 'SP', '11', 'São Paulo'],
      ['Juliana Matos', 'Técnica de campo', 'SP', '11', 'Campinas'], ['Rafael Nogueira', 'Supervisor de manutenção', 'RJ', '21', 'Rio de Janeiro'],
      ['Patrícia Vasconcelos', 'Técnica de manutenção', 'RJ', '21', 'Rio de Janeiro'], ['Thiago Bastos', 'Técnico de manutenção', 'RJ', '21', 'Rio de Janeiro'],
      ['Fernanda Lopes', 'Engenheira de implantação', 'PR', '41', 'Curitiba'], ['Gustavo Ferraz', 'Técnico de implantação', 'PR', '41', 'Curitiba'],
      ['Larissa Moura', 'Analista de suporte', 'SP', '11', 'São Paulo'], ['Bruno Cavalcanti', 'Analista de suporte', 'SP', '11', 'São Paulo'],
      ['Camila Duarte', 'Técnica de campo', 'BA', '71', 'Salvador'], ['Diego Salgado', 'Supervisor de campo', 'BA', '71', 'Salvador'],
      ['Helena Prado', 'Instrutora', 'MG', '31', 'Belo Horizonte'], ['Rogério Tavares', 'Técnico de campo', 'MG', '31', 'Belo Horizonte'],
      ['Sabrina Teixeira', 'Analista de suporte', 'SP', '11', 'São Paulo'],
    ];
    const P = pessoas.map(([nome, cargo, uf, ddd, cidade], i) => inserir('profissionais', {
      nome_completo: nome, cargo, uf, cidade, telefone: `(${ddd}) 90000-${String(1000 + i)}`,
      email: `${nome.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z]+/g, '.')}@demo.local`,
      status: nome === 'Rogério Tavares' ? 'inativo' : 'ativo', observacoes: DEMO,
    }));

    const L = ([
      ['Base São Paulo – Barra Funda', 'Rua Exemplo, 100', 'São Paulo', 'SP'], ['Base Campinas', 'Av. Modelo, 250', 'Campinas', 'SP'],
      ['Centro Operacional Rio – Zona Portuária', 'Rua de Demonstração, 45', 'Rio de Janeiro', 'RJ'], ['Base Curitiba', 'Rua Fictícia, 780', 'Curitiba', 'PR'],
      ['Unidade Salvador', 'Av. Exemplo, 15', 'Salvador', 'BA'], ['Base Belo Horizonte', 'Rua Modelo, 320', 'Belo Horizonte', 'MG'],
    ] as const).map(([nome, endereco, cidade, uf]) => inserir('locais', { nome, endereco, cidade, uf, responsavel: 'Responsável (demonstração)', telefone_contato: '(11) 90000-0000', status: 'ativo', observacoes: DEMO }));

    const proj = (nome: string, codigo: string, status: string, ini: number, fim: number | null, remoto: boolean, locais: number[]): number => {
      const id = inserir('projetos', { nome, codigo, status, solicitante: 'Solicitante (demonstração)', data_inicial: d(ini), data_final: fim === null ? null : d(fim), remoto: remoto ? 1 : 0, descricao: 'Projeto de demonstração.', observacoes: DEMO });
      for (const l of locais) executar(db, 'INSERT INTO projeto_locais (projeto_id, local_id) VALUES (?, ?)', id, l);
      return id;
    };
    const J = [
      proj('Modernização da Subestação Leste', 'MSL-01', 'ativo', -28, 60, false, [L[0]!, L[1]!]),
      proj('Manutenção Preventiva Rio', 'MPR-02', 'ativo', -60, 120, false, [L[2]!]),
      proj('Implantação Central Sul', 'ICS-03', 'ativo', -5, 40, false, [L[3]!]),
      proj('Suporte Remoto 24x7', 'SUP-04', 'ativo', -90, null, true, []),
      proj('Expansão Nordeste', 'EXN-05', 'planejamento', 7, 90, false, [L[4]!]),
    ];

    const hor = (nome: string, i: string, f: string, viraDia: boolean, intervalo: number): number => {
      const [hi, mi] = i.split(':').map(Number) as [number, number];
      const [hf, mf] = f.split(':').map(Number) as [number, number];
      const total = (viraDia ? 1440 - (hi * 60 + mi) + hf * 60 + mf : hf * 60 + mf - (hi * 60 + mi));
      return inserir('horarios', { nome, hora_inicio: i, hora_fim: f, vira_dia: viraDia ? 1 : 0, intervalo_minutos: intervalo, horas_previstas: (total - intervalo) / 60, status: 'ativo', observacoes: DEMO });
    };
    const H = [
      hor('Comercial (08h–17h)', '08:00', '17:00', false, 60), hor('Manhã (06h–14h)', '06:00', '14:00', false, 60),
      hor('Tarde (14h–22h)', '14:00', '22:00', false, 60), hor('Noturno (22h–06h)', '22:00', '06:00', true, 60),
      hor('Plantão 12h (07h–19h)', '07:00', '19:00', false, 60),
    ];

    // Quarto pedido de ajustes (outubro): a escala não tem mais um horário único para todos os
    // profissionais vinculados — cada combinação profissional+dia tem seu próprio horário, numa grade
    // (ver escala_dias). Aqui, para os dados de demonstração, cada profissional da lista recebe o mesmo
    // horário em todos os dias do período, só para ilustrar o cadastro; o teste "ponto 7" e a tela de
    // grade mostram um caso real com profissionais em dias/horários diferentes na mesma escala.
    const escala = (titulo: string, proj: number, local: number | null, horario: number, ini: number, fim: number, profs: number[], status: string): number => {
      const id = inserir('escalas', { titulo, projeto_id: proj, data_inicial: d(ini), data_final: d(fim), status, descricao: 'Escala de demonstração.', observacoes: DEMO });
      if (local) executar(db, 'INSERT INTO escala_locais (escala_id, local_id) VALUES (?, ?)', id, local);
      for (let dia = ini; dia <= fim; dia++) {
        for (const p of profs) {
          executar(
            db,
            `INSERT INTO escala_dias (escala_id, profissional_id, data, horario_id, criado_em, atualizado_em, criado_por, atualizado_por)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            id, p, d(dia), horario, agora, agora, adminId, adminId,
          );
        }
      }
      return id;
    };
    escala('MSL – Montagem de painéis', J[0]!, L[0]!, H[0]!, -7, 13, [P[0]!, P[1]!, P[2]!], 'em_andamento');
    escala('MSL – Comissionamento', J[0]!, L[1]!, H[0]!, 14, 27, [P[0]!, P[1]!], 'planejada');
    escala('MSL – Inspeção final', J[0]!, L[0]!, H[0]!, 21, 22, [P[2]!], 'planejada');
    escala('MSL – Levantamento inicial', J[0]!, L[0]!, H[0]!, -21, -15, [P[0]!, P[13]!], 'concluida');
    escala('MPR – Rota preventiva Zona Norte', J[1]!, L[2]!, H[1]!, 0, 4, [P[3]!, P[4]!], 'confirmada');
    escala('MPR – Rota preventiva Zona Sul', J[1]!, L[2]!, H[2]!, 0, 4, [P[5]!], 'confirmada');
    escala('MPR – Plantão de fim de semana', J[1]!, L[2]!, H[4]!, 5, 6, [P[3]!, P[5]!], 'confirmada');
    escala('MPR – Rota preventiva (semana passada)', J[1]!, L[2]!, H[1]!, -7, -3, [P[3]!, P[4]!], 'concluida');
    escala('ICS – Instalação de racks', J[2]!, L[3]!, H[0]!, 1, 12, [P[6]!, P[7]!], 'confirmada');
    escala('SUP – Suporte remoto (manhã)', J[3]!, null, H[1]!, -10, 20, [P[8]!], 'confirmada');
    escala('SUP – Suporte remoto (tarde)', J[3]!, null, H[2]!, -10, 20, [P[9]!], 'confirmada');
    escala('SUP – Suporte remoto (noturno)', J[3]!, null, H[3]!, -10, 20, [P[14]!], 'confirmada');
    escala('EXN – Levantamento de campo', J[4]!, L[4]!, H[0]!, 7, 11, [P[10]!, P[11]!], 'planejada');
    // Conflito intencional nº 1: reforço sobreposto à rota da Zona Norte (Patrícia, 08h–14h).
    escala('MPR – Reforço emergencial', J[1]!, L[2]!, H[0]!, 2, 2, [P[4]!], 'confirmada');

    const folga = (prof: number, tipo: string, ini: number, fim: number, status: string): void => {
      const id = inserir('folgas', { profissional_id: prof, tipo, data_inicial: d(ini), data_final: d(fim), status, motivo: 'Registro de demonstração.',
        aprovado_por: status === 'aprovada' ? adminId : null, aprovado_em: status === 'aprovada' ? agora : null });
      void id;
    };
    folga(P[3]!, 'folga_compensatoria', 10, 11, 'aprovada');
    folga(P[8]!, 'ferias', 22, 28, 'aprovada');
    folga(P[10]!, 'licenca', 1, 3, 'aprovada');
    folga(P[9]!, 'banco_de_horas', 12, 12, 'solicitada'); // pendente: não gera conflito até ser aprovada
    folga(P[4]!, 'folga_semanal', -2, -2, 'aprovada');
    // Conflito intencional nº 2: férias aprovadas de Fernanda durante a instalação de racks.
    folga(P[6]!, 'ferias', 5, 9, 'aprovada');

    const trein = (nome: string, instrutor: string, local: number | null, remoto: boolean, ini: number, fim: number, hi: string, hf: string, status: string, profs: number[]): void => {
      const dur = Number(hf.slice(0, 2)) * 60 + Number(hf.slice(3)) - (Number(hi.slice(0, 2)) * 60 + Number(hi.slice(3)));
      const id = inserir('treinamentos', { nome, instrutor, local_id: local, remoto: remoto ? 1 : 0, data_inicial: d(ini), data_final: d(fim), hora_inicio: hi, hora_fim: hf, vira_dia: 0, duracao_minutos: dur, status, descricao: 'Treinamento de demonstração.', observacoes: DEMO });
      vincular('treinamento_profissionais', 'treinamento_id', id, profs);
      for (const pid of profs) inserir('treinamento_horarios', { treinamento_id: id, profissional_id: pid, dias_semana: null, hora_inicio: hi }, false);
    };
    trein('Segurança em altura (NR-35)', 'Helena Prado', L[2]!, false, 8, 8, '09:00', '12:00', 'confirmado', [P[3]!, P[4]!, P[5]!]);
    trein('Integração de novos analistas', 'Helena Prado', null, true, 9, 9, '10:00', '12:00', 'planejado', [P[8]!, P[14]!]);
    trein('Formação de instrutores', 'Consultoria externa (demo)', L[0]!, false, 15, 15, '09:00', '16:00', 'confirmado', [P[12]!, P[2]!]);

    // uf omitida = feriado nacional; com uf = estadual; com uf e cidade = municipal.
    const per = (nome: string, tipo: string, ini: string, fim: string, uf: string | null = null, cidade: string | null = null): void => {
      inserir('periodos', { nome, tipo, uf, cidade, data_inicial: ini, data_final: fim, status: 'ativo', observacoes: DEMO });
    };
    const ano = Number(hoje.slice(0, 4));
    for (const a of [ano, ano + 1]) {
      per('Nossa Senhora Aparecida', 'feriado', `${a}-10-12`, `${a}-10-12`);
      per('Finados', 'feriado', `${a}-11-02`, `${a}-11-02`);
      per('Proclamação da República', 'feriado', `${a}-11-15`, `${a}-11-15`);
      per('Consciência Negra', 'feriado', `${a}-11-20`, `${a}-11-20`);
      per('Natal', 'feriado', `${a}-12-25`, `${a}-12-25`);
      // Feriados estaduais reais (demonstração — confira o calendário oficial ao cadastrar os seus).
      per('Revolução Constitucionalista', 'feriado', `${a}-07-09`, `${a}-07-09`, 'SP');
      per('Dia de São Jorge', 'feriado', `${a}-04-23`, `${a}-04-23`, 'RJ');
      per('Emancipação Política do Paraná', 'feriado', `${a}-12-19`, `${a}-12-19`, 'PR');
      per('Independência da Bahia (2 de Julho)', 'feriado', `${a}-07-02`, `${a}-07-02`, 'BA');
    }
    per('Recesso de fim de ano', 'recesso', `${ano}-12-24`, `${ano + 1}-01-02`);
    // Exemplos relativos a hoje (sempre visíveis no painel e na linha do tempo, qualquer que seja a
    // data em que o seed for executado), um de cada nível: nacional, estadual e municipal.
    per('[Demonstração] Feriado nacional de exemplo', 'feriado', d(3), d(3));
    per('[Demonstração] Feriado estadual de exemplo (PR)', 'feriado', d(10), d(10), 'PR');
    per('[Demonstração] Feriado municipal de exemplo (Curitiba/PR)', 'feriado', d(17), d(17), 'PR', 'Curitiba');
    return { admin: 'admin@demo.local', usuario: 'usuario@demo.local' };
  });
}

/** Apaga TUDO e cria só uma conta de administrador — para começar a usar o sistema do zero,
 *  sem nenhum dado de teste/demonstração (ex.: depois de explorar o sistema com os dados do seed). */
export function criarSomenteAdmin(db: DB, nome: string, email: string, senhaAdmin: string): { admin: string } {
  limparTudo(db);
  const agora = new Date().toISOString();
  executar(db, `INSERT INTO usuarios (nome, email, senha_hash, perfil, status, criado_em, atualizado_em)
                VALUES (?, ?, ?, 'administrador', 'ativo', ?, ?)`, nome, email.toLowerCase(), hashSenha(senhaAdmin), agora, agora);
  return { admin: email.toLowerCase() };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = carregarConfig();
  const db = abrirBanco(config.caminhoBanco);
  migrar(db);
  const definida = (nome: string): string => {
    const v = process.env[nome] ?? '';
    if (v && problemaNaSenha(v)) { console.error(`${nome} inválida. ${problemaNaSenha(v)}`); process.exit(1); }
    return v;
  };

  if (process.argv.includes('--limpar')) {
    // Apaga TUDO (inclusive os dados de demonstração) e deixa só um administrador. Sem confirmação
    // extra por linha de comando: quem roda este script já tem acesso ao arquivo do banco.
    const senhaAdmin = definida('SEED_ADMIN_PASSWORD') || senhaAleatoria();
    const r = criarSomenteAdmin(db, 'Administrador', 'admin@empresa.local', senhaAdmin);
    console.log('Todos os dados foram apagados. O sistema está em branco, com um único administrador:\n');
    console.log(`  ${r.admin}   senha: ${senhaAdmin}\n`);
    console.log('Anote a senha agora: ela não fica gravada em texto claro em nenhum lugar.');
    console.log('Dica: troque o e-mail e o nome desse administrador assim que entrar (Usuários → Editar).');
    process.exit(0);
  }

  const reset = process.argv.includes('--reset');
  if (Number(obter(db, 'SELECT COUNT(*) AS n FROM usuarios')!.n) > 0 && !reset) {
    console.error('O banco já contém dados. Use "npm run seed -- --reset" para apagar tudo e recriar a demonstração,\nou "npm run seed -- --limpar" para apagar tudo e começar em branco (só com um administrador).');
    process.exit(1);
  }
  if (reset) limparTudo(db);

  const senhaAdmin = definida('SEED_ADMIN_PASSWORD') || senhaAleatoria();
  const senhaUsuario = definida('SEED_USER_PASSWORD') || senhaAleatoria();
  const r = semear(db, { senhaAdmin, senhaUsuario });
  console.log('Dados de demonstração criados.\n');
  console.log(`  Administrador:  ${r.admin}   senha: ${senhaAdmin}`);
  console.log(`  Somente leitura: ${r.usuario}   senha: ${senhaUsuario}\n`);
  console.log('Anote as senhas agora: elas não ficam gravadas em texto claro em nenhum lugar.');
}
