-- Permite vincular um treinamento a um projeto (opcional — nem todo treinamento é de um projeto específico).
ALTER TABLE treinamentos ADD COLUMN projeto_id INTEGER REFERENCES projetos (id);
CREATE INDEX idx_treinamentos_projeto ON treinamentos (projeto_id);
