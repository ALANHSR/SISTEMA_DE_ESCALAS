# Sistema de Escalas, Folgas e Treinamentos

Controle de escalas de trabalho, folgas e treinamentos de profissionais, com linha do tempo
(Gantt) como tela principal, detecção automática de conflitos de agenda, autorização por perfil
verificada no servidor e auditoria básica de alterações.

## Aviso importante sobre a stack

O pedido original especificava Next.js/React/TypeScript/Prisma/PostgreSQL, com a ressalva de que,
"se o ambiente já impuser outra stack, mantenha a existente". O ambiente onde este sistema foi
construído **não tem acesso à internet** a partir do terminal (o registro do npm responde
`403 host_not_allowed`), o que torna impossível instalar Next.js, React, Prisma, PostgreSQL ou
qualquer outra dependência de terceiros.

Por isso, a stack final é:

- **Backend:** Node.js 22 com TypeScript nativo (o próprio Node remove as anotações de tipo em
  tempo de execução — não há passo de build/transpilação) e um roteador HTTP escrito à mão sobre
  `node:http`.
- **Banco de dados:** SQLite embutido via `node:sqlite` (módulo nativo do Node, sem dependências
  externas), com um arquivo único em `data/escalas.db`.
- **Frontend:** aplicação de página única (SPA) em JavaScript puro (módulos ES nativos do
  navegador), com roteamento por hash (`#/...`) e CSS Grid para a linha do tempo — sem React,
  bundler ou qualquer biblioteca de terceiros.

Não há **nenhuma dependência de terceiros em tempo de execução** (o `package.json` só tem
`typescript` e `@types/node` como dependências de desenvolvimento, usadas apenas para checagem de
tipos). Todas as regras de negócio, validações, autorização e detecção de conflitos pedidas no
escopo original foram implementadas por completo; o que mudou foi apenas a caixa de ferramentas.

Se, em outro ambiente, houver acesso à internet e for desejável migrar para a stack sugerida
originalmente (Next.js/Prisma/PostgreSQL), a separação de camadas foi mantida deliberadamente
simples para facilitar isso: toda a lógica de negócio está em `src/server/regras.ts` e
`src/server/conflitos.ts`, independente do framework HTTP ou do banco de dados.

## Requisitos

- Node.js 22.18 ou superior (usa `node:sqlite`, ainda experimental nesta versão do Node — o aviso
  correspondente é suprimido nos próprios scripts do `package.json`).
- Nenhum banco de dados externo, nenhuma instalação de pacotes.

## Instalação e primeira execução

```bash
# 1. Copie e ajuste as variáveis de ambiente
cp .env.example .env
# Gere um segredo de sessão (recomendado, embora um temporário seja gerado automaticamente em dev):
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# cole o valor em SESSION_SECRET no .env

# 2. Aplique as migrations (cria o arquivo data/escalas.db e as tabelas)
npm run migrate

# 3a. Opção A: crie um administrador real
ADMIN_PASSWORD='SenhaForte123' npm run criar-admin -- "Seu Nome" seu.email@empresa.com.br

# 3b. Opção B: ou popule com dados de demonstração (profissionais, projetos, escalas, folgas,
#     treinamentos fictícios, incluindo 2 conflitos de agenda propositais para validar a tela)
SEED_ADMIN_PASSWORD='Admin-123456' SEED_USER_PASSWORD='Usuario-123456' npm run seed
# Sem as variáveis acima, o seed gera senhas aleatórias e as imprime uma única vez no terminal.

# 4. Inicie o servidor
npm start
# ou, em desenvolvimento, com reinício automático ao salvar arquivos:
npm run dev
```

Acesse `http://127.0.0.1:3000` (ou a porta/host configurados em `PORT`/`HOST`).

Para recriar os dados de demonstração do zero (apagando tudo): `npm run seed -- --reset`.

Para **apagar tudo (inclusive os dados de demonstração/teste) e começar em branco**, com um único
administrador e nada mais, use:
```bash
SEED_ADMIN_PASSWORD='SenhaForte123' npm run seed -- --limpar
```
Isso cria o administrador `admin@empresa.local` — troque o e-mail e o nome dele pela tela de
Usuários assim que entrar. Essa ação não pode ser desfeita (preserva a regra de não ter exclusão
física de registros individuais, mas aqui o próprio administrador está pedindo para zerar o banco
inteiro de propósito).

