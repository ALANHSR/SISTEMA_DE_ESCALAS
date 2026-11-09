// Script de importação ÚNICA dos dados reais da organização (planilha DADOS_GERAIS.xlsx),
// substituindo quaisquer dados existentes no banco (inclusive os de teste/demonstração).
//
// USO (uma vez só, a partir da pasta "escalas"):
//   node --disable-warning=ExperimentalWarning scripts/importar-dados-gerais.ts --confirmar
//
// Sem "--confirmar" o script só mostra o que faria, sem alterar nada (modo de conferência).
//
// O que faz:
//   1. Apaga TODOS os dados existentes no banco (profissionais, usuários, locais, horários,
//      escalas, folgas, treinamentos, projetos, feriados, auditoria — tudo).
//   2. Cadastra os profissionais, usuários, locais e horários exatamente como na planilha,
//      passando pelas MESMAS validações e regras de negócio do sistema (os dados aparecem no
//      cadastro exatamente como ficariam se alguém tivesse digitado cada um manualmente).
//   3. Cria todos os usuários com a senha inicial "Hap@2026" e marca a conta para exigir a troca
//      dessa senha no primeiro acesso (o sistema bloqueia qualquer outra tela até trocar).
//      A lista de e-mails criados é gravada em scripts/contas-criadas.csv, só como conferência.
//
// Correções aplicadas sobre os dados originais da planilha (documentadas para conferência):
//   - Telefone de Laryssa Coelho da Silva tinha um dígito a mais na planilha; ficou em branco.
//   - Os 4 hospitais de Manaus estavam com UF "MA" (Maranhão) na planilha; corrigidos para "AM"
//     (Amazonas), já que Manaus fica no Amazonas.
//   - 4 hospitais de Fortaleza/CE estavam com Situação em branco; assumidos como "Ativo".
//   - "Anderson Anderson Batista dos Santos" (nome duplicado em 4 responsáveis) corrigido para
//     "Anderson Batista dos Santos".
//   - Cidade de Francisco Laerte Mota Junior estava em branco na planilha; manteve-se em branco.
import { writeFileSync } from 'node:fs';
import { carregarConfig } from '../src/server/config.ts';
import { abrirBanco } from '../src/server/db.ts';
import { migrar } from '../src/server/migrate.ts';
import { limparTudo } from '../src/server/seed.ts';
import { salvar } from '../src/server/recursos.ts';
import { usuarios, profissionais, locais, horarios } from '../src/server/routes/cadastros.ts';
import { hashSenha } from '../src/server/auth.ts';
import { executar } from '../src/server/db.ts';
import type { Ctx } from '../src/server/http.ts';
import type { UsuarioSessao } from '../src/server/auth.ts';

