-- Ponto 7 do segundo pedido de ajustes: alternância de escala par/ímpar por semana (ex.: horário "MT"
-- com revezamento semanal). 'todas' (padrão) mantém o comportamento atual de qualquer escala existente.
ALTER TABLE escalas ADD COLUMN paridade_semana TEXT NOT NULL DEFAULT 'todas'
  CHECK (paridade_semana IN ('todas', 'par', 'impar'));