## Scripts disponíveis

| Script | O que faz |
| --- | --- |
| `npm start` | Sobe o servidor (aplica migrations pendentes automaticamente antes de escutar). |
| `npm run dev` | Igual ao anterior, reiniciando ao detectar alterações nos arquivos. |
| `npm run migrate` | Aplica manualmente as migrations pendentes em `migrations/`. |
| `npm run seed` | Cria os dados de demonstração (falha se o banco já tiver dados; use `-- --reset` para recriar, ou `-- --limpar` para apagar tudo e deixar só um administrador). |
| `npm run criar-admin -- "Nome" email@empresa.com` | Cria um usuário administrador (senha via variável `ADMIN_PASSWORD`, nunca em texto na linha de comando). |
| `npm test` | Roda a suíte de testes (`node --test`, 69 testes cobrindo autenticação, cadastros, conflitos de agenda, recorrência, importação, timeline e dashboard). |
| `npm run typecheck` | Checagem de tipos com `tsc --noEmit`, sem gerar arquivos. |
| `npm run lint` | Lint próprio, sem dependências externas (ver "Sobre o lint" abaixo). |
| `npm run build` | Roda typecheck, lint e testes, nessa ordem — usado antes de qualquer entrega. |

### Sobre o lint

Como não há acesso ao registro do npm para instalar ESLint, `npm run lint`
(`scripts/lint.mjs`) é um verificador próprio, sem dependências, que garante: sintaxe válida em
todo o JavaScript do frontend, ausência de `debugger`, ausência de igualdade frouxa (`==`/`!=`
fora de `===`/`!==`) e ausência de `console.log` fora dos scripts de linha de comando. Usos de
`any` em TypeScript são reportados como aviso informativo, sem falhar o build.

## Estrutura do projeto

```
migrations/                  Esquema do banco, aplicado em ordem (001 inicial, 002 dias da semana, 003 região dos feriados)
src/shared/datetime.ts       Utilitários de data/hora (fuso America/Sao_Paulo), usados pelo servidor
src/server/
  config.ts                  Leitura e validação das variáveis de ambiente
  db.ts, migrate.ts          Acesso ao SQLite e aplicação de migrations
  auth.ts                    Hash de senha (scrypt), sessões, CSRF, limitador de tentativas de login
  validacao.ts               Motor de validação de formulários (mensagens em português)
  regras.ts                  Regras de negócio compartilhadas (períodos, horários, referências)
  conflitos.ts                Detecção de conflitos de agenda (regras 5 a 8 — ver abaixo)
  recursos.ts                Motor genérico de CRUD (listagem, detalhe, criação, edição, status, CSV)
  auditoria.ts, rotulos.ts   Histórico de alterações e rótulos em português
  http.ts, app.ts, index.ts  Roteador HTTP nativo, autorização no servidor, montagem do servidor
  routes/                    Rotas: auth, cadastros, agenda (escalas/folgas/treinamentos), consultas
  seed.ts, criar-admin.ts    Scripts de linha de comando
public/                      Frontend (SPA em JavaScript puro, sem build step)
  index.html, css/estilos.css
  js/                        api.js, roteador.js, estado.js, ui.js, entidades.js, datahora.js
  js/views/                  login, painel (dashboard), linha do tempo (Gantt), cadastros, agenda
tests/                       Testes (node --test), um arquivo por etapa de implementação
```

## Perfis de acesso

- **Administrador:** acesso total — cria, edita e altera a situação de todos os cadastros e da
  agenda; vê o histórico de auditoria de cada registro; exporta CSV.
- **Usuário (somente leitura):** vê o painel, a linha do tempo e as listagens, mas nenhuma rota de
  criação/edição/exportação está disponível — e isso é garantido no servidor, não apenas ocultando
  botões na tela. O motivo de uma folga não é exibido a este perfil.

