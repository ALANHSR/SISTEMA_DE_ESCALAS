// Lint sem dependências externas (sem acesso ao registro npm neste ambiente).
// Verificações "duras" (falham o build): sintaxe válida em todo o frontend (public/js), ausência de
// `debugger`, ausência de igualdade frouxa (==/!=) e ausência de `console.log` fora dos scripts de
// linha de comando. Verificações informativas (não falham o build): uso de `any` em TypeScript.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const RAIZ = new URL('..', import.meta.url).pathname;
const CLI_PERMITIDOS = new Set(['src/server/seed.ts', 'src/server/criar-admin.ts', 'src/server/migrate.ts', 'src/server/index.ts']);
const PASTAS_JS = ['public/js'];
const PASTAS_TS = ['src', 'tests'];
const IGNORAR_DIRS = new Set(['node_modules', 'data', '.git']);

let erros = 0;
let avisos = 0;

function listarArquivos(pasta, extensoes) {
  const saida = [];
  const percorrer = (dir) => {
    for (const nome of readdirSync(dir)) {
      if (IGNORAR_DIRS.has(nome)) continue;
      const caminho = join(dir, nome);
      const st = statSync(caminho);
      if (st.isDirectory()) percorrer(caminho);
      else if (extensoes.includes(extname(nome))) saida.push(caminho);
    }
  };
  percorrer(join(RAIZ, pasta));
  return saida;
}

function relatarErro(arquivo, mensagem) {
  console.error(`✗ ${relative(RAIZ, arquivo)}: ${mensagem}`);
  erros++;
}
function relatarAviso(arquivo, mensagem) {
  console.warn(`  aviso: ${relative(RAIZ, arquivo)}: ${mensagem}`);
  avisos++;
}

// 1) Sintaxe válida de todo o JavaScript do frontend.
for (const arquivo of listarArquivos('public/js', ['.js'])) {
  try {
    execFileSync(process.execPath, ['--check', arquivo], { stdio: 'pipe' });
  } catch (e) {
    relatarErro(arquivo, `erro de sintaxe:\n${e.stderr?.toString() ?? e.message}`);
  }
}

// 2) Regras de texto sobre TS (src, tests) e JS (public/js).
const arquivosTexto = [
  ...PASTAS_TS.flatMap((p) => listarArquivos(p, ['.ts'])),
  ...PASTAS_JS.flatMap((p) => listarArquivos(p, ['.js'])),
];

for (const arquivo of arquivosTexto) {
  const relPath = relative(RAIZ, arquivo).split('\\').join('/');
  const linhas = readFileSync(arquivo, 'utf8').split('\n');
  linhas.forEach((linha, i) => {
    const n = i + 1;
    const semComentario = linha.replace(/\/\/.*$/, '');

    if (/\bdebugger\b/.test(semComentario)) relatarErro(arquivo, `linha ${n}: instrução "debugger" não deve ir para produção.`);

    if (/console\.log\s*\(/.test(semComentario) && !CLI_PERMITIDOS.has(relPath)) {
      relatarErro(arquivo, `linha ${n}: "console.log" fora de um script de linha de comando (use console.error para diagnósticos de servidor, se necessário).`);
    }

    // Igualdade frouxa: "==" ou "!=" que não fazem parte de "===", "!==" ou "=>"/">=". Ignora strings simples de aspas.
    const semStrings = semComentario.replace(/'(?:[^'\\]|\\.)*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, '""');
    if (/(?<![=!<>])={2}(?!=)|(?<!=)!={1}(?!=)/.test(semStrings)) {
      relatarErro(arquivo, `linha ${n}: use igualdade estrita (=== / !==) em vez de (== / !=).`);
    }

    if (/[ \t]+$/.test(linha)) relatarAviso(arquivo, `linha ${n}: espaço em branco no final da linha.`);
  });
}

// 3) Uso de `any` em TypeScript: apenas informativo.
for (const arquivo of PASTAS_TS.flatMap((p) => listarArquivos(p, ['.ts']))) {
  const conteudo = readFileSync(arquivo, 'utf8');
  const m = conteudo.match(/:\s*any\b|<any>|as any\b/g);
  if (m) relatarAviso(arquivo, `usa "any" ${m.length} vez(es) — prefira um tipo específico quando possível.`);
}

console.log(`\nLint concluído: ${erros} erro(s), ${avisos} aviso(s).`);
process.exit(erros > 0 ? 1 : 0);
