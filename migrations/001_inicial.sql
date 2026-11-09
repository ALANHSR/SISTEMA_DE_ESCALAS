-- Esquema inicial. Datas: 'AAAA-MM-DD'. Horários: 'HH:MM' (relógio local America/Sao_Paulo).
-- Carimbos de auditoria (criado_em/atualizado_em): ISO 8601 em UTC.

CREATE TABLE configuracoes (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);

CREATE TABLE usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  senha_hash TEXT NOT NULL,
  perfil TEXT NOT NULL CHECK (perfil IN ('administrador', 'usuario')),
  status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'inativo')),
  ultimo_acesso TEXT,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  criado_por INTEGER REFERENCES usuarios (id),
  atualizado_por INTEGER REFERENCES usuarios (id)
);

-- O token da sessão nunca é guardado em claro: apenas o hash SHA-256.
CREATE TABLE sessoes (
  token_hash TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  criado_em TEXT NOT NULL,
  expira_em TEXT NOT NULL
);
CREATE INDEX idx_sessoes_expira ON sessoes (expira_em);

CREATE TABLE profissionais (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome_completo TEXT NOT NULL,
  telefone TEXT,
  uf TEXT NOT NULL,
  email TEXT,
  cargo TEXT,
  status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'inativo')),
  observacoes TEXT,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  criado_por INTEGER REFERENCES usuarios (id),
  atualizado_por INTEGER REFERENCES usuarios (id)
);
CREATE INDEX idx_profissionais_nome ON profissionais (nome_completo);

CREATE TABLE locais (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  endereco TEXT,
  cidade TEXT,
  uf TEXT,
  complemento TEXT,
  responsavel TEXT,
  telefone_contato TEXT,
  status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'inativo')),
  observacoes TEXT,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  criado_por INTEGER REFERENCES usuarios (id),
  atualizado_por INTEGER REFERENCES usuarios (id)
);

CREATE TABLE projetos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  codigo TEXT NOT NULL UNIQUE COLLATE NOCASE,
  descricao TEXT,
  cliente TEXT,
  data_inicial TEXT,
  data_final TEXT,
  status TEXT NOT NULL DEFAULT 'planejamento'
    CHECK (status IN ('planejamento', 'ativo', 'pausado', 'concluido', 'cancelado')),
  -- Projeto remoto ou sem local definido: permite confirmar escalas sem local (regra 4).
  remoto INTEGER NOT NULL DEFAULT 0 CHECK (remoto IN (0, 1)),
  observacoes TEXT,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  criado_por INTEGER REFERENCES usuarios (id),
  atualizado_por INTEGER REFERENCES usuarios (id),
  CHECK (data_inicial IS NULL OR data_final IS NULL OR data_final >= data_inicial)
);

CREATE TABLE projeto_locais (
  projeto_id INTEGER NOT NULL REFERENCES projetos (id) ON DELETE CASCADE,
  local_id INTEGER NOT NULL REFERENCES locais (id),
  PRIMARY KEY (projeto_id, local_id)
);

CREATE TABLE horarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  hora_inicio TEXT NOT NULL,
  hora_fim TEXT NOT NULL,
  intervalo_minutos INTEGER NOT NULL DEFAULT 0 CHECK (intervalo_minutos >= 0),
  horas_previstas REAL NOT NULL,
  vira_dia INTEGER NOT NULL DEFAULT 0 CHECK (vira_dia IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'inativo')),
  observacoes TEXT,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  criado_por INTEGER REFERENCES usuarios (id),
  atualizado_por INTEGER REFERENCES usuarios (id)
);

