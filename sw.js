// Trebbiano Service Worker v2
// Permite notificações push mesmo com app fechado

const CACHE_NAME = 'trebbiano-v2';
const SHEETS_URL_KEY = 'trebbiano_sheets_url';
const CHECK_INTERVAL = 4 * 60 * 60 * 1000; // 4 horas

// ── Instalação ──────────────────────────────
self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(clients.claim());
});

// ── Receber mensagem do app ──────────────────
self.addEventListener('message', e => {
  const { type, data } = e.data || {};

  if(type === 'SETUP') {
    // App envia config quando abre
    self.sheetsUrl = data.sheetsUrl;
    self.vozAtivo = data.vozAtivo;
    // Agenda verificação periódica
    agendarVerificacao();
  }

  if(type === 'CHECK_NOW') {
    verificarAlertas();
  }

  if(type === 'VOZ_TOGGLE') {
    self.vozAtivo = data.ativo;
  }
});

// ── Notificação clicada ──────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type:'window' }).then(list => {
      if(list.length > 0) {
        list[0].focus();
        list[0].postMessage({ type:'OPEN_ALERTAS' });
      } else {
        clients.openWindow('/Trebbiano/');
      }
    })
  );
});

// ── Verificar alertas ────────────────────────
async function verificarAlertas() {
  if(!self.sheetsUrl) return;
  try {
    const resp = await fetch(self.sheetsUrl + '?action=read', { cache:'no-store' });
    const data = JSON.parse(await resp.text());
    const produtos = data.products || [];
    const hoje = new Date(); hoje.setHours(0,0,0,0);

    const vencidos = [];
    const alertas = [];
    const baixo = [];

    produtos.forEach(p => {
      if(!p.validade) return;
      const d = new Date(p.validade + 'T00:00:00');
      if(isNaN(d.getTime())) return;
      const dias = Math.round((d - hoje) / 864e5);
      if(dias < 0) vencidos.push({ nome: p.nome, dias: Math.abs(dias) });
      else if(dias <= 7) alertas.push({ nome: p.nome, dias });
      if(p.qtd < p.min && p.min > 0) baixo.push({ nome: p.nome, qtd: p.qtd, min: p.min });
    });

    // Só notifica se houver alertas reais
    if(vencidos.length === 0 && alertas.length === 0 && baixo.length === 0) return;

    // Monta mensagem
    let titulo = '';
    let corpo = '';
    let urgente = false;

    if(vencidos.length > 0) {
      urgente = true;
      titulo = `🔴 ${vencidos.length} produto(s) VENCIDO(S)!`;
      corpo = vencidos.slice(0,3).map(p => `• ${p.nome} (${p.dias}d vencido)`).join('\n');
    } else if(alertas.length > 0) {
      titulo = `🟠 ${alertas.length} produto(s) vencem em breve`;
      corpo = alertas.slice(0,3).map(p => `• ${p.nome} (${p.dias === 0 ? 'hoje' : p.dias + 'd'} )`).join('\n');
    }

    if(baixo.length > 0) {
      corpo += (corpo ? '\n' : '') + `📦 ${baixo.length} produto(s) com estoque baixo`;
    }

    // Verifica se app está aberto — se estiver, não notifica (ele cuida disso)
    const clientList = await clients.matchAll({ type:'window', includeUncontrolled:true });
    const appAberto = clientList.some(c => c.visibilityState === 'visible');
    if(appAberto) return;

    // Dispara notificação
    await self.registration.showNotification('🍷 Trebbiano — ' + titulo, {
      body: corpo,
      icon: '/Trebbiano/icon-192.png',
      badge: '/Trebbiano/icon-192.png',
      tag: 'trebbiano-alerta-' + Date.now(),
      requireInteraction: urgente,
      vibrate: urgente ? [400,150,400,150,400] : [200,100,200],
      data: { url: '/Trebbiano/' }
    });

  } catch(e) {
    // Silencioso — sem conexão
  }
}

// ── Agenda verificação a cada 4h ─────────────
let verificacaoTimer = null;
function agendarVerificacao() {
  if(verificacaoTimer) clearInterval(verificacaoTimer);
  verificacaoTimer = setInterval(() => verificarAlertas(), CHECK_INTERVAL);
  // Também verifica logo na inicialização
  setTimeout(() => verificarAlertas(), 10000);
}
