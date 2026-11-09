-- Recorrência por dia da semana (regra adicional, a pedido do usuário).
-- NULL = sem restrição (todos os dias do período, comportamento anterior, preservado para os
-- registros já existentes). Quando preenchida, é uma lista de dígitos 0-6 separados por vírgula,
-- ordenada, onde 0=domingo, 1=segunda, ..., 6=sábado (mesma convenção de Date.getDay()).
ALTER TABLE escalas ADD COLUMN dias_semana TEXT;
ALTER TABLE folgas ADD COLUMN dias_semana TEXT;
ALTER TABLE treinamentos ADD COLUMN dias_semana TEXT;
