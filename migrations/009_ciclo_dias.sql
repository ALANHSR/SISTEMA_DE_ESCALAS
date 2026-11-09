-- Ponto 7 (segunda explicação): escalas 12x36/24x48 — o profissional trabalha a cada N dias,
-- contando a partir da própria data inicial do registro, independente do dia da semana (que muda
-- a cada ocorrência nesse tipo de plantão). NULL = todo dia do período, como antes.
ALTER TABLE escalas ADD COLUMN intervalo_dias INTEGER CHECK (intervalo_dias IS NULL OR intervalo_dias >= 2);