CREATE TABLE escalas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  titulo TEXT NOT NULL,
  projeto_id INTEGER REFERENCES projetos (id),
  local_id INTEGER REFERENCES locais (id),
  horario_id INTEGER REFERENCES horarios (id),
  data_inicial TEXT NOT NULL,
  data_final TEXT NOT NULL,
  hora_inicio TEXT NOT NULL,
  hora_fim TEXT NOT NULL,
  vira_dia INTEGER NOT NULL DEFAULT 0 CHECK (vira_dia IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'planejada'
    CHECK (status IN ('planejada', 'confirmada', 'em_andamento', 'concluida', 'cancelada')),
  descricao TEXT,
  observacoes TEXT,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  criado_por INTEGER REFERENCES usuarios (id),
  atualizado_por INTEGER REFERENCES usuarios (id),
  CHECK (data_final >= data_inicial)
);
CREATE INDEX idx_escalas_periodo ON escalas (data_inicial, data_final);
CREATE INDEX idx_escalas_projeto ON escalas (projeto_id);

CREATE TABLE escala_profissionais (
  escala_id INTEGER NOT NULL REFERENCES escalas (id) ON DELETE CASCADE,
  profissional_id INTEGER NOT NULL REFERENCES profissionais (id),
  PRIMARY KEY (escala_id, profissional_id)
);
CREATE INDEX idx_escala_prof_prof ON escala_profissionais (profissional_id);

CREATE TABLE folgas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profissional_id INTEGER NOT NULL REFERENCES profissionais (id),
  data_inicial TEXT NOT NULL,
  data_final TEXT NOT NULL,
  tipo TEXT NOT NULL
    CHECK (tipo IN ('folga_compensatoria', 'folga_semanal', 'ferias', 'licenca', 'banco_de_horas', 'outro')),
  status TEXT NOT NULL DEFAULT 'solicitada'
    CHECK (status IN ('solicitada', 'aprovada', 'recusada', 'cancelada')),
  motivo TEXT,
  aprovado_por INTEGER REFERENCES usuarios (id),
  aprovado_em TEXT,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  criado_por INTEGER REFERENCES usuarios (id),
  atualizado_por INTEGER REFERENCES usuarios (id),
  CHECK (data_final >= data_inicial)
);
CREATE INDEX idx_folgas_prof ON folgas (profissional_id, data_inicial);

-- Calendário operacional (feriados, recessos, períodos críticos). Aparece como faixa na linha do tempo.
CREATE TABLE periodos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  data_inicial TEXT NOT NULL,
  data_final TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('feriado', 'recesso', 'operacional', 'outro')),
  status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'inativo')),
  observacoes TEXT,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  criado_por INTEGER REFERENCES usuarios (id),
  atualizado_por INTEGER REFERENCES usuarios (id),
  CHECK (data_final >= data_inicial)
);

CREATE TABLE treinamentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  descricao TEXT,
  instrutor TEXT,
  local_id INTEGER REFERENCES locais (id),
  remoto INTEGER NOT NULL DEFAULT 0 CHECK (remoto IN (0, 1)),
  data_inicial TEXT NOT NULL,
  data_final TEXT NOT NULL,
  hora_inicio TEXT NOT NULL,
  hora_fim TEXT NOT NULL,
  vira_dia INTEGER NOT NULL DEFAULT 0 CHECK (vira_dia IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'planejado'
    CHECK (status IN ('planejado', 'confirmado', 'concluido', 'cancelado')),
  observacoes TEXT,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  criado_por INTEGER REFERENCES usuarios (id),
  atualizado_por INTEGER REFERENCES usuarios (id),
  CHECK (data_final >= data_inicial)
);
CREATE INDEX idx_treinamentos_periodo ON treinamentos (data_inicial, data_final);

CREATE TABLE treinamento_profissionais (
  treinamento_id INTEGER NOT NULL REFERENCES treinamentos (id) ON DELETE CASCADE,
  profissional_id INTEGER NOT NULL REFERENCES profissionais (id),
  PRIMARY KEY (treinamento_id, profissional_id)
);
CREATE INDEX idx_trein_prof_prof ON treinamento_profissionais (profissional_id);

-- Histórico básico de criação e alteração.
CREATE TABLE auditoria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entidade TEXT NOT NULL,
  registro_id INTEGER,
  acao TEXT NOT NULL,
  usuario_id INTEGER REFERENCES usuarios (id),
  usuario_nome TEXT,
  detalhes TEXT,
  criado_em TEXT NOT NULL
);
CREATE INDEX idx_auditoria_registro ON auditoria (entidade, registro_id);