// ---------------------------------------------------------------- Dados extraídos da planilha
const DADOS_PROFISSIONAIS = [
  ['Juliana Daisy de Abreu Rodrigues', 'COORDENADOR(A)', '85 99738-1044', 'Fortaleza', 'CE'],
  ['Alan Henrique Sezerino Rodrigues', 'ANALISTA', '41 99887-7241', 'Curitiba', 'PR'],
  ['Antonia Brena Santos da Cunha', 'ANALISTA', '85 99907-8882', 'Fortaleza', 'CE'],
  ['Brena Kelly de Morais Sampaio', 'ANALISTA', '85 99784-4560', 'Fortaleza', 'CE'],
  ['Debora Maria Barreto Matias', 'ANALISTA', '85 98755-1998', 'Fortaleza', 'CE'],
  ['Eduarda Almeida de Lima', 'ANALISTA', '85 98923-3732', 'Fortaleza', 'CE'],
  ['Geyciane de Sousa Oliveira Lopes', 'ANALISTA', '85 8156-0942', 'Fortaleza', 'CE'],
  ['Ivan Castro de Medrado', 'ANALISTA', '85 98210-1161', 'Fortaleza', 'CE'],
  ['Keilane Kerolen Alves Ribeiro', 'ANALISTA', '11 96523-0121', 'Fortaleza', 'CE'],
  ['Luana Benevides Farias', 'ANALISTA', '85 99219-5138', 'Fortaleza', 'CE'],
  ['Paloma Kelly da Silva Sotero', 'ANALISTA', '81 98776-8637', 'Recife', 'PE'],
  ['Pâmela Galdino Florentino de Castro', 'ANALISTA', '85 99787-6456', 'Fortaleza', 'CE'],
  ['Priscila Araujo Teixeira Melo', 'ANALISTA', '85 99927-0673', 'Fortaleza', 'CE'],
  ['Rodrigo Igor Alcantara do Nascimento', 'ANALISTA', '85 99650-8316', 'Fortaleza', 'CE'],
  ['Adriana Camara de Lemos', 'IMPLANTADOR(A)', '98 98459-7342', 'São Luís', 'MA'],
  ['Alice Brunelle Teixeira de Oliveira', 'IMPLANTADOR(A)', '81 99426-5858', 'Recife', 'PE'],
  ['Ana Carla dos Santos', 'IMPLANTADOR(A)', '71 98101-4815', 'Salvador', 'BA'],
  ['Ana Paula Marins Matos', 'IMPLANTADOR(A)', '71 99178-4146', 'Camaçari', 'BA'],
  ['Anderson Batista dos Santos', 'IMPLANTADOR(A)', '13 99107-2686', 'São Paulo', 'SP'],
  ['Aparecida Kelly Ramos', 'IMPLANTADOR(A)', '79 98891-4088', 'Aracaju', 'SE'],
  ['Debora Forlan Ferreira de Souza', 'IMPLANTADOR(A)', '81 99263-7409', 'Recife', 'PE'],
  ['Francisco Laerte Mota Junior', 'IMPLANTADOR(A)', '85 99205-7743', '', 'CE'],
  ['Gabriela dos Santos Cassão de Araujo', 'IMPLANTADOR(A)', '21 99645-9162', 'Rio de Janeiro', 'RJ'],
  ['Joel Benchimol Freire', 'IMPLANTADOR(A)', '92 99419-3629', 'Manaus', 'AM'],
  ['Laryssa Coelho da Silva', 'IMPLANTADOR(A)', '', 'São Paulo', 'SP'],
  ['Karla Rafaelly Souza da Silva', 'IMPLANTADOR(A)', '81 99949-0195', 'Recife', 'PE'],
  ['Kettyney Loyanny Souza do Nascimento', 'IMPLANTADOR(A)', '62 93300-9271', 'Goiania', 'GO'],
  ['Laiane Rodrigues Brandão Pinto', 'IMPLANTADOR(A)', '82 99902-7068', 'Maceio', 'AL'],
  ['Luiz Gustavo Silva de Miranda', 'IMPLANTADOR(A)', '31 99853-4949', 'Belo Horizonte', 'MG'],
  ['Maria Lucindeide da Silva Costa', 'IMPLANTADOR(A)', '84 99109-9845', 'Mossoró', 'RN'],
  ['Reginaldo França dos Santos Junior', 'IMPLANTADOR(A)', '83 98773-0388', 'João Pessoa', 'PB'],
  ['Renan Menezes', 'IMPLANTADOR(A)', '11 98429-2307', 'São Paulo', 'SP'],
  ['Richard Ribeiro Saraiva', 'IMPLANTADOR(A)', '51 98543-4117', 'Porto Alegre', 'RS'],
] as const;