A autorização de cada rota é declarada explicitamente no roteador (`src/server/http.ts`), que
recusa em tempo de registro qualquer rota de escrita marcada como acessível a "usuário comum" sem
uma exceção explícita — isso é verificado por um teste (`tests/cadastros.test.ts`, "toda rota de
mutação é admin") que efetivamente chama cada rota de mutação como usuário comum e confirma 403.

## Regras de negócio implementadas

1. Profissionais, locais, horários e projetos inativos/encerrados não recebem **novos** vínculos,
   mas vínculos já existentes permanecem visíveis no histórico.
2. Nenhum registro é fisicamente excluído: cadastros são inativados e itens de agenda são
   cancelados/recusados, preservando o histórico.
3–4. Uma escala só pode ser confirmada (ou avançar de status) se tiver projeto, ao menos um
   profissional vinculado e ao menos um local (uma escala aceita **vários locais**) — exceto
   quando o projeto é marcado como remoto/sem local definido.
5–7. Duas ocupações "firmes" do mesmo profissional que se sobrepõem no tempo são um conflito:
   escala × escala, escala × folga aprovada, escala × treinamento confirmado (e as demais
   combinações entre os três tipos). Apenas os status "firmes" contam como ocupação: escala
   (planejada, confirmada, em andamento, concluída), folga (só aprovada), treinamento (só
   confirmado).
8. Conflitos **bloqueiam** o salvamento (HTTP 409, com a lista de registros conflitantes). O
   administrador pode confirmar "salvar mesmo assim" (`forcar: true`), e essa decisão fica
   registrada na auditoria como `conflito_forcado`.
9. Data final nunca pode ser anterior à data inicial (com limite de 366 dias por registro em
   escalas e treinamentos).
10. Horário final menor que o inicial só é aceito quando o registro está marcado como "virada de
    dia" (o turno termina no dia seguinte).
11. Sem exclusão física em nenhuma tabela — apenas inativação/cancelamento.
12. Toda criação e alteração relevante fica registrada em auditoria (usuário, quando, o que
    mudou).
13. Filtros de período (na listagem de agenda e na linha do tempo) funcionam corretamente para
    intervalos que atravessam meses e anos.

Essas regras têm testes automatizados dedicados em `tests/conflitos.test.ts` (a lógica pura de
detecção) e `tests/agenda.test.ts` (o comportamento de ponta a ponta via API).

## Fuso horário e formatos

- Datas são armazenadas e trafegam como texto `AAAA-MM-DD`; horários como `HH:MM` (24 horas). A
  interface converte para `DD/MM/AAAA` na exibição.
- "Hoje" e "agora" são sempre calculados no fuso `America/Sao_Paulo`, tanto no backend quanto no
  frontend, independentemente do fuso do servidor ou do navegador de quem acessa.

## Recursos adicionais

### Recorrência por dia da semana
Folgas e treinamentos têm o campo **Dias da semana** (domingo a sábado, com atalhos "Todos os
dias" e "Dias úteis"). É recorrência de verdade: os dias não selecionados **não contam como
ocupação** (não geram conflito) e **não aparecem na linha do tempo** — que desenha um trecho de
barra para cada sequência de dias ativos. Com virada de dia, vale o dia em que o turno *começa*.
Registros sem esse campo continuam valendo em todos os dias do período. Escalas não têm mais esse
campo desde o quarto pedido de ajustes (ver abaixo): cada dia de cada profissional é uma célula
explícita da grade, então não há recorrência para configurar.

### Importação de escalas em massa (CSV)
Em **Escalas → Importar CSV** (administrador). Há um modelo para baixar no próprio diálogo.
Colunas: `Título; Código do projeto; Local; Data inicial; Data final; Horário; Situação; Dias da
semana; Profissionais; Descrição` (obrigatórias: título, datas, horário e profissionais). O
**Horário** é o nome de um horário já cadastrado em **Horários** (ex.: `D1`, `Noturno`) — desde o
quarto pedido de ajustes (ver abaixo), a escala não tem mais hora início/fim/virada de dia
próprias: cada linha do CSV aplica o horário escolhido a todos os profissionais da linha, em
todas as datas do período que casarem com **Dias da semana** (ou todas, se em branco/"Todos").
Separador `;` ou `,`; datas `DD/MM/AAAA`; vários profissionais e vários locais separados por `|`
(nome, sem diferenciar acentos/maiúsculas — mesmo padrão nas duas colunas); dias como `Seg, Ter,
Qua`, `Dias úteis` ou `Todos`. Cada linha vira uma escala própria (com sua grade de dias já
preenchida) e passa pelas mesmas validações e detecção de conflitos do cadastro manual; linhas com
problema são listadas (com o motivo) e **não impedem as demais**. Para um mesmo posto com
profissionais em dias/horários diferentes entre si, use o cadastro manual pela tela (grade) ou uma
linha de CSV por padrão/profissional. Há a opção de importar mesmo havendo conflitos (registrada
na auditoria). Limite: 1.000 linhas por arquivo. Só CSV é aceito (leitura de .xlsx exigiria uma
biblioteca externa) — no Excel, use *Salvar como → CSV*.

### Escala com mais de um local
O campo **Locais** do cadastro de escala é de múltipla seleção (com atalhos "Selecionar
todos"/"Limpar seleção"), para os casos em que a mesma escala cobre mais de uma unidade. Afeta
listagem, exportação CSV, busca, filtro da linha do tempo (`?local_id=`, que considera a escala se
qualquer um dos locais vinculados bater) e a importação em massa. Treinamentos continuam com um
único local (reflete melhor como um treinamento é agendado na prática).

### Feriados por região (nacional, estadual ou municipal)
Em **Feriados e recessos**, cada registro pode ser: **nacional** (sem estado), **estadual** (só
estado) ou **municipal** (estado + cidade). Profissionais agora têm um campo **Cidade**, além do
estado que já existia. Na linha do tempo, cada feriado colore a coluna do dia só para quem ele
realmente vale — nacional para todos, estadual para quem é do mesmo estado, municipal para quem é
do mesmo estado **e** cidade (o cabeçalho do dia e o passar do mouse mostram o detalhe). O painel
inicial lista os próximos feriados com a região. O seed cria três exemplos de demonstração — um de
cada nível, com datas sempre próximas de hoje — além de feriados estaduais reais (SP, RJ, PR, BA)
em datas fixas do calendário (esses só aparecem quando a linha do tempo estiver no mês deles).

Além de colorir a linha do tempo, o feriado agora **vira folga automática** (firme) para todo
profissional cuja UF/cidade cadastrada esteja dentro da abrangência dele — sem precisar cadastrar
a folga manualmente, e sem gravar nada na tabela de folgas (é calculado a cada consulta, então
passa a valer assim que o feriado ou a localidade do profissional mudarem). Isso entra tanto na
linha do tempo (aparece como uma folga do tipo "Feriado") quanto na detecção de conflitos: escalar
alguém por cima de um feriado da sua região passa a ser bloqueado como qualquer outro conflito de
agenda (pode ser confirmado mesmo assim com "salvar mesmo assim", como os demais).

### Treinamentos vinculados a um projeto
Treinamentos agora têm um campo **Projeto** opcional (igual às escalas), útil para treinamentos
específicos de uma obra ou implantação; treinamentos corporativos genéricos podem deixar em branco.

## Segundo pedido de ajustes (outubro)

1. **Projetos: data final na listagem.** A tabela de Projetos agora mostra a coluna **Término**
   (além do **Início**), ordenável.
2. **Projetos: conclusão automática.** Um projeto **ativo** cuja data final já passou muda
   sozinho para **concluído** — sem precisar de ninguém abrir o cadastro. Não há um processo em
   segundo plano neste ambiente, então a verificação roda a cada requisição autenticada (no
   máximo uma vez por minuto, para não pesar o banco); a mudança fica registrada na auditoria
   (usuário "sistema").
3. **Busca dentro de uma lista de múltipla seleção.** Os campos de **Locais** (em Projetos e em
   Escalas) ganharam uma caixa de busca acima da lista quando ela tem mais de 6 opções — digitar
   filtra os itens visíveis sem desmarcar o que já estava selecionado.
4. **Escalas: conclusão automática.** Mesma lógica do item 2: uma escala **em andamento** cuja
   data final já passou vira **concluída** sozinha.
5. **Escalas: múltipla seleção de locais, com atalho "selecionar todos".** Já implementado no
   primeiro pedido de ajustes (ver "Escala com mais de um local" abaixo) — confirmado e mantido.
6. **Linha do tempo: cinza apagado para "concluído".** Ajustado após o primeiro retorno — a cor
   agora é um cinza dessaturado com opacidade reduzida (em vez do verde escuro anterior), para ler
   como "encerrado/apagado" e não como mais uma cor de status em uso.
7. **Escala 12x36/24x48 (ciclo de dias).** O campo de semana par/ímpar (abaixo) não resolvia o caso
   real: num plantão 12x36 o dia da semana muda a cada ocorrência (ex.: Alan trabalha 13, 15, 17,
   19, 21, 23/10… e Ivan, no mesmo posto, 14, 16, 18, 20, 22, 24/10…), então não dá para marcar
   "segunda e quinta" — não é um padrão por dia da semana, é um **ciclo que se repete a partir da
   própria data inicial do registro**. Por isso, o cadastro de escala ganhou o campo **"Escala
   12x36 (repetir a cada quantos dias)"**: preenchendo `2`, a escala ocorre a cada 2 dias a partir
   da data inicial (13, 15, 17…); `3` cobriria um 24x48. Entra na geração da linha do tempo (que
   agora desenha só os dias certos, em vez da barra contínua) e na detecção de conflitos — duas
   escalas em ciclos de 2 dias com datas iniciais em paridade oposta (como Alan e Ivan) nunca caem
   no mesmo dia, então não conflitam entre si mesmo cobrindo o mesmo posto e horário.
   O campo **Semana** (par/ímpar por semana ISO) da primeira tentativa continua disponível à parte,
   para o caso diferente de um revezamento **semanal** (ex.: trabalha a semana inteira em semanas
   pares) — mas não é o que resolve um 12x36. De passagem, essa verificação de semana par/ímpar
   também foi corrigida: ela já valia para bloquear conflitos, mas ainda não aparecia corretamente
   recortada na linha do tempo nem na view de detalhe da escala — agora aparece nas duas.

   > **Atualização (quarto pedido de ajustes, abaixo):** o campo "Escala 12x36 (repetir a cada
   > quantos dias)" e o campo **Semana** (par/ímpar) descritos aqui foram **substituídos** pela
   > grade de dias por profissional — ver "Quarto pedido de ajustes" a seguir. Este item fica como
   > registro histórico de como o problema foi resolvido na época; não reflete mais o cadastro
   > atual de escalas.

## Quarto pedido de ajustes (outubro)

Depois do ponto 7 acima, ficou claro que o problema real era mais amplo: uma escala só tinha UM
horário e UM padrão de recorrência para todos os profissionais vinculados a ela. Isso obrigava a
criar um registro de escala separado para cada profissional com um padrão diferente — mesmo
quando, na prática, todos cobrem o mesmo posto/projeto. O pedido veio com um modelo de referência
(planilha profissional × dia, com o código do horário em cada célula preenchida) que norteou o
redesenho:

- **A escala virou uma grade.** O cadastro de Escala agora tem: **Título**, **Projeto**,
  **Locais** (múltipla seleção, com busca e atalhos — como já era), **Data de início/término** e,
  por fim, a **grade de dias**: uma linha por profissional incluído na escala e uma coluna por
  data do período (rótulo "dd/mês" + dia da semana abreviado, igual ao modelo enviado). Em cada
  célula, um seletor com os horários cadastrados em **Horários** — célula em branco = aquele
  profissional não trabalha naquele dia. Isso permite, numa única escala, reunir profissionais com
  dias e horários completamente diferentes entre si (inclusive um 12x36 como o do ponto 7, só que
  agora marcado célula a célula em vez de por um campo de recorrência).
- **Não é mais preciso clicar célula por célula para um padrão como 12x36.** Cada linha de
  profissional tem um atalho **"Preencher"**: escolhe-se o horário e de quantos em quantos dias
  (1 = todo dia, 2 = tipo 12x36…) e as células correspondentes do período são marcadas de uma vez
  — o dado salvo continua sendo a grade explícita (célula a célula), só o preenchimento é mais
  rápido. "Limpar linha" e "Remover" também ajudam a ajustar depois.
- **O que mudou no banco:** a tabela `escalas` perdeu os campos de horário/recorrência únicos
  (`horario_id`, `dias_semana`, `paridade_semana`, `intervalo_dias`); uma nova tabela
  `escala_dias` guarda uma linha por (escala, profissional, data, horário) — é exatamente uma
  célula da grade. A migração que faz essa troca (`migrations/010_grade_escala.sql`) converte as
  escalas já existentes para o novo formato antes de remover os campos antigos, então nenhum
  histórico se perde.
- **Detecção de conflitos ficou mais simples.** Como cada célula já é uma ocorrência concreta
  (um profissional, uma data, um horário), não há mais recorrência para expandir — o motor de
  conflitos (regras 5 a 8) passa a comparar diretamente as células salvas entre si e contra folgas/
  treinamentos/feriados, com o mesmo comportamento de sempre (conflito bloqueia o salvamento,
  "salvar mesmo assim" confirma e audita).
- **Importação em massa (CSV)** também foi adaptada: a coluna **Horário** (nome de um horário
  cadastrado) substitui as antigas "Hora início/Hora fim/Virada de dia" — ver "Importação de
  escalas em massa (CSV)" acima para o formato atual. Cada linha do CSV continua gerando uma
  escala própria, com o mesmo horário e dias da semana aplicados a todos os profissionais daquela
  linha; para profissionais com padrões diferentes dentro do mesmo posto, use o cadastro manual
  (grade) ou uma linha de CSV por padrão.
- **Treinamentos e Folgas não mudaram** neste ponto — continuam com um horário/período único e
  recorrência por dia da semana, como antes; o pedido era especificamente sobre o cadastro de
  Escalas.

## Quinto pedido de ajustes (outubro)

Lote de ajustes pontuais pedido por menu, sem mudança de arquitetura. Veio em duas rodadas — a
segunda corrigiu alguns pontos que a primeira não atendeu como pedido (marcados abaixo).

- **Projetos — situação com cores próprias.** Concluído continua verde e Cancelado continua
  vermelho (já eram essas cores por padrão em todo o sistema); só em Projetos, **Ativo (azul)**,
  **Pausado (laranja)** e **Planejado (roxo)** usam uma cor diferente da usada nas outras telas
  — Profissionais, Horários, Escalas, Folgas e Treinamentos mantêm as cores padrão (incluindo o
  amarelo de "planejada/planejado") para esses mesmos valores. *(2ª rodada: a listagem e o detalhe
  de Projetos tinham um trecho de código comum a todos os cadastros que sempre redesenhava o selo
  de situação sem a cor própria desta tela — corrigido; 3ª rodada: Planejamento e Pausado ficavam
  parecidos de mais em amarelo/laranja — Planejado virou roxo.)*
- **Projetos — campo "Cliente" renomeado para "Solicitante".** Mesmo dado, nome mais adequado;
  a migração (`migrations/011_quinto_pedido.sql`) renomeia a coluna no banco preservando os
  valores já cadastrados.
- **Projetos — campo Classificação** (Melhoria ou Projeto).
- **Projetos — campo Matriculado** (sim/não), como campo de seleção (não como caixa de marcar).
  *(2ª rodada: tinha entrado como caixa de marcar — trocado para seleção.)*
- **Projetos — campo Tamanho do projeto** (Pequeno, Médio ou Grande).
- **Projetos — trimestre(s) do período.** Calculado automaticamente a partir de Data inicial/Data
  final (ex.: um projeto de novembro/2026 a janeiro/2027 mostra "4º/2026, 1º/2027"). Não fica
  gravado no banco — é recalculado a cada consulta, então muda sozinho se o período do projeto for
  editado depois.
- **Locais — campo Tipo** (Hospital, Clínica ou Pronto atendimento), usado para identificar o
  local. Ao vincular locais a um projeto ou a uma escala, ou ao escolher o local de um
  treinamento, o seletor ganhou um filtro por esse tipo, além da busca por nome que já existia.
- **Menu lateral — "Usuários" renomeado para "Logins/Acesso".**
- **Escalas — campo Locais com filtro por tipo do local**, igual ao usado em Projetos (ver item
  acima).
- **Escalas — condição de dia par/ímpar.** O atalho "Preencher" de cada linha da grade (ver
  "Quarto pedido de ajustes" acima) ganhou uma opção para marcar só os dias pares ou só os ímpares
  do período, com base na data em si (não na posição dentro do período) — facilita montar escalas
  12x36 e outros revezamentos que não começam sempre num dia par.
- **Escalas — pular finais de semana no preenchimento.** O mesmo atalho "Preencher" ganhou uma
  caixa "pular fim de semana", que deixa sábados e domingos em branco mesmo quando o intervalo ou
  a paridade marcada cairia neles.
- **Escalas — finais de semana destacados na tabela da grade.** *(2ª rodada: antes só o cabeçalho
  da coluna tinha uma cor quase imperceptível; agora a coluna inteira — cada célula do dia, no
  cadastro e no detalhe da escala — fica com um tom claramente diferente das demais.)*
- **Escalas — dica (tooltip) com o horário ao passar o mouse numa célula preenchida da grade.**
  Mostra o horário cadastrado (nome, início–término e aviso de virada de dia, quando houver).
  *(2ª rodada: na primeira passagem foi incluído por engano um campo "Tipo de escala" para
  selecionar manualmente — removido; o pedido era este tooltip ao passar o mouse, não um campo
  novo no formulário.)*
- **Treinamentos — campo Local com o mesmo filtro por tipo** usado em Projetos/Escalas.
- **Linha do tempo — período correto na dica (tooltip) da escala.** *(2ª rodada: a primeira
  tentativa agrupava dias consecutivos de uma mesma sequência antes de montar a dica, mas isso
  ainda mostrava só o trecho contínuo preenchido — não o período completo cadastrado na escala, que
  pode ser maior se houver dias sem preenchimento no meio. Agora a dica usa diretamente as datas
  "Data inicial"/"Data final" do registro da escala, que é o que foi pedido; a dica também passou a
  mostrar o nome e o horário cadastrado daquele trecho.)*

## Horas e pessoal por projeto (o "pensamento futuro")

Menu **Horas por projeto** (só administrador), no mesmo formato da planilha de planejamento de
horas: para cada projeto, **Treinamento + Op. assistida = Total de horas**, a quantidade de
profissionais envolvidos e, logo abaixo, o detalhe por profissional (função, treinamento, op.
assistida e total — "N/A" quando não houve). Tem filtro de período (em branco = tudo), projeto e
"planejadas e confirmadas" × "só confirmadas/concluídas", e botão **Exportar CSV** (uma linha por
projeto × profissional, horas no formato "4h4min" e em decimal).

Nada é digitado de novo — o cálculo sai do que já está cadastrado:

- **Op. assistida** = soma, por profissional, das horas previstas do horário de cada dia preenchido
  na grade das escalas do projeto (a hora prevista já desconta o intervalo do horário).
- **Treinamento** = nº de encontros dentro do período (respeitando os dias da semana do
  treinamento) × duração do encontro, contado para cada participante.
- Escalas/treinamentos cancelados ou recusados nunca entram; sem projeto vinculado, também não.
- **Total** do projeto = soma dos profissionais (como na planilha: 5 pessoas × 57h = 285h).

Premissa a conferir: a planilha mostra horas de "grupo de sustentação" que não vêm da grade; aqui só
entra o que está lançado em Escalas e Treinamentos. Se parte das horas da planilha não está sendo
lançada no sistema, o total aparecerá menor até que seja lançada.

## Troca de senha obrigatória no primeiro acesso
Qualquer usuário pode ser marcado para ser obrigado a trocar a própria senha antes de usar o
resto do sistema (campo **Exigir troca de senha no próximo acesso**, no cadastro de usuários).
Enquanto pendente, o servidor bloqueia qualquer rota fora de `/api/auth/*` — não é só uma tela
escondida no navegador. Útil para distribuir uma senha inicial compartilhada (ex.: numa
importação em massa de pessoas) sem que ela permaneça válida depois do primeiro uso.

## Cadastros são de uso exclusivo do administrador
Profissionais, Projetos, Locais, Horários, Feriados/recessos e Usuários não aparecem no menu nem
respondem na API para o perfil Usuário (somente leitura) — nem para listar, nem para ver detalhe.
Esse perfil continua vendo normalmente o Painel, a Linha do tempo e as listagens de Escalas,
Folgas e Treinamentos (onde profissionais/projetos/locais aparecem só como informação, não como
cadastros navegáveis).

## Importação dos dados reais da organização
Para substituir os dados de teste pelos dados reais de profissionais, usuários, locais e horários
a partir de uma planilha, veja `scripts/importar-dados-gerais.ts` — um script de uso único que
apaga tudo e recadastra a partir de uma lista de dados conferida manualmente (não lê o .xlsx em
tempo de execução; os dados já vêm conferidos e embutidos no próprio script). Rode primeiro sem
`--confirmar` para ver o que ele faria, e só então com `--confirmar` para aplicar de verdade:
```bash
node --disable-warning=ExperimentalWarning scripts/importar-dados-gerais.ts
node --disable-warning=ExperimentalWarning scripts/importar-dados-gerais.ts --confirmar
```

## Carga de feriados nacionais, estaduais e municipais
`scripts/importar-feriados.ts` cadastra os feriados nacionais (incluindo os móveis — Carnaval,
Sexta-feira Santa e Corpus Christi, calculados a partir da Páscoa, válidos para qualquer ano),
a "data magna" de cada estado e o feriado municipal de cada cidade onde há profissional
cadastrado. É aditivo e idempotente — pode rodar de novo (inclusive em anos futuros) sem
duplicar nada:
```bash
node --disable-warning=ExperimentalWarning scripts/importar-feriados.ts
node --disable-warning=ExperimentalWarning scripts/importar-feriados.ts 2028 2029
```
Os estados/cidades cobertos acompanham a planilha de dados gerais já importada; para adicionar
uma localidade nova, edite as listas `ESTADUAIS`/`MUNICIPAIS` no topo do próprio script.

## Limitações conhecidas / possíveis próximos passos

- A suíte de testes cobre o backend por completo (77 testes) e o frontend foi verificado por
  revisão de código, checagem de sintaxe de cada módulo e testes manuais do fluxo via API (login,
  timeline, dashboard, seed) — mas não há neste ambiente um navegador ou motor headless (Chromium/
  Playwright) disponível para testes automatizados de interface. Antes de um uso mais amplo, vale
  testar a interface manualmente em um navegador.
- Não há envio de e-mail/notificações (fora do escopo original).
- A busca textual da linha do tempo e das listagens usa `LIKE` simples (sem acentuação), suficiente
  para o volume de dados esperado, mas não é uma busca "fuzzy".


## Sexto pedido de ajustes (outubro)

- **Projetos:** a situação "Planejamento" agora se chama **Planejado** (só o texto; os dados não mudam).
- **Treinamentos por participante:** o treinamento tem uma **duração por encontro** (ex.: 1h) e, para cada
  participante, seus próprios **dias da semana** e **horários de início**. Exemplo "Fratura fechada",
  09 a 13/11, 1h: Alan — sexta 09:00 e 14:00; Ivan — seg a sex 20:00; Adriana — seg a qui 09:00 e 14:00.
  Conflitos de agenda e a linha do tempo passam a considerar cada horário individualmente.
- **Horas por projeto** soma, para cada participante, encontros no período × duração (Alan 2h, Ivan 5h,
  Adriana 8h no exemplo acima).
- Treinamentos já cadastrados são convertidos automaticamente. Após extrair o zip, rode `npm run migrate`.

## Sétimo pedido de ajustes (novembro)

- **Novo visual profissional:** menu lateral escuro com ícones, avatar do usuário, cartões com sombra suave,
  tabelas mais limpas, selos de situação com ponto colorido, formulários com foco destacado, login renovado e
  linha do tempo (Gantt) com avatar por profissional, barras arredondadas com degradê e coluna de "hoje" em destaque.
  Só aparência: nenhum dado ou regra mudou.
