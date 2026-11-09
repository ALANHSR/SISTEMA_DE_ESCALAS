-- Permite marcar um usuário para ser obrigado a trocar a própria senha no próximo acesso
-- (ex.: senha inicial compartilhada distribuída em uma importação em massa).
ALTER TABLE usuarios ADD COLUMN deve_trocar_senha INTEGER NOT NULL DEFAULT 0 CHECK (deve_trocar_senha IN (0, 1));
