// Rótulos em português para valores de enumeração (usados na exportação CSV e nas mensagens).
export const ROTULOS: Record<string, string> = {
  ativo: 'Ativo', inativo: 'Inativo',
  planejamento: 'Planejado', pausado: 'Pausado', concluido: 'Concluído', cancelado: 'Cancelado',
  planejada: 'Planejada', confirmada: 'Confirmada', em_andamento: 'Em andamento', concluida: 'Concluída', cancelada: 'Cancelada',
  solicitada: 'Solicitada', aprovada: 'Aprovada', recusada: 'Recusada',
  planejado: 'Planejado', confirmado: 'Confirmado',
  administrador: 'Administrador', usuario: 'Usuário',
  folga_compensatoria: 'Folga compensatória', folga_semanal: 'Folga semanal', ferias: 'Férias',
  licenca: 'Licença', banco_de_horas: 'Banco de horas', outro: 'Outro',
  feriado: 'Feriado', recesso: 'Recesso', operacional: 'Operacional',
  escala: 'Escala', folga: 'Folga', treinamento: 'Treinamento',
  // Quinto pedido de ajustes (outubro): tipo de local, classificação e tamanho do projeto.
  hospital: 'Hospital', clinica: 'Clínica', pronto_atendimento: 'Pronto atendimento',
  melhoria: 'Melhoria', projeto: 'Projeto',
  pequeno: 'Pequeno', medio: 'Médio', grande: 'Grande',
};
export const rotulo = (v: unknown): string => (typeof v === 'string' ? (ROTULOS[v] ?? v) : '');
