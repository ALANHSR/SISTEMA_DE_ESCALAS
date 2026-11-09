// Carga de feriados nacionais, estaduais (data magna) e municipais, cobrindo os estados e
// cidades dos profissionais cadastrados pela importação de dados gerais.
//
// USO (a partir da pasta "escalas", quantas vezes quiser — é aditivo e seguro rodar de novo):
//   node --disable-warning=ExperimentalWarning scripts/importar-feriados.ts
//   node --disable-warning=ExperimentalWarning scripts/importar-feriados.ts 2027 2028   (outros anos)
//
// Não apaga nada: só adiciona os feriados que ainda não existem (mesmo nome + mesma data), então
// pode rodar de novo com segurança, inclusive em anos futuros.
//
// Fontes: portaria de feriados nacionais do Ministério da Gestão (2026), leis estaduais de cada
// "data magna" (Lei federal 9.093/95) e leis/decretos municipais de cada cidade — conferidas uma a
// uma em outubro de 2026. Datas móveis (Carnaval, Sexta-feira Santa, Corpus Christi) são calculadas
// a partir da Páscoa (algoritmo de Gauss), portanto valem para qualquer ano informado.
import { carregarConfig } from '../src/server/config.ts';
import { abrirBanco, obter } from '../src/server/db.ts';
import { migrar } from '../src/server/migrate.ts';
import { salvar, type Definicao } from '../src/server/recursos.ts';
import { periodos } from '../src/server/routes/cadastros.ts';
import type { Ctx } from '../src/server/http.ts';
import type { UsuarioSessao } from '../src/server/auth.ts';
import { diasParaData, dataParaDias } from '../src/shared/datetime.ts';

/** Domingo de Páscoa de um ano (algoritmo de Gauss, calendário gregoriano). Retorna 'AAAA-MM-DD'. */
function pascoa(ano: number): string {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}
const maisDias = (iso: string, n: number): string => diasParaData(dataParaDias(iso) + n);

interface Feriado { nome: string; mesDia?: [number, number]; movel?: (pascoaIso: string) => string; uf?: string; cidade?: string }

const NACIONAIS: Feriado[] = [
  { nome: 'Confraternização Universal', mesDia: [1, 1] },
  { nome: 'Carnaval', movel: (p) => maisDias(p, -48) },
  { nome: 'Carnaval', movel: (p) => maisDias(p, -47) },
  { nome: 'Sexta-feira Santa (Paixão de Cristo)', movel: (p) => maisDias(p, -2) },
  { nome: 'Tiradentes', mesDia: [4, 21] },
  { nome: 'Dia do Trabalho', mesDia: [5, 1] },
  { nome: 'Corpus Christi', movel: (p) => maisDias(p, 60) },
  { nome: 'Independência do Brasil', mesDia: [9, 7] },
  { nome: 'Nossa Senhora Aparecida', mesDia: [10, 12] },
  { nome: 'Finados', mesDia: [11, 2] },
  { nome: 'Proclamação da República', mesDia: [11, 15] },
  { nome: 'Dia Nacional de Zumbi e da Consciência Negra', mesDia: [11, 20] },
  { nome: 'Natal', mesDia: [12, 25] },
];

// Data magna de cada estado (Lei federal nº 9.093/95 — um único feriado civil por estado).
// Goiás e Paraná não têm data magna instituída; Minas Gerais coincide com Tiradentes (já nacional).
const ESTADUAIS: Feriado[] = [
  { nome: 'Revolução Constitucionalista de 1932 (Data Magna de SP)', mesDia: [7, 9], uf: 'SP' },
  { nome: 'Dia de São Jorge (Data Magna do RJ)', mesDia: [4, 23], uf: 'RJ' },
  { nome: 'Revolução Farroupilha — Dia do Gaúcho (Data Magna do RS)', mesDia: [9, 20], uf: 'RS' },
  { nome: 'Independência da Bahia (Data Magna da BA)', mesDia: [7, 2], uf: 'BA' },
  { nome: 'Revolução Pernambucana de 1817 (Data Magna de PE)', mesDia: [3, 6], uf: 'PE' },
  { nome: 'Abolição da Escravidão no Ceará (Data Magna do CE)', mesDia: [3, 25], uf: 'CE' },
  { nome: 'Adesão do Maranhão à Independência (Data Magna do MA)', mesDia: [7, 28], uf: 'MA' },
  { nome: 'Elevação do Amazonas à Categoria de Província (Data Magna do AM)', mesDia: [9, 5], uf: 'AM' },
  { nome: 'Emancipação Política de Sergipe (Data Magna de SE)', mesDia: [7, 8], uf: 'SE' },
  { nome: 'Emancipação Política de Alagoas (Data Magna de AL)', mesDia: [9, 16], uf: 'AL' },
  { nome: 'Fundação do Estado da Paraíba (Data Magna da PB)', mesDia: [8, 5], uf: 'PB' },
  { nome: 'Mártires de Uruaçu e Cunhaú (Data Magna do RN)', mesDia: [10, 3], uf: 'RN' },
];