const DADOS_USUARIOS = [
  ['Juliana Daisy de Abreu Rodrigues', 'julianaar@hapvida.com.br', 'administrador'],
  ['Alan Henrique Sezerino Rodrigues', 'alan.rodrigues@hapvida.com.br', 'administrador'],
  ['Antonia Brena Santos da Cunha', 't_antonia.cunha@hapvida.com.br', 'administrador'],
  ['Brena Kelly de Morais Sampaio', 't_brena.sampaio@hapvida.com.br', 'administrador'],
  ['Debora Maria Barreto Matias', 't_debora.matias@hapvida.com.br', 'administrador'],
  ['Eduarda Almeida de Lima', 't_eduarda.lima@hapvida.com.br', 'administrador'],
  ['Geyciane de Sousa Oliveira Lopes', 'geyciana.lopes@hapvida.com.br', 'administrador'],
  ['Ivan Castro de Medrado', 'ivan.medrado@hapvida.com.br', 'administrador'],
  ['Keilane Kerolen Alves Ribeiro', 't_keilane.ribeiro@hapvida.com.br', 'administrador'],
  ['Luana Benevides Farias', 't_luana.farias@hapvida.com.br', 'administrador'],
  ['Paloma Kelly da Silva Sotero', 'paloma.sotero@hapvida.com.br', 'administrador'],
  ['Pâmela Galdino Florentino de Castro', 'pamela.galdino@hapvida.com.br', 'administrador'],
  ['Priscila Araujo Teixeira Melo', 'priscila.melo@hapvida.com.br', 'administrador'],
  ['Rodrigo Igor Alcantara do Nascimento', 'rodrigo.nascimento@hapvida.com.br', 'administrador'],
  ['Adriana Camara de Lemos', 'adrianacl@hapvida.com.br', 'usuario'],
  ['Alice Brunelle Teixeira de Oliveira', 'alice.teixeira@hapvida.com.br', 'usuario'],
  ['Ana Carla dos Santos', 'ana.csantos@hapvida.com.br', 'usuario'],
  ['Ana Paula Marins Matos', 'ana.matos@hapvida.com.br', 'usuario'],
  ['Anderson Batista dos Santos', 't_anderson.batista@hapvida.com.br', 'usuario'],
  ['Aparecida Kelly Ramos', 'kellyrf@hapvida.com.br', 'usuario'],
  ['Debora Forlan Ferreira de Souza', 'debora.forlan@hapvida.com.br', 'usuario'],
  ['Francisco Laerte Mota Junior', 'francisco.laerte@hapvida.com.br', 'usuario'],
  ['Gabriela dos Santos Cassão de Araujo', 't_gabriela.araujos@hapvida.com.br', 'usuario'],
  ['Joel Benchimol Freire', 'joel.freire@hapvida.com.br', 'usuario'],
  ['Laryssa Coelho da Silva', 'laryssa.silvac@hapvida.com.br', 'usuario'],
  ['Karla Rafaelly Souza da Silva', 'karlars@hapvida.com.br', 'usuario'],
  ['Kettyney Loyanny Souza do Nascimento', 'kettyney.nascimento@hapvida.com.br', 'usuario'],
  ['Laiane Rodrigues Brandão Pinto', 'laiane.pinto@hapvida.com.br', 'usuario'],
  ['Luiz Gustavo Silva de Miranda', 'luiz.miranda@hapvida.com.br', 'usuario'],
  ['Maria Lucindeide da Silva Costa', 'mlucineide@hapvida.com.br', 'usuario'],
  ['Reginaldo França dos Santos Junior', 'reginaldof@hapvida.com.br', 'usuario'],
  ['Renan Menezes', 't_renan.mz@hapvida.com.br', 'usuario'],
  ['Richard Ribeiro Saraiva', 'richard.saraiva@hapvida.com.br', 'usuario'],
] as const;

