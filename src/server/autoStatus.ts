// Pontos 2 e 4 do segundo pedido de ajustes: transições de situação automáticas, por data.
//  - Projeto "ativo" cuja data final já passou vira "concluído".
//  - Escala "em andamento" cuja data final já passou vira "concluída".
// Não há um processo em segundo plano (cron) neste ambiente, então a verificação roda a cada
// requisição autenticada, mas no máximo uma vez por minuto (guarda em memória), para não pesar
// o banco a cada chamada. Cada mudança também fica registrada na auditoria (usuário nulo = sistema).
import type { DB } from './db.ts';
import { executar, listar } from './db.ts';
import { hojeSaoPaulo } from '../shared/datetime.ts';
import { registrarAuditoria } from './auditoria.ts';

const INTERVALO_MS = 60_000;
let ultimaExecucaoEm = 0;

function concluirAutomaticamente(
  db: DB,
  o: { tabela: string; statusAtual: string; statusNovo: string; tituloCampo: string },
): void {
  const hoje = hojeSaoPaulo();
  const vencidos = listar(
    db,
    `SELECT id, ${o.tituloCampo} AS titulo FROM ${o.tabela} WHERE status = ? AND data_final < ?`,
    o.statusAtual, hoje,
  );
  if (vencidos.length === 0) return;
  const agora = new Date().toISOString();
  for (const r of vencidos) {
    executar(db, `UPDATE ${o.tabela} SET status = ?, atualizado_em = ? WHERE id = ?`, o.statusNovo, agora, r.id);
    registrarAuditoria(db, {
      entidade: o.tabela, registroId: r.id as number, acao: 'status_automatico', usuario: null,
      detalhes: { de: o.statusAtual, para: o.statusNovo, motivo: 'data final atingida', titulo: r.titulo },
    });
  }
}

/** Roda as duas verificações acima, no máximo 1x por minuto por processo. */
export function atualizarStatusAutomatico(db: DB, agora = Date.now()): void {
  if (agora - ultimaExecucaoEm < INTERVALO_MS) return;
  ultimaExecucaoEm = agora;
  concluirAutomaticamente(db, { tabela: 'projetos', statusAtual: 'ativo', statusNovo: 'concluido', tituloCampo: 'nome' });
  concluirAutomaticamente(db, { tabela: 'escalas', statusAtual: 'em_andamento', statusNovo: 'concluida', tituloCampo: 'titulo' });
}

/** Só para testes: zera o controle de throttling entre execuções. */
export function _resetarThrottleParaTeste(): void {
  ultimaExecucaoEm = 0;
}