// Feriados municipais das cidades onde há profissionais cadastrados (padroeiro/a ou aniversário
// da cidade, conforme lei municipal de cada uma).
const MUNICIPAIS: Feriado[] = [
  { nome: 'Data Magna de Fortaleza', mesDia: [4, 13], uf: 'CE', cidade: 'Fortaleza' },
  { nome: 'Nossa Senhora da Luz dos Pinhais (padroeira de Curitiba)', mesDia: [9, 8], uf: 'PR', cidade: 'Curitiba' },
  { nome: 'Nossa Senhora do Carmo (padroeira de Recife)', mesDia: [7, 16], uf: 'PE', cidade: 'Recife' },
  { nome: 'Aniversário de São Luís / Natividade de Nossa Senhora', mesDia: [9, 8], uf: 'MA', cidade: 'São Luís' },
  { nome: 'Nossa Senhora da Conceição (padroeira de Salvador)', mesDia: [12, 8], uf: 'BA', cidade: 'Salvador' },
  { nome: 'Emancipação de Camaçari', mesDia: [9, 28], uf: 'BA', cidade: 'Camaçari' },
  { nome: 'Nossa Senhora da Conceição (padroeira de Aracaju)', mesDia: [12, 8], uf: 'SE', cidade: 'Aracaju' },
  { nome: 'Nossa Senhora da Conceição (padroeira de Belo Horizonte)', mesDia: [12, 8], uf: 'MG', cidade: 'Belo Horizonte' },
  { nome: 'Dia de São Sebastião (padroeiro do Rio de Janeiro)', mesDia: [1, 20], uf: 'RJ', cidade: 'Rio de Janeiro' },
  { nome: 'Aniversário de Duque de Caxias', mesDia: [12, 31], uf: 'RJ', cidade: 'Duque de Caxias' },
  { nome: 'Aniversário de Niterói', mesDia: [11, 22], uf: 'RJ', cidade: 'Niterói' },
  { nome: 'Nossa Senhora dos Navegantes (Porto Alegre)', mesDia: [2, 2], uf: 'RS', cidade: 'Porto Alegre' },
  { nome: 'Aniversário de Manaus', mesDia: [10, 24], uf: 'AM', cidade: 'Manaus' },
  { nome: 'Nossa Senhora da Conceição (padroeira de Maceió)', mesDia: [12, 8], uf: 'AL', cidade: 'Maceió' },
  { nome: 'Abolição da Escravatura em Mossoró', mesDia: [9, 30], uf: 'RN', cidade: 'Mossoró' },
  { nome: 'Aniversário de São Paulo', mesDia: [1, 25], uf: 'SP', cidade: 'São Paulo' },
  { nome: 'Aniversário de Goiânia', mesDia: [10, 24], uf: 'GO', cidade: 'Goiânia' },
  // João Pessoa/PB: a fundação da cidade é a mesma data da Data Magna estadual da Paraíba (05/08),
  // já incluída acima — por isso não há um registro municipal adicional para ela aqui.
];

function dataDoAno(f: Feriado, ano: number, pascoaIso: string): string {
  if (f.movel) return f.movel(pascoaIso);
  const [mes, dia] = f.mesDia!;
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

async function principal(): Promise<void> {
  const anos = process.argv.slice(2).map(Number).filter((n) => Number.isInteger(n) && n > 2000);
  const anoAtual = new Date().getFullYear();
  const anosAlvo = anos.length ? anos : [anoAtual, anoAtual + 1];

  const config = carregarConfig();
  const db = abrirBanco(config.caminhoBanco);
  migrar(db);

  const admin = obter(db, "SELECT id, nome, email, perfil FROM usuarios WHERE perfil = 'administrador' AND status = 'ativo' ORDER BY id LIMIT 1");
  if (!admin) {
    console.error('Nenhum administrador ativo encontrado. Crie um usuário administrador antes de rodar este script.');
    process.exit(1);
  }
  const usuario: UsuarioSessao = { id: admin.id, nome: admin.nome, email: admin.email, perfil: 'administrador', deveTrocarSenha: false };
  const ctx: Ctx = {
    db, config, user: usuario, tokenHash: null, tokenBruto: null, ip: 'script-importacao', cookies: [],
    req: {} as Ctx['req'], res: {} as Ctx['res'], url: new URL('http://localhost/'), query: new URLSearchParams(), params: {}, body: {},
  };

  let criados = 0;
  let existentes = 0;
  const erros: string[] = [];

  for (const ano of anosAlvo) {
    const pascoaIso = pascoa(ano);
    for (const [grupo, lista] of [['nacional', NACIONAIS], ['estadual', ESTADUAIS], ['municipal', MUNICIPAIS]] as const) {
      for (const f of lista) {
        const data = dataDoAno(f, ano, pascoaIso);
        const jaExiste = obter(db, 'SELECT id FROM periodos WHERE nome = ? AND data_inicial = ?', f.nome, data);
        if (jaExiste) { existentes++; continue; }
        try {
          salvar(periodos as Definicao, ctx, null, {
            nome: f.nome, tipo: 'feriado', uf: f.uf ?? null, cidade: f.cidade ?? null,
            data_inicial: data, data_final: data, status: 'ativo',
            observacoes: `Carregado automaticamente (${grupo}, ${ano}).`,
          });
          criados++;
        } catch (e) {
          erros.push(`${f.nome} (${data}): ${(e as Error).message}`);
        }
      }
    }
  }

  console.log(`Feriados conferidos para ${anosAlvo.join(', ')}: ${criados} criado(s), ${existentes} já existiam (ignorados).`);
  if (erros.length) {
    console.log(`${erros.length} erro(s):`);
    for (const e of erros) console.log(' -', e);
  }
}

principal();
