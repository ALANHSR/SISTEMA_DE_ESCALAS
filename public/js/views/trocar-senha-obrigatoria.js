import { el, montar, toast, mensagemDeErro } from '../ui.js';
import { api, ErroApi } from '../api.js';
import { estado, definirUsuario } from '../estado.js';
import { navegarPara } from '../roteador.js';

export function viewTrocarSenhaObrigatoria(raiz) {
  let carregando = false;
  let erro = null;

  function desenhar() {
    const form = el('form', { onsubmit: async (e) => { e.preventDefault(); await trocar(); } }, [
      el('h1', {}, 'Troca de senha obrigatória'),
      el('p', { class: 'subtitulo' }, 'Por segurança, defina uma nova senha antes de continuar.'),
      erro ? el('div', { class: 'mensagem-erro-geral' }, erro) : null,
      el('div', { class: 'campo' }, [el('label', { for: 'atual' }, 'Senha atual'), el('input', { id: 'atual', type: 'password', autocomplete: 'current-password', required: true })]),
      el('div', { class: 'campo', style: 'margin-top:12px' }, [el('label', { for: 'nova' }, 'Nova senha'), el('input', { id: 'nova', type: 'password', autocomplete: 'new-password', required: true })]),
      el('div', { class: 'campo', style: 'margin-top:12px' }, [el('label', { for: 'confirmar' }, 'Confirmar nova senha'), el('input', { id: 'confirmar', type: 'password', autocomplete: 'new-password', required: true })]),
      el('button', { class: 'botao primario', type: 'submit', disabled: carregando || undefined, style: 'margin-top:18px;width:100%;justify-content:center' }, carregando ? 'Salvando…' : 'Definir nova senha'),
    ]);
    montar(raiz, el('div', { class: 'tela-login' }, el('div', { class: 'cartao-login' }, form)));
  }

  async function trocar() {
    const atual = document.getElementById('atual').value;
    const nova = document.getElementById('nova').value;
    const confirmar = document.getElementById('confirmar').value;
    if (nova !== confirmar) { erro = 'As duas senhas novas não são iguais.'; desenhar(); return; }
    carregando = true; erro = null; desenhar();
    try {
      await api.post('/api/auth/senha', { senha_atual: atual, senha_nova: nova });
      definirUsuario({ ...estado.usuario, deveTrocarSenha: false });
      toast('Senha definida com sucesso.', 'sucesso');
      navegarPara('/dashboard');
    } catch (e) {
      erro = e instanceof ErroApi ? mensagemDeErro(e) : 'Não foi possível trocar a senha. Tente novamente.';
      carregando = false; desenhar();
    }
  }

  desenhar();
}
