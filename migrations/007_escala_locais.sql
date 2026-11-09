-- Item 1 (ajuste do usuário): permite selecionar mais de um local por escala.
-- Segue o mesmo padrão de tabela de vínculo já usado em projeto_locais/escala_profissionais.
CREATE TABLE escala_locais (
  escala_id INTEGER NOT NULL REFERENCES escalas (id) ON DELETE CASCADE,
  local_id INTEGER NOT NULL REFERENCES locais (id),
  PRIMARY KEY (escala_id, local_id)
);
CREATE INDEX idx_escala_locais_local ON escala_locais (local_id);

-- Migra o local único já cadastrado em escalas.local_id para a nova tabela de vínculo,
-- sem perder dados existentes. A coluna escalas.local_id deixa de ser usada pela aplicação
-- a partir desta versão (fica apenas como histórico; não é mais lida nem escrita).
INSERT INTO escala_locais (escala_id, local_id)
SELECT id, local_id FROM escalas WHERE local_id IS NOT NULL;
