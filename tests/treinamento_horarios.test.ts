import test from 'node:test';
import assert from 'node:assert/strict';
import { clienteAdmin, subirAmbiente } from './apoio.ts';

test('treinamento: horários individuais por participante alimentam detalhe e horas por projeto', async () => {
  const amb = await subirAmbiente();
  try {
    const a = await clienteAdmin(amb);
    const mk = async (rota: string, corpo: object) => {
      const r = await a.post(rota, corpo);
      assert.equal(r.status, 201, JSON.stringify(r.json));
      return r.json.dado;
    };
    const alan = await mk('/api/profissionais', { nome_completo: 'Alan Souza', cargo: 'ANALISTA', uf: 'SP' });
    const ivan = await mk('/api/profissionais', { nome_completo: 'Ivan Lima', cargo: 'ANALISTA', uf: 'SP' });
    const adri = await mk('/api/profissionais', { nome_completo: 'Adriana Reis', cargo: 'ANALISTA', uf: 'SP' });
    const proj = await mk('/api/projetos', { nome: 'Projeto Fratura', codigo: 'FRAT', status: 'ativo' });
    const t = await mk('/api/treinamentos', {
      nome: 'Fratura fechada', projeto_id: proj.id, remoto: true, data_inicial: '2026-11-09', data_final: '2026-11-13', duracao_minutos: 60,
      horarios: [
        { profissional_id: alan.id, dias_semana: [5], hora_inicio: '09:00' },
        { profissional_id: alan.id, dias_semana: [5], hora_inicio: '14:00' },
        { profissional_id: ivan.id, dias_semana: [1, 2, 3, 4, 5], hora_inicio: '20:00' },
        { profissional_id: adri.id, dias_semana: [1, 2, 3, 4], hora_inicio: '09:00' },
        { profissional_id: adri.id, dias_semana: [1, 2, 3, 4], hora_inicio: '14:00' },
      ],
    });
    const d = (await a.get(`/api/treinamentos/${t.id}`)).json.dado;
    assert.equal(d.horas_total_minutos, (2 + 5 + 8) * 60);
    assert.equal(d.participantes.length, 3);

    const r = (await a.get('/api/horas-projetos')).json;
    const por = (id: number) => r.detalhe.find((x: { profissional_id: number }) => x.profissional_id === id).treinamento_min;
    assert.equal(por(alan.id), 120);
    assert.equal(por(ivan.id), 300);
    assert.equal(por(adri.id), 480);

    // sem participantes → erro de validação
    const ruim = await a.post('/api/treinamentos', { nome: 'X', remoto: true, data_inicial: '2026-11-09', data_final: '2026-11-13', duracao_minutos: 60, horarios: [] });
    assert.equal(ruim.status, 422, JSON.stringify(ruim.json));
  } finally { await amb.encerrar(); }
});
