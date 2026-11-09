-- Feriados/períodos por região. NULL = nacional (vale para todos os estados);
-- preenchido = vale apenas para profissionais/locais daquele estado (UF).
ALTER TABLE periodos ADD COLUMN uf TEXT;
