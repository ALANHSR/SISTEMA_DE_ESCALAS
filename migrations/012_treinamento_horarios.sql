-- Treinamentos com horário próprio por profissional (sexto pedido de ajustes).
--
-- Antes: um horário (início–término) e uma recorrência de dias da semana valendo para TODOS os
-- participantes. Agora: o treinamento tem uma duração por encontro (ex.: 1h) e cada participante tem
-- os seus próprios dias da semana e horários de início (ex.: Alan, sexta às 9h e às 14h; Ivan, de
-- segunda a sexta às 20h). As horas de cada pessoa = encontros no período × duração (menu "Horas por
-- projeto"). As colunas antigas (hora_inicio, hora_fim, vira_dia, dias_semana) continuam existindo
-- só como resumo do registro (o sistema as preenche); quem manda é treinamento_horarios.
ALTER TABLE treinamentos ADD COLUMN duracao_minutos INTEGER NOT NULL DEFAULT 60;

UPDATE treinamentos SET duracao_minutos = MAX(1,
  (CAST(substr(hora_fim, 1, 2) AS INTEGER) * 60 + CAST(substr(hora_fim, 4, 2) AS INTEGER))
  - (CAST(substr(hora_inicio, 1, 2) AS INTEGER) * 60 + CAST(substr(hora_inicio, 4, 2) AS INTEGER))
  + CASE WHEN vira_dia = 1 THEN 1440 ELSE 0 END);

CREATE TABLE treinamento_horarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  treinamento_id INTEGER NOT NULL REFERENCES treinamentos (id) ON DELETE CASCADE,
  profissional_id INTEGER NOT NULL REFERENCES profissionais (id),
  dias_semana TEXT, -- "1,2,3,4,5" (0=domingo..6=sábado); null = todos os dias do período
  hora_inicio TEXT NOT NULL
);
CREATE INDEX idx_treinamento_horarios_trein ON treinamento_horarios (treinamento_id);
CREATE INDEX idx_treinamento_horarios_prof ON treinamento_horarios (profissional_id);

-- Treinamentos já cadastrados: cada participante herda o horário e os dias do registro.
INSERT INTO treinamento_horarios (treinamento_id, profissional_id, dias_semana, hora_inicio)
SELECT t.id, tp.profissional_id, t.dias_semana, t.hora_inicio
  FROM treinamentos t JOIN treinamento_profissionais tp ON tp.treinamento_id = t.id;
