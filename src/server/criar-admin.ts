// Uso: npm run criar-admin -- "Nome" email@empresa.com.br
// A senha é lida da variável ADMIN_PASSWORD (nunca de argumentos de linha de comando).
import { carregarConfig } from './config.ts';
import { abrirBanco, executar, obter } from './db.ts';
import { migrar } from './migrate.ts';
import { hashSenha, problemaNaSenha } from './auth.ts';

const [nome, email] = process.argv.slice(2);
const senha = process.env.ADMIN_PASSWORD ?? '';
if (!nome || !email) {
  console.error('Uso: ADMIN_PASSWORD=... npm run criar-admin -- "Nome" email@empresa.com.br');
  process.exit(1);
}
const problema = problemaNaSenha(senha);
if (problema) {
  console.error(`ADMIN_PASSWORD inválida. ${problema}`);
  process.exit(1);
}
const db = abrirBanco(carregarConfig().caminhoBanco);
migrar(db);
if (obter(db, 'SELECT id FROM usuarios WHERE email = ?', email.toLowerCase())) {
  console.error('Já existe um usuário com este e-mail.');
  process.exit(1);
}
const agora = new Date().toISOString();
executar(db, `INSERT INTO usuarios (nome, email, senha_hash, perfil, status, criado_em, atualizado_em)
              VALUES (?, ?, ?, 'administrador', 'ativo', ?, ?)`, nome, email.toLowerCase(), hashSenha(senha), agora, agora);
console.log(`Administrador ${email} criado.`);
