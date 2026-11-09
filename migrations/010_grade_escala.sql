-- Quarto pedido de ajustes (outubro): redesenho do cadastro de escala. Antes, UMA escala tinha um
-- único horario_id/hora_inicio/hora_fim/vira_dia/dias_semana/paridade_semana/intervalo_dias que valia
-- igualmente para TODOS os profissionais vinculados — não havia como dois profissionais da mesma
-- escala trabalharem em dias ou horários diferentes (o contorno era criar um registro de escala por
-- profissional/padrão). Agora `escalas` guarda só os dados comuns (título, projeto, locais, período,
-- situação) e cada combinação (profissional, dia, horário) vira uma linha em `escala_dias` — a
-- "célula" da grade pedida pelo usuário. Ausência de linha = o profissional não trabalha naquele dia
-- nesta escala, o que permite qualquer diversidade de profissionais/horários dentro de uma só escala.

CREATE TABLE escala_dias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  escala_id INTEGER NOT NULL REFERENCES escalas (id) ON DELETE CASCADE,
  profissional_id INTEGER NOT NULL REFERENCES profissionais (id),
  data TEXT NOT NULL,
  horario_id INTEGER NOT NULL REFERENCES horarios (id),
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  criado_por INTEGER REFERENCES usuarios (id),
  atualizado_por INTEGER REFERENCES usuarios (id),
  UNIQUE (escala_id, profissional_id, data)
);
CREATE INDEX idx_escala_dias_escala ON escala_dias (escala_id);
CREATE INDEX idx_escala_dias_prof ON escala_dias (profissional_id, data);

-- ---------------------------------------------------------------------------------------------
-- Migração dos dados já existentes (regra do projeto: não apagar dado de negócio já gravado).
-- Cada escala antiga é expandida em ocorrências concretas, usando a mesma lógica de recorrência que
-- o motor de conflitos aplicava (dias_semana + paridade_semana + intervalo_dias, a partir da própria
-- data_inicial do registro), e vinculada a todos os profissionais que já estavam em escala_profissionais.
-- ---------------------------------------------------------------------------------------------

-- 1) Toda escala antiga tinha hora_inicio/hora_fim/vira_dia preenchidos, mas horario_id (o "modelo")
--    era opcional — muitas podem não ter um horário cadastrado por trás. Para a nova tabela exigir
--    horario_id (cada célula da grade escolhe um horário do cadastro), cria-se aqui um horário
--    "Legado ..." para cada combinação hora_inicio/hora_fim/vira_dia ainda sem correspondente.
INSERT INTO horarios (nome, hora_inicio, hora_fim, intervalo_minutos, horas_previstas, vira_dia, status, observacoes, criado_em, atualizado_em)
SELECT DISTINCT
  'Legado ' || e.hora_inicio || '–' || e.hora_fim,
  e.hora_inicio, e.hora_fim, 0,
  CASE WHEN e.vira_dia = 1
    THEN (1440 - (CAST(substr(e.hora_inicio, 1, 2) AS INTEGER) * 60 + CAST(substr(e.hora_inicio, 4, 2) AS INTEGER))
               + (CAST(substr(e.hora_fim, 1, 2) AS INTEGER) * 60 + CAST(substr(e.hora_fim, 4, 2) AS INTEGER))) / 60.0
    ELSE ((CAST(substr(e.hora_fim, 1, 2) AS INTEGER) * 60 + CAST(substr(e.hora_fim, 4, 2) AS INTEGER))
               - (CAST(substr(e.hora_inicio, 1, 2) AS INTEGER) * 60 + CAST(substr(e.hora_inicio, 4, 2) AS INTEGER))) / 60.0
  END,
  e.vira_dia, 'ativo', 'Criado automaticamente na migração 010, a partir de escalas sem modelo de horário cadastrado.',
  datetime('now'), datetime('now')
FROM escalas e
WHERE e.horario_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM horarios h WHERE h.hora_inicio = e.hora_inicio AND h.hora_fim = e.hora_fim AND h.vira_dia = e.vira_dia
  );

-- 2) Gera, para cada escala, todas as datas do período (limitado pelo próprio max. de 366 dias já
--    imposto pela aplicação) e marca quais "passam" na recorrência antiga.
WITH RECURSIVE datas(escala_id, d) AS (
  SELECT id, data_inicial FROM escalas
  UNION ALL
  SELECT escalas.id, date(datas.d, '+1 day')
    FROM datas JOIN escalas ON escalas.id = datas.escala_id
   WHERE datas.d < escalas.data_final
),
datas_calc AS (
  SELECT
    dt.escala_id, dt.d,
    CAST(strftime('%w', dt.d) AS INTEGER) AS dow,
    -- Semana ISO da data (algoritmo da quinta-feira "dona" da semana), para a recorrência par/ímpar.
    -- 0 = semana ISO par, 1 = semana ISO ímpar (mesma convenção de semanaIsoDoIndice() % 2 em datetime.ts).
    (
      (CAST(strftime('%j', date(dt.d, printf('%+d day', 4 - (((CAST(strftime('%w', dt.d) AS INTEGER) + 6) % 7) + 1)))) AS INTEGER) - 1) / 7 + 1
    ) % 2 AS semana_impar
  FROM datas dt
),
candidatas AS (
  SELECT
    e.id AS escala_id, dc.d AS data,
    COALESCE(e.horario_id, lh.id) AS horario_resolvido
  FROM escalas e
  JOIN datas_calc dc ON dc.escala_id = e.id
  LEFT JOIN horarios lh ON e.horario_id IS NULL AND lh.hora_inicio = e.hora_inicio AND lh.hora_fim = e.hora_fim AND lh.vira_dia = e.vira_dia
  WHERE (e.dias_semana IS NULL OR instr(',' || e.dias_semana || ',', ',' || dc.dow || ',') > 0)
    AND (e.paridade_semana = 'todas'
         OR (e.paridade_semana = 'par' AND dc.semana_impar = 0)
         OR (e.paridade_semana = 'impar' AND dc.semana_impar = 1))
    AND (e.intervalo_dias IS NULL OR (CAST(julianday(dc.d) - julianday(e.data_inicial) AS INTEGER) % e.intervalo_dias) = 0)
)
INSERT INTO escala_dias (escala_id, profissional_id, data, horario_id, criado_em, atualizado_em, criado_por, atualizado_por)
SELECT c.escala_id, ep.profissional_id, c.data, c.horario_resolvido, e.criado_em, e.atualizado_em, e.criado_por, e.atualizado_por
FROM candidatas c
JOIN escalas e ON e.id = c.escala_id
JOIN escala_profissionais ep ON ep.escala_id = c.escala_id
WHERE c.horario_resolvido IS NOT NULL;

-- 3) Colunas e tabela que deixam de existir: a recorrência e o horário únicos por escala não fazem
--    mais sentido no novo modelo (cada célula da grade já é uma ocorrência concreta, com seu próprio
--    horário). Os dados foram preservados acima, em escala_dias, antes deste passo.
DROP TABLE escala_profissionais;
ALTER TABLE escalas DROP COLUMN horario_id;
ALTER TABLE escalas DROP COLUMN hora_inicio;
ALTER TABLE escalas DROP COLUMN hora_fim;
ALTER TABLE escalas DROP COLUMN vira_dia;
ALTER TABLE escalas DROP COLUMN dias_semana;
ALTER TABLE escalas DROP COLUMN paridade_semana;
ALTER TABLE escalas DROP COLUMN intervalo_dias;
