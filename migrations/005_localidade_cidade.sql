-- Granularidade municipal para feriados/recessos, complementando o estado (UF):
-- período nacional (uf e cidade nulos), estadual (só uf) ou municipal (uf e cidade).
-- O profissional passa a poder informar sua cidade, além do estado, para essa comparação.
ALTER TABLE periodos ADD COLUMN cidade TEXT;
ALTER TABLE profissionais ADD COLUMN cidade TEXT;