const DADOS_LOCAIS = [
  ['Hospital Ônix Mateus Leme', 'Curitiba', 'PR', 'Alan Henrique Sezerino Rodrigues'],
  ['Hospital Ônix Batel', 'Curitiba', 'PR', 'Alan Henrique Sezerino Rodrigues'],
  ['Hospital e Maternidade Santa Brígida', 'Curitiba', 'PR', 'Alan Henrique Sezerino Rodrigues'],
  ['Hospital Geral da Paraib', 'João Pessoa', 'PB', 'Reginaldo França dos Santos Junior'],
  ['Hospital Guarás', 'São Luís', 'MA', 'Adriana Camara de Lemos'],
  ['Hospital Ariano Suassuna', 'Recife', 'PE', 'Alice Brunelle Teixeira de Oliveira, Debora Forlan Ferreira de Souza e Karla Rafaelly Souza da Silva'],
  ['Hospital Ilha do Leite', 'Recife', 'PE', 'Alice Brunelle Teixeira de Oliveira, Debora Forlan Ferreira de Souza e Karla Rafaelly Souza da Silva'],
  ['Hospital Vasco Lucena', 'Recife', 'PE', 'Alice Brunelle Teixeira de Oliveira, Debora Forlan Ferreira de Souza e Karla Rafaelly Souza da Silva'],
  ['Hospital Mandacaru', 'Recife', 'PE', 'Alice Brunelle Teixeira de Oliveira, Debora Forlan Ferreira de Souza e Karla Rafaelly Souza da Silva'],
  ['Hospital Cabo', 'Recife', 'PE', 'Alice Brunelle Teixeira de Oliveira, Debora Forlan Ferreira de Souza e Karla Rafaelly Souza da Silva'],
  ['Hospital Teresa de Lisieux', 'Salvador', 'BA', 'Ana Carla dos Santos'],
  ['Hospital SEMED', 'Camaçari', 'BA', 'Ana Paula Marins Matos'],
  ['Hospital Gabriel Soares', 'Aracaju', 'SE', 'Aparecida Kelly Ramos'],
  ['Hospital Vera Cruz', 'Belo Horizonte', 'MG', 'Luiz Gustavo Silva de Miranda'],
  ['Hospital e Maternidade Otaviano Neves', 'Belo Horizonte', 'MG', 'Luiz Gustavo Silva de Miranda'],
  ['Hospital Life Center', 'Belo Horizonte', 'MG', 'Luiz Gustavo Silva de Miranda'],
  ['Hospital Infantil Intermédica Jacarepaguá', 'Rio de Janeiro', 'RJ', 'Gabriela dos Santos Cassão de Araujo'],
  ['Hospital NotreCare Rio', 'Rio de Janeiro', 'RJ', 'Gabriela dos Santos Cassão de Araujo'],
  ['Hospital do Coração Duque de Caxias', 'Duque de Caxias', 'RJ', 'Gabriela dos Santos Cassão de Araujo'],
  ['Hospital Santa Marta', 'Niterói', 'RJ', 'Gabriela dos Santos Cassão de Araujo'],
  ['Hospital Humaniza', 'Porto Alegre', 'RS', 'Richard Ribeiro Saraiva'],
  ['Hospital Rio Negro', 'Manaus', 'AM', 'Joel Benchimol Freire'],
  ['Hospital Rio Solimões', 'Manaus', 'AM', 'Joel Benchimol Freire'],
  ['Hospital Rio Amazonas', 'Manaus', 'AM', 'Joel Benchimol Freire'],
  ['Hospital Nilton Lins', 'Manaus', 'AM', 'Joel Benchimol Freire'],
  ['Hospital e Maternidade Maceio', 'Maceio', 'AL', 'Laiane Rodrigues Brandão Pinto'],
  ['Hospital Celina Guimarães Viana', 'Mossoró', 'RN', 'Maria Lucindeide da Silva Costa'],
  ['Hospital Jardim América', 'Goiania', 'GO', 'Kettyney Loyanny Souza do Nascimento'],
  ['Hospital América', 'Goiania', 'GO', 'Kettyney Loyanny Souza do Nascimento'],
  ['Hospital Promed', 'Goiania', 'GO', 'Kettyney Loyanny Souza do Nascimento'],
  ['Hospital Salvalus', 'São Paulo', 'SP', 'Anderson Batista dos Santos, Laryssa Coelho da Silva e Renan Menezes'],
  ['Hospital Bosque da Saúde', 'São Paulo', 'SP', 'Anderson Batista dos Santos, Laryssa Coelho da Silva e Renan Menezes'],
  ['Hospital Jardim Anália Franco', 'São Paulo', 'SP', 'Anderson Batista dos Santos, Laryssa Coelho da Silva e Renan Menezes'],
  ['Hospital Nossa Senhora do Rosário', 'São Paulo', 'SP', 'Anderson Batista dos Santos, Laryssa Coelho da Silva e Renan Menezes'],
  ['Hospital Antonio Prudente', 'Fortaleza', 'CE', 'Francisco Laerte Mota Junior'],
  ['Hospital Ana Lima', 'Fortaleza', 'CE', 'Francisco Laerte Mota Junior'],
  ['Hospital Luis França', 'Fortaleza', 'CE', 'Francisco Laerte Mota Junior'],
  ['Hospital Aldeota', 'Fortaleza', 'CE', 'Francisco Laerte Mota Junior'],
] as const;

// nome, início, término, vira_dia, intervalo_minutos (calculado para reproduzir as "horas previstas" da planilha)
const DADOS_HORARIOS = [
  ['D1 /1', '07:00', '17:00', false, 60],
  ['D1 /2', '08:00', '18:00', false, 60],
  ['MT /1', '07:00', '19:00', false, 0],
  ['MT /2', '08:00', '20:00', false, 0],
  ['D2 /1', '11:00', '20:00', false, 0],
  ['D2 /2', '12:00', '21:00', false, 0],
] as const;

// ---------------------------------------------------------------- Execução
function contexto(db: ReturnType<typeof abrirBanco>, config: ReturnType<typeof carregarConfig>, usuario: UsuarioSessao): Ctx {
  return {
    db, config, user: usuario, tokenHash: null, tokenBruto: null, ip: 'script-importacao', cookies: [],
    req: {} as Ctx['req'], res: {} as Ctx['res'], url: new URL('http://localhost/'), query: new URLSearchParams(), params: {}, body: {},
  };
}

const SENHA_INICIAL = 'Hap@2026';

