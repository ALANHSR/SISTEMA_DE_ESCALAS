import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export interface Config {
  porta: number;
  host: string;
  caminhoBanco: string;
  producao: boolean;
  segredoSessao: string;
  sessaoTtlHoras: number;
  cookieSeguro: boolean;
  loginMaxTentativas: number;
  loginJanelaMinutos: number;
  diretorioPublico: string;
}

function inteiro(valor: string | undefined, padrao: number): number {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : padrao;
}

export function carregarConfig(sobrescritas: Partial<Config> = {}): Config {
  try {
    process.loadEnvFile();
  } catch {
    // Sem arquivo .env: usa apenas as variáveis do ambiente.
  }
  const env = process.env;
  const producao = env.NODE_ENV === 'production';

  let segredo = env.SESSION_SECRET ?? '';
  if (segredo.length < 32) {
    if (producao && !sobrescritas.segredoSessao) {
      throw new Error('SESSION_SECRET ausente ou curto (mínimo de 32 caracteres) em produção.');
    }
    segredo = randomBytes(32).toString('hex');
    if (!sobrescritas.segredoSessao) {
      console.warn('[config] SESSION_SECRET não definido: usando um segredo temporário desta execução.');
    }
  }

  return {
    porta: inteiro(env.PORT, 3000),
    host: env.HOST ?? '127.0.0.1',
    caminhoBanco: env.DATABASE_PATH ?? './data/escalas.db',
    producao,
    segredoSessao: segredo,
    sessaoTtlHoras: inteiro(env.SESSION_TTL_HORAS, 12),
    cookieSeguro: env.COOKIE_SECURE === 'true' || producao,
    loginMaxTentativas: inteiro(env.LOGIN_MAX_TENTATIVAS, 5),
    loginJanelaMinutos: inteiro(env.LOGIN_JANELA_MINUTOS, 15),
    diretorioPublico: fileURLToPath(new URL('../../public', import.meta.url)),
    ...sobrescritas,
  };
}
