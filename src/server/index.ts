import { carregarConfig } from './config.ts';
import { abrirBanco } from './db.ts';
import { migrar } from './migrate.ts';
import { criarApp } from './app.ts';

const config = carregarConfig();
const db = abrirBanco(config.caminhoBanco);
const aplicadas = migrar(db);
if (aplicadas.length) console.log(`Migrations aplicadas: ${aplicadas.join(', ')}`);

const { servidor } = criarApp({ db, config });
servidor.listen(config.porta, config.host, () => {
  console.log(`Sistema de escalas em http://${config.host}:${config.porta}  (fuso America/Sao_Paulo)`);
});

function encerrar(): void {
  servidor.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', encerrar);
process.on('SIGTERM', encerrar);
