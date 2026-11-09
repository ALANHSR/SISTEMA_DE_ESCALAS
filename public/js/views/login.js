import { el, montar } from '../ui.js';
import { api, definirCsrf, ErroApi } from '../api.js';
import { definirUsuario } from '../estado.js';
import { navegarPara } from '../roteador.js';

export function viewLogin(raiz) {
  let carregando = false;
  let erro = null;

  function desenhar() {
    const form = el('form', {
      onsubmit: async (e) => { e.preventDefault(); await entrar(); },
    }, [
      el('div', { class: 'login-logo' }, 'E'),
      el('h1', {}, 'Sistema de Escalas'),
      el('p', { class: 'subtitulo' }, 'Escalas, folgas e treinamentos em um só lugar. Entre para continuar.'),
      erro ? el('div', { class: 'mensagem-erro-geral' }, erro) : null,
      el('div', { class: 'campo' }, [el('label', { for: 'email' }, 'E-mail'), el('input', { id: 'email', type: 'email', autocomplete: 'username', required: true })]),
      el('div', { class: 'campo', style: 'margin-top:12px' }, [el('label', { for: 'senha' }, 'Senha'), el('input', { id: 'senha', type: 'password', autocomplete: 'current-password', required: true })]),
      el('button', { class: 'botao primario', type: 'submit', disabled: carregando || undefined, style: 'margin-top:18px;width:100%;justify-content:center' }, carregando ? 'Entrando…' : 'Entrar'),
    ]);
    montar(raiz, el('div', { class: 'tela-login' }, el('div', { class: 'cartao-login' }, form)));
  }

  async function entrar() {
    const email = document.getElementById('email').value.trim();
    const senha = document.getElementById('senha').value;
    carregando = true; erro = null; desenhar();
    try {
      const r = await api.post('/api/auth/login', { email, senha });
      definirCsrf(r.csrf_token);
      definirUsuario(r.usuario);
      navegarPara(r.redirecionar.replace('#', ''));
    } catch (e) {
      erro = e instanceof ErroApi ? e.message : 'Não foi possível entrar. Tente novamente.';
      carregando = false; desenhar();
    }
  }

  desenhar();
}
