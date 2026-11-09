-- Quinto pedido de ajustes (outubro).
--
-- Projetos: renomeia "cliente" para "solicitante" (mesmo dado, nome mais correto); acrescenta
-- classificação (melhoria/projeto), matriculado (sim/não) e tamanho (pequeno/médio/grande). O
-- trimestre não é guardado aqui — é calculado a partir de data_inicial/data_final a cada consulta
-- (ver src/server/routes/cadastros.ts), então não precisa de coluna nem de recálculo quando as
-- datas do projeto mudam.
ALTER TABLE projetos RENAME COLUMN cliente TO solicitante;
ALTER TABLE projetos ADD COLUMN classificacao TEXT CHECK (classificacao IS NULL OR classificacao IN ('melhoria', 'projeto'));
ALTER TABLE projetos ADD COLUMN matriculado INTEGER NOT NULL DEFAULT 0 CHECK (matriculado IN (0, 1));
ALTER TABLE projetos ADD COLUMN tamanho TEXT CHECK (tamanho IS NULL OR tamanho IN ('pequeno', 'medio', 'grande'));

-- Local: tipo do estabelecimento, usado para filtrar/identificar o local ao vincular a um projeto.
ALTER TABLE locais ADD COLUMN tipo TEXT CHECK (tipo IS NULL OR tipo IN ('hospital', 'clinica', 'pronto_atendimento'));