async function principal(): Promise<void> {
  const confirmar = process.argv.includes('--confirmar');
  const config = carregarConfig();
  const db = abrirBanco(config.caminhoBanco);
  migrar(db);

  console.log(`Isto vai APAGAR TODOS os dados atuais do banco e cadastrar ${DADOS_PROFISSIONAIS.length} profissionais, ${DADOS_USUARIOS.length} usuários, ${DADOS_LOCAIS.length} locais e ${DADOS_HORARIOS.length} horários.`);
  console.log(`Todos os usuários serão criados com a senha inicial "${SENHA_INICIAL}" e obrigados a trocá-la no primeiro acesso.`);
  if (!confirmar) {
    console.log('\nNada foi alterado (modo de conferência). Para aplicar de verdade, rode novamente com --confirmar:');
    console.log('  node --disable-warning=ExperimentalWarning scripts/importar-dados-gerais.ts --confirmar');
    return;
  }

  limparTudo(db);

  // Bootstrap: insere a primeira administradora diretamente (ainda não existe nenhum usuário
  // para ser o "criado por"), e usa o id real dela para todo o restante da importação.
  const [nomeBootstrap, emailBootstrap] = DADOS_USUARIOS[0];
  const agora = new Date().toISOString();
  const idBootstrap = executar(
    db,
    `INSERT INTO usuarios (nome, email, senha_hash, perfil, status, deve_trocar_senha, criado_em, atualizado_em)
     VALUES (?, ?, ?, 'administrador', 'ativo', 1, ?, ?)`,
    nomeBootstrap, emailBootstrap.toLowerCase(), hashSenha(SENHA_INICIAL), agora, agora,
  ).id;
  const ctx = contexto(db, config, { id: idBootstrap, nome: nomeBootstrap, email: emailBootstrap, perfil: 'administrador', deveTrocarSenha: true });

  const contas: { nome: string; email: string }[] = [{ nome: nomeBootstrap, email: emailBootstrap }];
  const erros: string[] = [];

  for (const [nome, email, perfil] of DADOS_USUARIOS.slice(1)) {
    try {
      salvar(usuarios, ctx, null, { nome, email, senha: SENHA_INICIAL, perfil, status: 'ativo', deve_trocar_senha: true });
      contas.push({ nome, email });
    } catch (e) {
      erros.push(`Usuário "${nome}" (${email}): ${(e as Error).message}`);
    }
  }

  for (const [nome_completo, cargo, telefone, cidade, uf] of DADOS_PROFISSIONAIS) {
    try {
      salvar(profissionais, ctx, null, { nome_completo, cargo, telefone: telefone || null, cidade: cidade || null, uf, status: 'ativo' });
    } catch (e) {
      erros.push(`Profissional "${nome_completo}": ${(e as Error).message}`);
    }
  }

  for (const [nome, cidade, uf, responsavel] of DADOS_LOCAIS) {
    try {
      salvar(locais, ctx, null, { nome, cidade, uf, responsavel, status: 'ativo' });
    } catch (e) {
      erros.push(`Local "${nome}": ${(e as Error).message}`);
    }
  }

  for (const [nome, hora_inicio, hora_fim, vira_dia, intervalo_minutos] of DADOS_HORARIOS) {
    try {
      salvar(horarios, ctx, null, { nome, hora_inicio, hora_fim, vira_dia, intervalo_minutos, status: 'ativo' });
    } catch (e) {
      erros.push(`Horário "${nome}": ${(e as Error).message}`);
    }
  }

  const caminhoContas = new URL('./contas-criadas.csv', import.meta.url).pathname;
  writeFileSync(caminhoContas, '\uFEFFNome;E-mail\r\n' + contas.map((c) => `${c.nome};${c.email}`).join('\r\n') + '\r\n', 'utf8');

  console.log(`\nImportação concluída: ${contas.length} usuário(s), ${DADOS_PROFISSIONAIS.length - erros.filter((e) => e.startsWith('Profissional')).length} profissional(is), ${DADOS_LOCAIS.length - erros.filter((e) => e.startsWith('Local')).length} local(is), ${DADOS_HORARIOS.length - erros.filter((e) => e.startsWith('Horário')).length} horário(s).`);
  console.log(`\nTodos entram com a senha "${SENHA_INICIAL}" e o sistema vai obrigar a troca no primeiro acesso de cada um.`);
  console.log(`Lista de e-mails gravada em: ${caminhoContas}`);
  if (erros.length) {
    console.log(`\n${erros.length} item(ns) NÃO foram importados:`);
    for (const e of erros) console.log(' -', e);
  }
}

principal();
