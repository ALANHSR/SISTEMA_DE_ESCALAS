import test from 'node:test';
import assert from 'node:assert/strict';
import { clienteAdmin, clienteUsuario, subirAmbiente } from './apoio.ts';

test('horas por projeto: operação assistida (escalas) + treinamento, por projeto e por profissional', async () => {
  const amb = await subirAmbiente();
  try {
    const a = await clienteAdmin(amb);
    const mk = async (rota: string, corpo: object) => {
      const r = await a.post(rota, corpo);
      assert.equal(r.status, 201, JSON.stringify(r.json));
      return r.json.dado;
    };
    const ana = await mk('/api/profissionais', { nome_completo: 'Ana Ribeiro', cargo: 'ANALISTA', uf: 'SP' });
    const jose = await mk('/api/profissionais', { nome_completo: 'José Álvares', cargo: 'IMPLANTADOR(A)', uf: 'RJ' });
    const alfa = await mk('/api/projetos', { nome: 'Projeto Alfa', codigo: 'ALFA', status: 'ativo' });
    const beta = await mk('/api/projetos', { nome: 'Projeto Beta', codigo: 'BETA', status: 'ativo' });
    const h = await mk('/api/horarios', { nome: 'D1 /1', hora_inicio: '07:00', hora_fim: '17:00', vira_dia: false });
    const minDia = Math.round(h.horas_previstas * 60);
    assert.ok(minDia > 0);

    // Ana: 3 dias; José: 2 dias — escala planejada do projeto Alfa.
    const dias = [
      ...['2026-11-02', '2026-11-03', '2026-11-04'].map((data) => ({ profissional_id: ana.id, data, horario_id: h.id })),
      ...['2026-11-02', '2026-11-03'].map((data) => ({ profissional_id: jose.id, data, horario_id: h.id })),
    ];
    await mk('/api/escalas', { titulo: 'Op. assistida Alfa', projeto_id: alfa.id, remoto: true, data_inicial: '2026-11-02', data_final: '2026-11-04', dias });
    // Treinamento: segundas e quartas (2 ocorrências em 02–06/11), 2 h cada, 2 participantes.
    await mk('/api/treinamentos', {
      nome: 'Treino Alfa', projeto_id: alfa.id, remoto: true, data_inicial: '2026-11-02', data_final: '2026-11-06',
      hora_inicio: '09:00', hora_fim: '11:00', vira_dia: false, dias_semana: [1, 3], profissional_ids: [ana.id, jose.id],
    });

    const r = await a.get('/api/horas-projetos');
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.projetos.length, 1);
    const p = r.json.projetos[0];
    assert.equal(p.id, alfa.id);
    assert.equal(p.operacao_min, 5 * minDia);
    assert.equal(p.treinamento_min, 2 * 2 * 120);
    assert.equal(p.total_min, 5 * minDia + 480);
    assert.equal(p.total_profissionais, 2);
    const dAna = r.json.detalhe.find((d: { profissional_id: number }) => d.profissional_id === ana.id);
    assert.equal(dAna.operacao_min, 3 * minDia);
    assert.equal(dAna.treinamento_min, 240);
    assert.equal(dAna.funcao, 'ANALISTA');
    assert.equal(r.json.totais.profissionais, 2);

    // Recorte de período: só 02/11 → 1 dia de escala por profissional e 1 ocorrência do treinamento (segunda).
    const rec = await a.get('/api/horas-projetos?inicio=2026-11-02&fim=2026-11-02');
    assert.equal(rec.json.projetos[0].operacao_min, 2 * minDia);
    assert.equal(rec.json.projetos[0].treinamento_min, 2 * 120);

    // "Só confirmadas": escala planejada e treinamento planejado ficam de fora.
    const firmes = await a.get('/api/horas-projetos?considerar=firmes');
    assert.equal(firmes.json.projetos.length, 0);

    // Projeto sem horas aparece (zerado) quando filtrado explicitamente; filtro por outro projeto exclui Alfa.
    const soBeta = await a.get(`/api/horas-projetos?projeto_id=${beta.id}`);
    assert.equal(soBeta.json.projetos.length, 1);
    assert.equal(soBeta.json.projetos[0].total_min, 0);

    // Validação e CSV.
    assert.equal((await a.get('/api/horas-projetos?inicio=2026-11-10&fim=2026-11-01')).status, 422);
    const csv = await a.get('/api/horas-projetos/exportar');
    assert.equal(csv.status, 200);
    assert.match(String(csv.json), /Projeto Alfa;.*;Ana Ribeiro;ANALISTA;/);

    // Somente administrador.
    const u = await clienteUsuario(amb);
    assert.equal((await u.get('/api/horas-projetos')).status, 403);
  } finally { await amb.encerrar(); }
});
