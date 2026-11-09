// Leitor de CSV sem dependências externas. Aceita separador ";" (padrão do Excel em português)
// ou "," (detectado pela linha de cabeçalho), campos entre aspas com separador/quebra de linha
// dentro, aspas duplicadas ("") como aspas literais, BOM UTF-8 e quebras de linha \r\n ou \n.

export function lerCsv(texto: string): string[][] {
  const conteudo = texto.replace(/^\uFEFF/, '');
  const primeiraLinha = conteudo.split(/\r?\n/, 1)[0] ?? '';
  const separador = primeiraLinha.split(';').length >= primeiraLinha.split(',').length ? ';' : ',';

  const linhas: string[][] = [];
  let linha: string[] = [];
  let campo = '';
  let entreAspas = false;

  for (let i = 0; i < conteudo.length; i++) {
    const c = conteudo[i]!;
    if (entreAspas) {
      if (c === '"') {
        if (conteudo[i + 1] === '"') { campo += '"'; i++; } else entreAspas = false;
      } else campo += c;
      continue;
    }
    if (c === '"') entreAspas = true;
    else if (c === separador) { linha.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && conteudo[i + 1] === '\n') i++;
      linha.push(campo); campo = '';
      linhas.push(linha); linha = [];
    } else campo += c;
  }
  if (campo !== '' || linha.length > 0) { linha.push(campo); linhas.push(linha); }

  // Ignora linhas totalmente vazias (ex.: linhas em branco no fim do arquivo).
  return linhas.filter((l) => l.some((c) => c.trim() !== ''));
}

/** Normaliza um texto para comparação: minúsculas, sem acentos e sem espaços nas pontas. */
export function normalizar(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}
