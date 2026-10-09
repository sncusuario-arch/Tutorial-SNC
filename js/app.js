/* ===========================================================
   BUILD MARKER — confirme no console e em Configurações > Sobre
   que esta é a versão que você está de fato testando.
   =========================================================== */
const BUILD_ID = 'tutor-snc-v4.0-estudio-export-zoom-2026-10-09';
console.log('%cTutor SNC build: ' + BUILD_ID, 'color:#007aff;font-weight:bold;');

/* ===========================================================
   STATE + PERSISTENCE
   =========================================================== */
const State = {
  tutorials: [],   // {id, name, screens[], createdAt, updatedAt}
  view: 'dashboard',
  theme: 'light',
  accent: 'blue',
  defaultHotspotStyle: 'pulse',
  hasSeenOnboarding: false,
  lang: 'pt',
  shortcuts: {},   // overrides: {actionId: 'Ctrl+Z'}
  exportOpts: null, // filled by ExportOpts defaults
  editor: {
    tutorialId: null,
    activeScreenId: null,
    activeStepId: null,
    inspectorTab: 'step',
    drawMode: false,
    pendingRect: null,
    placingType: null,
    renamingScreenId: null,
    lastDeleted: null,
    zoom: 1,
    saveTimer: null,
  }
};

// Two independent keys on purpose: SETTINGS_KEY is tiny (theme/accent) and must
// always succeed. DATA_KEY holds tutorials with embedded images and can be large
// enough to hit the localStorage quota — if it fails, settings must NOT be affected.
// Opções de exportação (persistidas em Configurações). Usadas por PDF/GIF/Vídeo,
// pelo Player e pelo HTML exportado.
const ExportOpts = {
  quality: 'med',     // low | med | high
  aspect: '16:9',     // 16:9 | 4:3 | 1:1 | 9:16
  frame: 'default',   // id em FRAME_PRESETS
  pad: 3,             // % de espaçamento ao redor da tela
  radius: 10,         // cantos arredondados (px em 1280 de largura)
  shadow: true,
  anim: true,         // GIF/Vídeo animados
  zoom: true,         // respeitar zoom por passo
  cursor: true,       // cursor animado
  fps: 10,            // GIF
  loop: true          // GIF em loop
};
const SETTINGS_KEY = 'looptour_settings_v1';
const DATA_KEY = 'looptour_data_v1';

const Persist = {
  saveSettings(){
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({theme: State.theme, accent: State.accent, defaultHotspotStyle: State.defaultHotspotStyle, hasSeenOnboarding: State.hasSeenOnboarding, lang: State.lang, shortcuts: State.shortcuts, exportOpts: ExportOpts}));
    } catch(e){ console.warn('Settings save failed', e); }
  },
  saveData(){
    const clean = {
      tutorials: State.tutorials.map(t => ({
        ...t,
        screens: t.screens.map(s => ({id:s.id, name:s.name, customName:s.customName||null, dataUrl:s.dataUrl, steps:s.steps, annotations:s.annotations||[], collapsed:s.collapsed}))
      }))
    };
    try {
      localStorage.setItem(DATA_KEY, JSON.stringify(clean));
      return true;
    } catch(e){
      console.warn('Data save failed (likely quota exceeded)', e);
      toast('Armazenamento cheio — exporte um backup em Configurações para não perder este tutorial');
      return false;
    }
  },
  save(){ this.saveSettings(); this.saveData(); },
  load(){
    try {
      const rawSettings = localStorage.getItem(SETTINGS_KEY);
      if(rawSettings){
        const s = JSON.parse(rawSettings);
        State.theme = s.theme || 'light';
        State.accent = s.accent || 'blue';
        State.defaultHotspotStyle = s.defaultHotspotStyle || 'pulse';
        State.hasSeenOnboarding = !!s.hasSeenOnboarding;
        State.lang = s.lang || 'pt';
        State.shortcuts = (s.shortcuts && typeof s.shortcuts === 'object') ? s.shortcuts : {};
        if(s.exportOpts && typeof s.exportOpts === 'object') Object.assign(ExportOpts, s.exportOpts);
      }
    } catch(e){ console.warn('Settings load failed', e); }

    try {
      const rawData = localStorage.getItem(DATA_KEY);
      if(rawData){
        const data = JSON.parse(rawData);
        State.tutorials = data.tutorials || [];
        // rehydrate imgEl for each screen
        State.tutorials.forEach(t => {
          t.screens.forEach(s => {
            if(s.dataUrl){
              const img = new Image();
              img.src = s.dataUrl;
              s.imgEl = img;
            }
          });
        });
      } else {
        // fall back to legacy combined key from earlier versions, if present
        const legacy = localStorage.getItem('looptour_v3');
        if(legacy){
          const data = JSON.parse(legacy);
          State.tutorials = data.tutorials || [];
          State.tutorials.forEach(t => {
            t.screens.forEach(s => {
              if(s.dataUrl){ const img = new Image(); img.src = s.dataUrl; s.imgEl = img; }
            });
          });
        }
      }
    } catch(e){ console.warn('Data load failed', e); }
  }
};

const uid = () => Math.random().toString(36).slice(2, 10);
const now = () => Date.now();
const fmtDate = (ts) => {
  const d = new Date(ts);
  const diff = (Date.now() - ts) / 1000;
  if(diff < 60) return 'agora';
  if(diff < 3600) return Math.floor(diff/60)+'m atrás';
  if(diff < 86400) return Math.floor(diff/3600)+'h atrás';
  if(diff < 604800) return Math.floor(diff/86400)+'d atrás';
  return d.toLocaleDateString('pt-BR');
};

function toast(msg, ms=1900){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(t._to);
  t._to = setTimeout(()=>t.classList.remove('on'), ms);
}
function escapeHtml(s){ return (s||'').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m])); }

/* ===========================================================
   ROUTER (sidebar navigation)
   =========================================================== */
const App = {
  switchView(name){
    State.view = name;
    document.querySelectorAll('.nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.view === name);
    });
    Views[name] && Views[name]();
    updateSidebarCounts();
  },
  createTutorial(){
    const name = document.getElementById('new-tutorial-name').value.trim() || 'Tutorial sem nome';
    const t = { id: uid(), name, screens: [], brand: {name:'', logo:''}, createdAt: now(), updatedAt: now() };
    State.tutorials.push(t);
    Persist.save();
    Modal.close('new');
    document.getElementById('new-tutorial-name').value = '';
    Editor.open(t.id);
  },
  openTutorial(id){ Editor.open(id); },
  openTutorialForElement(type){
    if(State.tutorials.length === 0){
      toast('Crie um tutorial primeiro');
      Modal.open('new');
      return;
    }
    const t = [...State.tutorials].sort((a,b) => b.updatedAt - a.updatedAt)[0];
    Editor.open(t.id);
    if(t.screens.length === 0){
      toast('Envie uma tela para começar a usar elementos');
      return;
    }
    setTimeout(() => Editor.startPlacing(type), 350);
  },
  deleteTutorial(id, ev){
    ev && ev.stopPropagation();
    if(!confirm('Excluir este tutorial? Esta ação não pode ser desfeita.')) return;
    State.tutorials = State.tutorials.filter(t => t.id !== id);
    Persist.save();
    Views[State.view]();
    updateSidebarCounts();
    toast('Tutorial excluído');
  }
};

function updateSidebarCounts(){
  document.getElementById('nav-count-tutorials').textContent = State.tutorials.length;
}

/* ===========================================================
   VIEWS
   =========================================================== */
const Views = {
  dashboard(){
    const root = document.getElementById('view-root');
    const total = State.tutorials.length;
    const totalSteps = State.tutorials.reduce((a,t) => a + t.screens.reduce((b,s)=>b+s.steps.length, 0), 0);
    const totalScreens = State.tutorials.reduce((a,t)=>a+t.screens.length, 0);
    const recent = [...State.tutorials].sort((a,b)=>b.updatedAt - a.updatedAt).slice(0, 8);

    root.innerHTML = `
      <div class="workspace-header">
        <div>
          <div class="workspace-title">${tr('t.dashboard')}</div>
          <div class="workspace-sub">Bom te ver de novo. Vamos criar algo hoje?</div>
        </div>
        <div class="workspace-actions">
          <button class="btn btn-primary" onclick="Modal.open('new')">
            <svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            Novo tutorial
          </button>
        </div>
      </div>
      <div class="workspace-body">
        <div class="hero-card">
          <div>
            <h2>Crie tutoriais interativos em minutos</h2>
            <p>Envie prints, desenhe as áreas importantes, escreva as instruções. Exporte em HTML, PDF, GIF ou vídeo — tudo sem sair do navegador.</p>
          </div>
          <div class="hero-actions">
            <button class="btn btn-white btn-lg" onclick="Modal.open('new')">Começar</button>
          </div>
        </div>

        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-label">Tutoriais</div>
            <div class="stat-value">${total}</div>
            <div class="stat-trend neutral">${total===0?'Nenhum ainda':'ativos'}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Telas</div>
            <div class="stat-value">${totalScreens}</div>
            <div class="stat-trend neutral">total</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Passos</div>
            <div class="stat-value">${totalSteps}</div>
            <div class="stat-trend neutral">criados</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Formatos</div>
            <div class="stat-value">4</div>
            <div class="stat-trend neutral">HTML · PDF · GIF · Vídeo</div>
          </div>
        </div>

        <div class="section-head">
          <h3>Tutoriais recentes</h3>
          ${State.tutorials.length ? '<span class="section-action" onclick="App.switchView(\'tutorials\')">Ver todos →</span>' : ''}
        </div>
        <div class="tutorials-grid">
          <div class="tutorial-card new-card" onclick="Modal.open('new')">
            <svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            <strong>Novo tutorial</strong>
            <span>A partir do zero</span>
          </div>
          ${recent.map(t => renderTutorialCard(t)).join('')}
        </div>
      </div>
    `;
  },

  tutorials(){
    const root = document.getElementById('view-root');
    const list = [...State.tutorials].sort((a,b) => b.updatedAt - a.updatedAt);
    root.innerHTML = `
      <div class="workspace-header">
        <div>
          <div class="workspace-title">${tr('t.tutorials')}</div>
          <div class="workspace-sub">${list.length} tutorial${list.length!==1?'is':''}</div>
        </div>
        <div class="workspace-actions">
          <button class="btn btn-primary" onclick="Modal.open('new')">
            <svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            Novo tutorial
          </button>
        </div>
      </div>
      <div class="workspace-body">
        ${list.length === 0 ? `
          <div class="canvas-empty" style="margin:60px auto;text-align:center;color:var(--text-muted);">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 5a2 2 0 012-2h9l5 5v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5z"/></svg>
            <h3 style="color:var(--text);margin:12px 0 6px;">Nenhum tutorial ainda</h3>
            <p style="margin-bottom:14px;">Comece criando seu primeiro tutorial.</p>
            <button class="btn btn-primary" onclick="Modal.open('new')">Criar tutorial</button>
          </div>
        ` : `
          <div class="tutorials-grid">
            ${list.map(t => renderTutorialCard(t)).join('')}
          </div>
        `}
      </div>
    `;
  },

  library(){
    const root = document.getElementById('view-root');
    root.innerHTML = `
      <div class="workspace-header">
        <div>
          <div class="workspace-title">${tr('t.library')}</div>
          <div class="workspace-sub">${tr('s.library')}</div>
        </div>
      </div>
      <div class="workspace-body">
        <div class="section-head">
          <h3>Estilos de destaque</h3>
          <span class="section-sub">Clique para definir como padrão em novos passos</span>
        </div>
        <div class="library-grid" style="margin-bottom:24px;">
          ${['pulse','glow','ripple','dot','ring','simple'].map(style => `
            <div class="library-item ${State.defaultHotspotStyle===style?'active-default':''}" onclick="Settings.setDefaultHotspotStyle('${style}')" style="cursor:pointer;position:relative;${State.defaultHotspotStyle===style?'border-color:var(--accent);background:var(--accent-soft);':''}">
              ${State.defaultHotspotStyle===style ? '<div style="position:absolute;top:8px;right:8px;width:18px;height:18px;border-radius:50%;background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;"><svg width="10" height="10" viewBox="0 0 24 24" fill="none"><path d="M5 12l5 5L20 7" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></div>' : ''}
              <div class="library-preview">${renderHotspotPreviewSVG(style)}</div>
              <div class="library-name">${style === 'pulse' ? 'Pulso' : style === 'glow' ? 'Brilho' : style === 'ripple' ? 'Ripple' : style === 'dot' ? 'Ponto' : style === 'ring' ? 'Anel' : 'Simples'}</div>
              <div class="library-desc">${State.defaultHotspotStyle===style ? 'Padrão atual' : 'Estilo animado'}</div>
            </div>
          `).join('')}
        </div>

        <div class="section-head"><h3>Componentes</h3><span class="section-sub">Disponíveis dentro do editor — abra um tutorial e use a barra de elementos no canto do canvas</span></div>
        <div class="library-grid">
          ${[
            {n:'Cursor', type:'cursor', i:'M4 2l16 8-6.5 2-2.2 6.5z'},
            {n:'Seta', type:'arrow', i:'M5 19L19 5M19 5H9M19 5v10'},
            {n:'Clique', type:'click', i:'M12 12m-3 0a3 3 0 106 0a3 3 0 10-6 0 M12 3v3M12 18v3M3 12h3M18 12h3'},
            {n:'Balão', type:'balloon', i:'M4 5h16v10H8l-4 4V5z'},
            {n:'Tecla', type:'key', i:'M3 6h18v12H3z M8 12h.01M12 12h.01M16 12h.01'},
            {n:'Botão', type:'button', i:'M3 8h18v8H3z'},
            {n:'Texto', type:'text', i:'M5 6V4h14v2M12 4v16M9 20h6'},
            {n:'Número', type:'badge', i:'M12 12m-9 0a9 9 0 1018 0a9 9 0 10-18 0 M10 9.5l2-1.5v8'},
            {n:'Imagem', type:'image', i:'M3 4h18v16H3z M21 16l-5-5-9 9'},
          ].map(el => `
            <div class="library-item" style="cursor:pointer;" onclick="App.openTutorialForElement('${el.type}')">
              <div class="library-preview">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${el.i}"/></svg>
              </div>
              <div class="library-name">${el.n}</div>
              <div class="library-desc">Elemento livre, solto na tela</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  },

  settings(){
    const root = document.getElementById('view-root');
    root.innerHTML = `
      <div class="workspace-header">
        <div>
          <div class="workspace-title">Configurações</div>
          <div class="workspace-sub">Personalize a aparência do Tutor SNC</div>
        </div>
      </div>
      <div class="workspace-body" style="max-width:640px;">
        <div class="settings-card">
          <h4>Tema</h4>
          <p>Claro ou escuro. A preferência é salva no seu navegador.</p>
          <div class="theme-picker">
            ${['light','dark'].map(th => `
              <div class="theme-option ${State.theme===th?'active':''}" onclick="Settings.setTheme('${th}')">
                <div class="theme-preview" style="background:${th==='light'?'linear-gradient(135deg,#fff,#f5f5f7)':'linear-gradient(135deg,#1a1a1c,#0d0d0f)'};border:1px solid ${th==='light'?'#e5e5ea':'#26262a'};">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${th==='light'?'#1d1d1f':'#f5f5f7'}" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/>${th==='light'?'<path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>':'<path d="M20 15A9 9 0 0111.5 4a9 9 0 108.5 11z" fill="currentColor"/>'}</svg>
                </div>
                <div class="theme-name">${th==='light'?'Claro':'Escuro'}</div>
              </div>
            `).join('')}
          </div>
        </div>

        <div class="settings-card">
          <h4>Cor de destaque</h4>
          <p>A cor de destaque aparece em botões, links e animações.</p>
          <div class="accent-picker">
            ${['blue','purple','green','orange','pink'].map(a => `
              <div class="accent-swatch ${State.accent===a?'active':''}" style="background:${a==='blue'?'#007aff':a==='purple'?'#7c5cff':a==='green'?'#30d158':a==='orange'?'#ff9500':'#ff375f'}" onclick="Settings.setAccent('${a}')">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M5 12l5 5L20 7" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </div>
            `).join('')}
          </div>
        </div>

        <div class="settings-card">
          <h4>Armazenamento</h4>
          <p>Seus tutoriais ficam no localStorage deste navegador. Faça backup exportando em HTML.</p>
          <div style="display:flex;gap:10px;align-items:center;font-size:12.5px;color:var(--text-muted);">
            <div style="flex:1;">${State.tutorials.length} tutoriais salvos localmente</div>
            <button class="btn btn-secondary btn-sm" onclick="Settings.exportAll()">Baixar backup</button>
            <button class="btn btn-secondary btn-sm btn-danger-ghost" onclick="Settings.clearAll()">Limpar tudo</button>
          </div>
        </div>

        <div class="settings-card">
          <h4>Sobre</h4>
          <p>Tutor SNC — Criador de tutoriais interativos<br>Desenvolvido por Fagner Silva<br>Versão 4.0 · Beta local · Build: ${BUILD_ID}</p>
        </div>
      </div>
    `;
  }
};

function renderTutorialCard(t){
  const totalSteps = t.screens.reduce((a,s)=>a+s.steps.length,0);
  const thumb = t.screens[0] && t.screens[0].dataUrl;
  return `
    <div class="tutorial-card" onclick="App.openTutorial('${t.id}')">
      <div class="tutorial-thumb">
        ${thumb ? `<img src="${thumb}">` : `<div class="tutorial-thumb-empty">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="14" rx="2"/></svg>
          <div>Sem telas</div>
        </div>`}
        <div class="tutorial-thumb-badge">${t.screens.length} tela${t.screens.length!==1?'s':''}</div>
        <button class="tutorial-delete-btn" title="Excluir tutorial" onclick="App.deleteTutorial('${t.id}', event)">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
      <div class="tutorial-meta">
        <div class="tutorial-name">${escapeHtml(t.name)}</div>
        <div class="tutorial-info">
          <span>${totalSteps} passo${totalSteps!==1?'s':''}</span>
          <span class="dot"></span>
          <span>${fmtDate(t.updatedAt)}</span>
        </div>
      </div>
    </div>
  `;
}

function renderHotspotPreviewSVG(style){
  const bg = 'var(--accent)';
  const soft = 'var(--accent-soft-strong)';
  if(style==='pulse') return `<svg width="60" height="60" viewBox="0 0 60 60"><circle cx="30" cy="30" r="10" fill="${bg}"/><circle cx="30" cy="30" r="14" fill="none" stroke="${bg}" stroke-width="2" opacity="0.6"><animate attributeName="r" values="12;24" dur="1.8s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.6;0" dur="1.8s" repeatCount="indefinite"/></circle></svg>`;
  if(style==='glow') return `<svg width="60" height="60" viewBox="0 0 60 60"><circle cx="30" cy="30" r="14" fill="${bg}" opacity="0.35"><animate attributeName="r" values="12;19;12" dur="2.2s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.5;0.18;0.5" dur="2.2s" repeatCount="indefinite"/></circle><circle cx="30" cy="30" r="10" fill="${bg}"/></svg>`;
  if(style==='ripple') return `<svg width="60" height="60" viewBox="0 0 60 60"><circle cx="30" cy="30" r="8" fill="${bg}"/><circle cx="30" cy="30" r="10" fill="${soft}"><animate attributeName="r" values="8;22" dur="1.6s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.7;0" dur="1.6s" repeatCount="indefinite"/></circle></svg>`;
  if(style==='dot') return `<svg width="60" height="60" viewBox="0 0 60 60"><circle cx="30" cy="30" r="8" fill="${bg}"><animate attributeName="r" values="8;10.5;8" dur="1.5s" repeatCount="indefinite"/></circle></svg>`;
  if(style==='ring') return `<svg width="60" height="60" viewBox="0 0 60 60"><circle cx="30" cy="30" r="12" fill="none" stroke="${bg}" stroke-width="3"><animate attributeName="r" values="10;20" dur="1.8s" repeatCount="indefinite"/><animate attributeName="opacity" values="1;0" dur="1.8s" repeatCount="indefinite"/></circle></svg>`;
  return `<svg width="60" height="60" viewBox="0 0 60 60"><rect x="15" y="18" width="30" height="24" rx="4" fill="none" stroke="${bg}" stroke-width="2"><animate attributeName="stroke-width" values="1.5;3;1.5" dur="2.4s" repeatCount="indefinite"/></rect></svg>`;
}

/* ===========================================================
   ELEMENTOS LIVRES (anotações) — cursor, seta, clique, balão,
   tecla, botão. Ficam soltos na tela (não numerados como passos),
   úteis pra apontar ou rotular algo sem criar um passo inteiro.
   =========================================================== */
const ANNOTATION_TYPES = {
  cursor: {label:'Cursor', hasText:false, twoPoint:false, promptLabel:null},
  click:  {label:'Clique', hasText:false, twoPoint:false, promptLabel:null},
  arrow:  {label:'Seta',   hasText:false, twoPoint:true,  promptLabel:null},
  balloon:{label:'Balão',  hasText:true,  twoPoint:false, promptLabel:'Texto do balão:'},
  key:    {label:'Tecla',  hasText:true,  twoPoint:false, promptLabel:'Atalho (ex: Ctrl+S):'},
  button: {label:'Botão',  hasText:true,  twoPoint:false, promptLabel:'Texto do botão:'},
  text:   {label:'Texto',  hasText:true,  twoPoint:false, promptLabel:'Texto livre:'},
  badge:  {label:'Número', hasText:true,  twoPoint:false, promptLabel:'Número ou letra (1 a 3 caracteres):'},
  image:  {label:'Imagem', hasText:false, twoPoint:false, promptLabel:null, needsFile:true},
};

// Icon/content only — no positioning. Reused by editor canvas, Player, and exports.
function annotationContentHTML(ann){
  if(ann.type==='cursor'){
    return `<svg width="26" height="26" viewBox="0 0 24 24" style="filter:drop-shadow(0 2px 4px rgba(0,0,0,.35))"><path d="M4 2l16 8-6.5 2-2.2 6.5z" fill="#ff9500" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/></svg>`;
  }
  if(ann.type==='click'){
    return `<svg width="30" height="30" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4" fill="#ff9500"/><circle cx="12" cy="12" r="9" stroke="#ff9500" stroke-width="2" opacity="0.55"/></svg>`;
  }
  if(ann.type==='balloon'){
    return `<div class="ann-balloon">${escapeHtml(ann.text||'')}</div>`;
  }
  if(ann.type==='key'){
    return `<div class="ann-key">${escapeHtml(ann.text||'')}</div>`;
  }
  if(ann.type==='button'){
    return `<div class="ann-button">${escapeHtml(ann.text||'')}</div>`;
  }
  if(ann.type==='text'){
    return `<div class="ann-text">${escapeHtml(ann.text||'')}</div>`;
  }
  if(ann.type==='badge'){
    return `<div class="ann-badge">${escapeHtml((ann.text||'').slice(0,3))}</div>`;
  }
  if(ann.type==='image'){
    return `<img class="ann-image" src="${ann.dataUrl||''}" draggable="false">`;
  }
  return '';
}

/* ===========================================================
   MODAL
   =========================================================== */
const Modal = {
  open(name){ document.getElementById('modal-'+name).classList.add('on'); },
  close(name){ document.getElementById('modal-'+name).classList.remove('on'); }
};
document.querySelectorAll('.modal-backdrop').forEach(el => {
  el.addEventListener('click', e => { if(e.target === el) el.classList.remove('on'); });
});

/* ===========================================================
   SETTINGS
   =========================================================== */
const Settings = {
  setTheme(t){ State.theme = t; document.documentElement.setAttribute('data-theme', t); Persist.saveSettings(); Views.settings(); },
  setAccent(a){ State.accent = a; document.documentElement.setAttribute('data-accent', a); Persist.saveSettings(); Views.settings(); },
  setDefaultHotspotStyle(style){
    State.defaultHotspotStyle = style;
    Persist.saveSettings();
    Views.library();
    toast('Estilo padrão definido: ' + (style === 'pulse' ? 'Pulso' : style === 'glow' ? 'Brilho' : style === 'ripple' ? 'Ripple' : style === 'dot' ? 'Ponto' : style === 'ring' ? 'Anel' : 'Simples'));
  },
  exportAll(){
    const data = JSON.stringify({tutorials: State.tutorials.map(t => ({...t, screens: t.screens.map(s => ({id:s.id,name:s.name,dataUrl:s.dataUrl,steps:s.steps}))}))}, null, 2);
    const blob = new Blob([data], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'loop-backup.json';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 3000);
    toast('Backup baixado');
  },
  clearAll(){
    if(!confirm('Remover TODOS os tutoriais salvos? Esta ação não pode ser desfeita.')) return;
    State.tutorials = [];
    Persist.save();
    Views.settings();
    updateSidebarCounts();
    toast('Tudo limpo');
  }
};

/* ===========================================================
   EDITOR
   =========================================================== */
const Editor = {
  open(tutorialId){
    State.editor.tutorialId = tutorialId;
    const t = this.tutorial();
    if(!t) return;
    State.editor.activeScreenId = t.screens[0] ? t.screens[0].id : null;
    State.editor.activeStepId = null;
    document.getElementById('editor').classList.add('open');
    document.getElementById('editor-title').value = t.name;
    document.getElementById('editor-title').title = t.name;
    this.render();
    if(!State.hasSeenOnboarding){
      State.hasSeenOnboarding = true;
      Persist.saveSettings();
      setTimeout(() => Modal.open('onboarding'), 400);
    }
  },
  close(){
    document.getElementById('editor').classList.remove('open');
    this.markSaved();
    App.switchView(State.view === 'editor' ? 'tutorials' : State.view);
  },
  tutorial(){ return State.tutorials.find(t => t.id === State.editor.tutorialId); },
  activeScreen(){ const t = this.tutorial(); return t && t.screens.find(s => s.id === State.editor.activeScreenId); },
  activeStep(){
    const sc = this.activeScreen(); if(!sc) return null;
    return sc.steps.find(st => st.id === State.editor.activeStepId);
  },

  render(){
    this.renderScreensTree();
    this.renderCanvas();
    this.renderInspector();
    this.renderTimeline();
    updateSidebarCounts();
  },

  renderScreensTree(){
    const t = this.tutorial(); if(!t) return;
    const el = document.getElementById('screens-tree');
    if(t.screens.length === 0){
      el.innerHTML = '<div style="padding:20px 8px;font-size:12px;color:var(--text-muted);text-align:center;">Nenhuma tela ainda</div>';
      return;
    }
    el.innerHTML = t.screens.map((s, si) => `
      <div class="screen-group">
        <div class="screen-header ${s.collapsed?'collapsed':''} ${s.id===State.editor.activeScreenId?'active':''}" onclick="Editor.selectScreen('${s.id}')">
          <svg class="chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" onclick="event.stopPropagation();Editor.toggleScreen('${s.id}')"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <div class="screen-thumb">${s.dataUrl?`<img src="${s.dataUrl}">`:''}</div>
          ${s.id === State.editor.renamingScreenId
            ? `<input class="screen-name-input" value="${escapeHtml(s.customName || ('Tela '+(si+1)))}" onclick="event.stopPropagation()" onblur="Editor.commitScreenRename(this,'${s.id}')" onkeydown="event.stopPropagation();if(event.key==='Enter'){event.preventDefault();this.blur();}else if(event.key==='Escape'){event.preventDefault();Editor.cancelScreenRename();}">`
            : `<span class="screen-name" ondblclick="event.stopPropagation();Editor.renameScreenStart('${s.id}')" title="Duplo-clique para renomear">${escapeHtml(s.customName || ('Tela '+(si+1)))}</span>`
          }
          <span class="step-count">${s.steps.length}</span>
          <button class="btn-icon btn-ghost" style="width:20px;height:20px;flex-shrink:0;" title="Excluir tela" onclick="event.stopPropagation();Editor.deleteScreen('${s.id}')">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
        <div class="screen-steps ${s.collapsed?'collapsed':''}">
          ${s.steps.map((st, i) => `
            <div class="step-item ${st.id===State.editor.activeStepId?'active':''}" onclick="Editor.selectStep('${s.id}','${st.id}')">
              <div class="step-badge">${i+1}</div>
              <span class="step-label">${escapeHtml(st.title||'Sem título')}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `).join('');
  },

  renderCanvas(){
    const sc = this.activeScreen();
    const empty = document.getElementById('canvas-empty');
    const wrap = document.getElementById('stage-wrap');
    const fab = document.getElementById('add-hotspot-fab');
    const toolbar = document.getElementById('elements-toolbar');
    const zoomControls = document.getElementById('zoom-controls');
    if(!sc){
      empty.style.display = 'block';
      wrap.style.display = 'none';
      fab.style.display = 'none';
      toolbar.style.display = 'none';
      zoomControls.style.display = 'none';
      document.getElementById('editor-canvas').classList.add('empty');
      return;
    }
    empty.style.display = 'none';
    wrap.style.display = 'block';
    fab.style.display = 'flex';
    toolbar.style.display = 'flex';
    zoomControls.style.display = 'flex';
    document.getElementById('editor-canvas').classList.remove('empty');
    wrap.style.transform = `scale(${State.editor.zoom})`;
    wrap.style.transformOrigin = 'top center';
    document.getElementById('zoom-level').textContent = Math.round(State.editor.zoom*100)+'%';
    toolbar.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.type === State.editor.placingType));
    const stage = document.getElementById('stage');
    stage.innerHTML = `<img src="${sc.dataUrl}" draggable="false">`;
    sc.steps.forEach((st, i) => {
      const isActive = st.id===State.editor.activeStepId;
      const div = document.createElement('div');
      div.className = 'hotspot' + (isActive?' selected':'');
      div.style.left = st.xPct+'%';
      div.style.top = st.yPct+'%';
      div.style.width = st.wPct+'%';
      div.style.height = st.hPct+'%';
      div.innerHTML = `<div class="hotspot-badge">${i+1}</div>`;
      div.addEventListener('mousedown', (e) => Editor.hotspotMouseDown(e, sc.id, st.id));
      if(isActive){
        ['nw','ne','sw','se'].forEach(corner => {
          const handle = document.createElement('div');
          handle.className = 'resize-handle ' + corner;
          handle.addEventListener('mousedown', (e) => Editor.resizeMouseDown(e, sc.id, st.id, corner));
          div.appendChild(handle);
        });
      }
      stage.appendChild(div);
    });

    // annotations: arrows share one SVG overlay, other types are positioned divs
    if(!sc.annotations) sc.annotations = [];
    const arrows = sc.annotations.filter(a => a.type === 'arrow');
    if(arrows.length){
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'stage-arrows-svg');
      svg.setAttribute('viewBox', '0 0 100 100');
      svg.setAttribute('preserveAspectRatio', 'none');
      svg.innerHTML = '<defs><marker id="ann-arrowhead" markerWidth="6" markerHeight="6" refX="4.5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#ff9500"/></marker></defs>';
      arrows.forEach(ann => {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', ann.xPct); line.setAttribute('y1', ann.yPct);
        line.setAttribute('x2', ann.x2Pct); line.setAttribute('y2', ann.y2Pct);
        line.setAttribute('stroke', '#ff9500'); line.setAttribute('stroke-width', '1.4');
        line.setAttribute('vector-effect', 'non-scaling-stroke');
        line.setAttribute('marker-end', 'url(#ann-arrowhead)');
        line.addEventListener('mousedown', (e) => Editor.annotationMouseDown(e, sc.id, ann.id));
        line.addEventListener('dblclick', (e) => { e.stopPropagation(); Editor.deleteAnnotation(sc.id, ann.id); });
        svg.appendChild(line);
      });
      stage.appendChild(svg);
    }
    sc.annotations.filter(a => a.type !== 'arrow').forEach(ann => {
      const div = document.createElement('div');
      div.className = 'annotation ann-wrap';
      div.style.left = ann.xPct + '%';
      div.style.top = ann.yPct + '%';
      div.innerHTML = annotationContentHTML(ann) + '<button class="ann-del" title="Remover">×</button>';
      div.addEventListener('mousedown', (e) => {
        if(e.target.closest('.ann-del')) return;
        Editor.annotationMouseDown(e, sc.id, ann.id);
      });
      div.querySelector('.ann-del').addEventListener('click', (e) => {
        e.stopPropagation();
        Editor.deleteAnnotation(sc.id, ann.id);
      });
      if(ANNOTATION_TYPES[ann.type].hasText){
        div.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          const text = prompt('Editar texto:', ann.text || '');
          if(text !== null){ ann.text = text.trim(); Editor.scheduleSave(); Editor.renderCanvas(); }
        });
      }
      stage.appendChild(div);
    });
  },

  // Selecting a hotspot happens on mousedown. If it's already the active one,
  // the same mousedown can turn into a drag-to-move (threshold-based, so a
  // plain click still just re-selects without moving anything).
  hotspotMouseDown(e, screenId, stepId){
    if(State.editor.drawMode || State.editor.placingType) return;
    e.stopPropagation();
    const alreadyActive = (State.editor.activeScreenId === screenId && State.editor.activeStepId === stepId);
    if(!alreadyActive){
      e.preventDefault();
      this.selectStep(screenId, stepId);
      return;
    }
    e.preventDefault();
    const div = e.currentTarget;
    const stageRect = document.getElementById('stage').getBoundingClientRect();
    const sc = this.tutorial().screens.find(s => s.id === screenId);
    const step = sc.steps.find(s => s.id === stepId);
    const startX = e.clientX, startY = e.clientY;
    const origX = step.xPct, origY = step.yPct;
    let moved = false;
    const onMove = (ev) => {
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      if(Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true;
      if(!moved) return;
      let nx = origX + (dx / stageRect.width) * 100;
      let ny = origY + (dy / stageRect.height) * 100;
      nx = Math.max(0, Math.min(nx, 100 - step.wPct));
      ny = Math.max(0, Math.min(ny, 100 - step.hPct));
      step.xPct = nx; step.yPct = ny;
      div.style.left = nx + '%';
      div.style.top = ny + '%';
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if(moved){ Editor.scheduleSave(); Editor.renderScreensTree(); }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  },

  resizeMouseDown(e, screenId, stepId, corner){
    if(State.editor.drawMode || State.editor.placingType) return;
    e.stopPropagation();
    e.preventDefault();
    const div = e.currentTarget.parentElement;
    const stageRect = document.getElementById('stage').getBoundingClientRect();
    const sc = this.tutorial().screens.find(s => s.id === screenId);
    const step = sc.steps.find(s => s.id === stepId);
    const startX = e.clientX, startY = e.clientY;
    const orig = { x: step.xPct, y: step.yPct, w: step.wPct, h: step.hPct };
    const minSize = 2;
    const onMove = (ev) => {
      const dxPct = ((ev.clientX - startX) / stageRect.width) * 100;
      const dyPct = ((ev.clientY - startY) / stageRect.height) * 100;
      let { x, y, w, h } = orig;
      if(corner.includes('e')) w = Math.max(minSize, orig.w + dxPct);
      if(corner.includes('s')) h = Math.max(minSize, orig.h + dyPct);
      if(corner.includes('w')){ w = Math.max(minSize, orig.w - dxPct); x = orig.x + (orig.w - w); }
      if(corner.includes('n')){ h = Math.max(minSize, orig.h - dyPct); y = orig.y + (orig.h - h); }
      x = Math.max(0, x); y = Math.max(0, y);
      w = Math.min(w, 100 - x); h = Math.min(h, 100 - y);
      step.xPct = x; step.yPct = y; step.wPct = w; step.hPct = h;
      div.style.left = x + '%'; div.style.top = y + '%';
      div.style.width = w + '%'; div.style.height = h + '%';
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      Editor.scheduleSave();
      Editor.renderScreensTree();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  },

  renderInspector(){
    const body = document.getElementById('inspector-body');
    const tab = State.editor.inspectorTab;
    document.querySelectorAll('.inspector-tab').forEach(el => el.classList.toggle('active', el.dataset.tab === tab));

    if(tab === 'style'){
      const step = this.activeStep();
      const target = step || State.editor.pendingRect;
      if(!target){
        body.innerHTML = `<div class="inspector-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="9"/></svg>
          <p>Selecione ou desenhe um passo para estilizar</p>
        </div>`;
        return;
      }
      const styles = ['pulse','glow','ripple','dot','ring','simple'];
      body.innerHTML = `
        <div class="field">
          <label>Estilo do destaque</label>
          <div class="hotspot-styles">
            ${styles.map(s => `
              <div class="hotspot-style ${(target.hotspotStyle||'pulse')===s?'active':''}" onclick="Editor.setStepStyle('${s}')">
                ${renderHotspotPreviewSVG(s)}
                <div class="hotspot-style-name">${s}</div>
              </div>
            `).join('')}
          </div>
        </div>
        <div class="field">
          <label>Zoom no destaque</label>
          <div class="zoom-pills">
            ${[[1,'Sem zoom'],[1.5,'1,5×'],[2,'2×'],[3,'3×']].map(([z,l]) => `
              <div class="zoom-pill ${(target.zoom||1)===z?'active':''}" onclick="Editor.setStepZoom(${z})">${l}</div>
            `).join('')}
          </div>
          <div class="v4-help" style="margin-top:8px;">A câmera aproxima da área marcada no Visualizar, no HTML e nos GIF/Vídeo animados (o PDF mostra a tela inteira).</div>
          <button class="btn btn-secondary btn-sm" style="margin-top:10px;" onclick="Editor.applyZoomToAll()">Aplicar este zoom a todos os passos</button>
        </div>
      `;
      return;
    }

    // step tab
    const step = this.activeStep();
    const pending = State.editor.pendingRect;

    if(!step && !pending){
      body.innerHTML = `<div class="inspector-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 12h8"/></svg>
        <p>Desenhe uma área na tela para criar um passo — ou clique num passo existente para editar.</p>
        <button class="btn btn-primary" style="margin-top:14px;" onclick="Editor.startDraw()">Desenhar área</button>
      </div>`;
      return;
    }

    const target = pending || step;
    const isPending = !!pending;
    const positions = [
      {v:'auto', l:'Auto'},{v:'bottom', l:'Abaixo'},{v:'top', l:'Acima'},{v:'right', l:'Direita'},{v:'left', l:'Esquerda'}
    ];
    body.innerHTML = `
      ${isPending ? '<div class="pending-alert"><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/><path d="M12 8v4M12 16h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>Novo passo — preencha e salve</div>' : ''}
      <div class="field">
        <label>Título</label>
        <input type="text" id="insp-title" value="${escapeHtml(target.title||'')}" placeholder="Ex: Clique no menu Acordo">
      </div>
      <div class="field">
        <label>Descrição</label>
        <textarea id="insp-text" placeholder="Explique o que fazer neste passo">${escapeHtml(target.text||'')}</textarea>
      </div>
      <div class="field">
        <label>Posição do balão</label>
        <div class="position-picker">
          ${positions.map(p => `
            <div class="pos-option ${(target.position||'auto')===p.v?'active':''}" data-pos="${p.v}" onclick="Editor.setStepField('position','${p.v}')">${p.l}</div>
          `).join('')}
        </div>
      </div>
      <div style="display:flex;gap:8px;margin-top:20px;">
        ${isPending ? `
          <button class="btn btn-secondary" style="flex:1" onclick="Editor.cancelPending()">Cancelar</button>
          <button class="btn btn-primary" style="flex:1" onclick="Editor.commitPending()">Salvar passo</button>
        ` : `
          <button class="btn btn-secondary btn-danger-ghost" style="flex:1" onclick="Editor.deleteStep()">Excluir</button>
          <button class="btn btn-secondary" style="flex:1" onclick="Editor.startDraw()">Redesenhar área</button>
        `}
      </div>
    `;
    const titleI = document.getElementById('insp-title');
    const textI = document.getElementById('insp-text');
    if(titleI) titleI.oninput = e => Editor.setStepField('title', e.target.value);
    if(textI) textI.oninput = e => Editor.setStepField('text', e.target.value);
  },

  renderTimeline(){
    const t = this.tutorial(); if(!t) return;
    const el = document.getElementById('timeline-inner');
    if(t.screens.length === 0){
      el.innerHTML = '<div style="color:var(--text-muted);font-size:12px;">Adicione uma tela para começar</div>';
      return;
    }
    el.innerHTML = t.screens.map((s, si) => `
      <div class="timeline-screen">
        <div class="timeline-screen-label">${escapeHtml(s.customName || ('Tela '+(si+1)))}</div>
        <div class="timeline-steps">
          ${s.steps.length === 0
            ? '<div style="padding:4px 12px;font-size:11px;color:var(--text-muted);">vazio</div>'
            : s.steps.map((st, i) => `
                ${i>0?'<div class="timeline-connector"></div>':''}
                <div class="timeline-step ${st.id===State.editor.activeStepId?'active':''}" onclick="Editor.selectStep('${s.id}','${st.id}')">${i+1}</div>
              `).join('')
          }
        </div>
      </div>
    `).join('') + `<button class="timeline-screen-plus" onclick="Editor.upload()">+ Tela</button>`;
  },

  selectScreen(id){
    State.editor.activeScreenId = id;
    State.editor.activeStepId = null;
    State.editor.pendingRect = null;
    this.render();
  },
  toggleScreen(id){
    const t = this.tutorial();
    const s = t.screens.find(sc => sc.id === id);
    if(s){ s.collapsed = !s.collapsed; this.renderScreensTree(); }
  },
  deleteScreen(id){
    const t = this.tutorial(); if(!t) return;
    const s = t.screens.find(sc => sc.id === id);
    if(!s) return;
    const msg = s.steps.length
      ? `Excluir esta tela e os ${s.steps.length} passo${s.steps.length!==1?'s':''} associados a ela?`
      : 'Excluir esta tela?';
    if(!confirm(msg)) return;
    const idx = t.screens.findIndex(sc => sc.id === id);
    State.editor.lastDeleted = { type:'screen', index: idx, data: s };
    t.screens = t.screens.filter(sc => sc.id !== id);
    if(State.editor.activeScreenId === id){
      State.editor.activeScreenId = t.screens[0] ? t.screens[0].id : null;
      State.editor.activeStepId = null;
      State.editor.pendingRect = null;
    }
    this.scheduleSave();
    this.render();
    toast('Tela excluída');
  },
  renameScreenStart(id){
    State.editor.renamingScreenId = id;
    this.renderScreensTree();
    setTimeout(() => {
      const inp = document.querySelector('.screen-name-input');
      if(inp){ inp.focus(); inp.select(); }
    }, 10);
  },
  commitScreenRename(inputEl, screenId){
    const t = this.tutorial(); if(!t) return;
    const sc = t.screens.find(s => s.id === screenId);
    if(sc){
      const val = inputEl.value.trim();
      sc.customName = val || null;
      this.scheduleSave();
    }
    State.editor.renamingScreenId = null;
    this.renderScreensTree();
    this.renderTimeline();
  },
  cancelScreenRename(){
    State.editor.renamingScreenId = null;
    this.renderScreensTree();
  },
  zoomBy(delta){
    if(!this.activeScreen()) return;
    State.editor.zoom = Math.max(0.5, Math.min(2.5, State.editor.zoom + delta));
    this.renderCanvas();
  },
  zoomReset(){
    State.editor.zoom = 1;
    this.renderCanvas();
  },
  undo(){
    const ld = State.editor.lastDeleted;
    if(!ld){ toast('Nada para desfazer'); return; }
    const t = this.tutorial(); if(!t) return;
    if(ld.type === 'step'){
      const sc = t.screens.find(s => s.id === ld.screenId);
      if(sc) sc.steps.splice(Math.min(ld.index, sc.steps.length), 0, ld.data);
    } else if(ld.type === 'screen'){
      t.screens.splice(Math.min(ld.index, t.screens.length), 0, ld.data);
    } else if(ld.type === 'annotation'){
      const sc = t.screens.find(s => s.id === ld.screenId);
      if(sc){ if(!sc.annotations) sc.annotations = []; sc.annotations.splice(Math.min(ld.index, sc.annotations.length), 0, ld.data); }
    }
    State.editor.lastDeleted = null;
    this.scheduleSave();
    this.render();
    toast('Desfeito');
  },
  selectStep(screenId, stepId){
    State.editor.activeScreenId = screenId;
    State.editor.activeStepId = stepId;
    State.editor.pendingRect = null;
    State.editor.inspectorTab = 'step';
    this.render();
  },
  switchTab(tab){ State.editor.inspectorTab = tab; this.renderInspector(); },

  setStepField(field, value){
    const step = this.activeStep();
    if(step){ step[field] = value; this.scheduleSave(); this.renderScreensTree(); }
    else if(State.editor.pendingRect){ State.editor.pendingRect[field] = value; }
    if(field === 'position'){ this.renderInspector(); }
  },
  setStepStyle(style){
    const step = this.activeStep();
    if(step){ step.hotspotStyle = style; this.scheduleSave(); this.renderInspector(); return; }
    if(State.editor.pendingRect){ State.editor.pendingRect.hotspotStyle = style; this.renderInspector(); }
  },
  setStepZoom(z){
    const step = this.activeStep();
    if(step){ step.zoom = z; this.scheduleSave(); this.renderInspector(); return; }
    if(State.editor.pendingRect){ State.editor.pendingRect.zoom = z; this.renderInspector(); }
  },
  applyZoomToAll(){
    const t = this.tutorial(); if(!t) return;
    const ref = this.activeStep() || State.editor.pendingRect;
    const z = (ref && ref.zoom) || 1;
    t.screens.forEach(sc => sc.steps.forEach(st => { st.zoom = z; }));
    this.scheduleSave(); this.renderInspector();
    toast(z === 1 ? 'Zoom removido de todos os passos' : 'Zoom ' + z + '× aplicado a todos os passos');
  },
  deleteStep(){
    const sc = this.activeScreen(); if(!sc) return;
    if(!confirm('Excluir este passo?')) return;
    const idx = sc.steps.findIndex(st => st.id === State.editor.activeStepId);
    if(idx === -1) return;
    State.editor.lastDeleted = { type:'step', screenId: sc.id, index: idx, data: sc.steps[idx] };
    sc.steps = sc.steps.filter(st => st.id !== State.editor.activeStepId);
    State.editor.activeStepId = null;
    this.scheduleSave();
    this.render();
  },

  upload(){
    const inp = document.getElementById('file-input');
    inp.value = '';
    inp.click();
  },
  handleFiles(files){
    const t = this.tutorial(); if(!t) return;
    Array.from(files).forEach(file => {
      if(!file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = ev => {
        const dataUrl = ev.target.result;
        const img = new Image();
        img.onload = () => {
          const s = {id: uid(), name: file.name, dataUrl, imgEl: img, steps: [], annotations: [], collapsed: false};
          t.screens.push(s);
          State.editor.activeScreenId = s.id;
          State.editor.activeStepId = null;
          this.scheduleSave();
          this.render();
        };
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);
    });
  },

  startDraw(){
    if(!this.activeScreen()){ toast('Adicione uma tela primeiro'); return; }
    this.stopPlacing();
    State.editor.drawMode = true;
    const stage = document.getElementById('stage');
    stage.classList.add('drawing');
    toast('Clique e arraste sobre a tela');
  },
  stopDraw(){ State.editor.drawMode = false; document.getElementById('stage').classList.remove('drawing'); },
  cancelPending(){ State.editor.pendingRect = null; this.renderInspector(); this.renderCanvas(); },

  startPlacing(type){
    if(!this.activeScreen()){ toast('Adicione uma tela primeiro'); return; }
    this.stopDraw();
    State.editor.placingType = type;
    document.getElementById('stage').classList.add('drawing');
    document.getElementById('elements-toolbar').querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.type === type));
    const meta = ANNOTATION_TYPES[type];
    toast(meta.twoPoint ? 'Clique e arraste para desenhar a seta' : 'Clique na imagem para posicionar');
  },
  stopPlacing(){
    State.editor.placingType = null;
    document.getElementById('stage').classList.remove('drawing');
    const toolbar = document.getElementById('elements-toolbar');
    if(toolbar) toolbar.querySelectorAll('button').forEach(b => b.classList.remove('active'));
  },
  placeAnnotation(type, xPct, yPct, x2Pct, y2Pct){
    const sc = this.activeScreen(); if(!sc) return;
    if(!sc.annotations) sc.annotations = [];
    const meta = ANNOTATION_TYPES[type];
    const ann = { id: uid(), type, xPct, yPct };
    if(meta.twoPoint){ ann.x2Pct = x2Pct; ann.y2Pct = y2Pct; }
    if(meta.needsFile){
      // Imagem livre (logo, ícone, recorte): escolhe o arquivo e posiciona no ponto clicado
      this.stopPlacing();
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/*'; inp.style.display = 'none';
      document.body.appendChild(inp);
      inp.onchange = () => {
        const f = inp.files[0]; inp.remove();
        if(!f || !f.type.startsWith('image/')) return;
        const rd = new FileReader();
        rd.onload = ev => {
          ann.dataUrl = ev.target.result;
          sc.annotations.push(ann);
          this.scheduleSave(); this.renderCanvas(); toast('Imagem adicionada');
        };
        rd.readAsDataURL(f);
      };
      inp.click();
      return;
    }
    if(meta.hasText){
      const text = prompt(meta.promptLabel, '');
      if(text === null){ this.stopPlacing(); return; }
      ann.text = text.trim();
      if(!ann.text){ this.stopPlacing(); return; }
    }
    sc.annotations.push(ann);
    this.stopPlacing();
    this.scheduleSave();
    this.renderCanvas();
    toast('Elemento adicionado');
  },
  annotationMouseDown(e, screenId, annId){
    if(State.editor.drawMode || State.editor.placingType) return;
    e.stopPropagation();
    e.preventDefault();
    const stageRect = document.getElementById('stage').getBoundingClientRect();
    const sc = this.tutorial().screens.find(s => s.id === screenId);
    const ann = sc.annotations.find(a => a.id === annId);
    if(!ann) return;
    const startX = e.clientX, startY = e.clientY;
    const orig = { xPct: ann.xPct, yPct: ann.yPct, x2Pct: ann.x2Pct, y2Pct: ann.y2Pct };
    let moved = false;
    const onMove = (ev) => {
      const dx = ((ev.clientX - startX) / stageRect.width) * 100;
      const dy = ((ev.clientY - startY) / stageRect.height) * 100;
      if(Math.abs(dx) > 0.3 || Math.abs(dy) > 0.3) moved = true;
      if(!moved) return;
      ann.xPct = Math.max(0, Math.min(100, orig.xPct + dx));
      ann.yPct = Math.max(0, Math.min(100, orig.yPct + dy));
      if(ann.type === 'arrow'){
        ann.x2Pct = Math.max(0, Math.min(100, orig.x2Pct + dx));
        ann.y2Pct = Math.max(0, Math.min(100, orig.y2Pct + dy));
      }
      Editor.renderCanvas();
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if(moved) Editor.scheduleSave();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  },
  deleteAnnotation(screenId, annId){
    const sc = this.tutorial().screens.find(s => s.id === screenId);
    if(!sc) return;
    const idx = (sc.annotations||[]).findIndex(a => a.id === annId);
    if(idx === -1) return;
    State.editor.lastDeleted = { type:'annotation', screenId, index: idx, data: sc.annotations[idx] };
    sc.annotations = (sc.annotations || []).filter(a => a.id !== annId);
    this.scheduleSave();
    this.renderCanvas();
    toast('Elemento removido');
  },
  commitPending(){
    const rect = State.editor.pendingRect;
    if(!rect || !rect.title && !rect.text){ toast('Escreva ao menos um título'); return; }
    const sc = this.activeScreen();
    const step = { id: uid(), ...rect };
    sc.steps.push(step);
    State.editor.pendingRect = null;
    State.editor.activeStepId = step.id;
    this.scheduleSave();
    this.render();
    toast('Passo adicionado');
  },

  play(){
    const t = this.tutorial();
    const total = t.screens.reduce((a,s) => a + s.steps.length, 0);
    if(total === 0){ toast('Adicione ao menos um passo'); return; }
    Player.play(t);
  },
  share(){ Modal.open('share'); },
  copyEmbed(){ toast('Recurso em desenvolvimento'); },

  brandOpen(){
    const t = this.tutorial(); if(!t) return;
    if(!t.brand) t.brand = {name:'', logo:''};
    document.getElementById('brand-name-input').value = t.brand.name || '';
    this._pendingBrandLogo = t.brand.logo || '';
    this.brandRenderPreview();
    Modal.open('brand');
  },
  brandRenderPreview(){
    const preview = document.getElementById('brand-logo-preview');
    const removeBtn = document.getElementById('brand-logo-remove-btn');
    if(this._pendingBrandLogo){
      preview.innerHTML = `<img src="${this._pendingBrandLogo}">`;
      removeBtn.style.display = 'block';
    } else {
      preview.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="1.5" fill="currentColor" stroke="none"/><path d="M21 15l-5-5-9 9"/></svg>';
      removeBtn.style.display = 'none';
    }
  },
  brandRemoveLogo(){
    this._pendingBrandLogo = '';
    this.brandRenderPreview();
  },
  brandSave(){
    const t = this.tutorial(); if(!t) return;
    if(!t.brand) t.brand = {name:'', logo:''};
    t.brand.name = document.getElementById('brand-name-input').value.trim();
    t.brand.logo = this._pendingBrandLogo || '';
    this.scheduleSave();
    Modal.close('brand');
    toast('Marca do tutorial salva');
  },

  scheduleSave(){
    this.markSaving();
    clearTimeout(State.editor.saveTimer);
    State.editor.saveTimer = setTimeout(() => {
      const t = this.tutorial();
      if(t) t.updatedAt = now();
      Persist.save();
      this.markSaved();
    }, 400);
  },
  markSaving(){ document.getElementById('editor-savestate').classList.add('saving'); document.querySelector('#editor-savestate span:last-child').textContent = 'Salvando'; },
  markSaved(){ document.getElementById('editor-savestate').classList.remove('saving'); document.querySelector('#editor-savestate span:last-child').textContent = 'Salvo'; },

  // Export flow
  exportOpen(){ Modal.open('export'); this.showExportView('choose'); },
  showExportView(name){
    ['choose','progress','done'].forEach(v => {
      document.getElementById('export-'+v+'-view').style.display = v===name?'block':'none';
    });
  },
  exportBack(){ this.showExportView('choose'); },
  cancelExport(){ this._cancelled = true; this.showExportView('choose'); },
  exportChoose(fmt){
    const t = this.tutorial();
    const totalSteps = t ? t.screens.reduce((a,s)=>a+s.steps.length, 0) : 0;
    if(totalSteps === 0){
      toast('Adicione ao menos um passo antes de exportar');
      Modal.close('share');
      return;
    }
    Modal.close('share');
    Modal.open('export');
    const dur = Math.max(1, parseInt(document.getElementById('step-duration').value)||4);
    if(fmt==='html') return this.runHTML();
    if(fmt==='pdf') return this.runPDF();
    if(fmt==='gif') return this.runGIF(dur);
    if(fmt==='video') return this.runVideo(dur);
  }
};

// Envio de prints: listener fixo (funciona também quando o seletor é acionado por fora do botão)
document.getElementById('file-input').addEventListener('change', e => {
  if(e.target.files && e.target.files.length) Editor.handleFiles(e.target.files);
});

// Editor title inline edit
document.getElementById('editor-title').addEventListener('input', e => {
  const t = Editor.tutorial(); if(t){ t.name = e.target.value; Editor.scheduleSave(); }
  e.target.title = e.target.value;
});

// Brand logo upload
document.getElementById('brand-logo-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if(!file || !file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = ev => {
    Editor._pendingBrandLogo = ev.target.result;
    Editor.brandRenderPreview();
  };
  reader.readAsDataURL(file);
  e.target.value = '';
});

// Stage drag-to-draw
(function(){
  const stageEl = document.getElementById('stage');
  let dragStart = null;
  stageEl.addEventListener('mousedown', e => {
    if(!State.editor.drawMode) return;
    const r = stageEl.getBoundingClientRect();
    dragStart = {x: e.clientX-r.left, y: e.clientY-r.top};
    const live = document.createElement('div');
    live.className = 'draw-preview'; live.id = 'draw-live';
    live.style.left = dragStart.x+'px'; live.style.top = dragStart.y+'px';
    stageEl.appendChild(live);
  });
  stageEl.addEventListener('mousemove', e => {
    if(!dragStart) return;
    const r = stageEl.getBoundingClientRect();
    const cx = e.clientX-r.left, cy = e.clientY-r.top;
    const live = document.getElementById('draw-live'); if(!live) return;
    const x = Math.min(dragStart.x, cx), y = Math.min(dragStart.y, cy);
    const w = Math.abs(cx-dragStart.x), h = Math.abs(cy-dragStart.y);
    live.style.left = x+'px'; live.style.top = y+'px';
    live.style.width = w+'px'; live.style.height = h+'px';
  });
  stageEl.addEventListener('mouseup', e => {
    if(!dragStart) return;
    const r = stageEl.getBoundingClientRect();
    const cx = Math.max(0, Math.min(e.clientX-r.left, r.width));
    const cy = Math.max(0, Math.min(e.clientY-r.top, r.height));
    const x = Math.min(dragStart.x, cx), y = Math.min(dragStart.y, cy);
    const w = Math.abs(cx-dragStart.x), h = Math.abs(cy-dragStart.y);
    const live = document.getElementById('draw-live'); if(live) live.remove();
    dragStart = null;
    if(w < r.width*0.02 || h < r.height*0.02){ Editor.stopDraw(); return; }
    State.editor.pendingRect = {
      xPct: (x/r.width)*100, yPct: (y/r.height)*100,
      wPct: (w/r.width)*100, hPct: (h/r.height)*100,
      title:'', text:'', position:'auto', hotspotStyle: State.defaultHotspotStyle
    };
    State.editor.activeStepId = null;
    State.editor.inspectorTab = 'step';
    Editor.stopDraw();
    Editor.renderInspector();
    Editor.renderCanvas();
    // draw preview rect on stage
    const preview = document.createElement('div');
    preview.className = 'hotspot selected'; preview.id = 'pending-preview';
    preview.style.left = State.editor.pendingRect.xPct+'%';
    preview.style.top = State.editor.pendingRect.yPct+'%';
    preview.style.width = State.editor.pendingRect.wPct+'%';
    preview.style.height = State.editor.pendingRect.hPct+'%';
    preview.innerHTML = '<div class="hotspot-badge" style="background:#ff9500">•</div>';
    stageEl.appendChild(preview);
  });
})();

// Ctrl/Cmd + scroll wheel to zoom the canvas
document.getElementById('editor-canvas').addEventListener('wheel', e => {
  if(!(e.ctrlKey || e.metaKey)) return;
  if(!Editor.activeScreen()) return;
  e.preventDefault();
  Editor.zoomBy(e.deltaY < 0 ? 0.1 : -0.1);
}, { passive: false });

// Keyboard shortcuts (editor only; ignored while typing in an input/textarea)
document.addEventListener('keydown', e => {
  if(!document.getElementById('editor').classList.contains('open')) return;
  const tag = (document.activeElement && document.activeElement.tagName || '').toLowerCase();
  if(tag === 'input' || tag === 'textarea') return;

  if(document.getElementById('player').classList.contains('open')) return;
  if(document.querySelector('.modal-backdrop.on')) return;
  if(Shortcuts.dispatch(e)) return;
  if(e.key === 'Backspace' && State.editor.activeStepId){
    e.preventDefault();
    Editor.deleteStep();
    return;
  }
  if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key) && State.editor.activeStepId){
    const step = Editor.activeStep();
    if(!step) return;
    e.preventDefault();
    const delta = e.shiftKey ? 2 : 0.4;
    if(e.key === 'ArrowUp') step.yPct = Math.max(0, step.yPct - delta);
    if(e.key === 'ArrowDown') step.yPct = Math.min(100 - step.hPct, step.yPct + delta);
    if(e.key === 'ArrowLeft') step.xPct = Math.max(0, step.xPct - delta);
    if(e.key === 'ArrowRight') step.xPct = Math.min(100 - step.wPct, step.xPct + delta);
    Editor.renderCanvas();
    Editor.scheduleSave();
  }
});

// Element placement: single click for point-types, drag for arrows
(function(){
  const stageEl = document.getElementById('stage');
  let arrowStart = null;

  stageEl.addEventListener('mousedown', e => {
    if(State.editor.placingType !== 'arrow') return;
    const r = stageEl.getBoundingClientRect();
    arrowStart = {x: e.clientX-r.left, y: e.clientY-r.top};
    const live = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    live.setAttribute('class', 'stage-arrows-svg'); live.id = 'arrow-live-svg';
    live.setAttribute('viewBox', '0 0 ' + r.width + ' ' + r.height);
    live.innerHTML = `<line id="arrow-live-line" x1="${arrowStart.x}" y1="${arrowStart.y}" x2="${arrowStart.x}" y2="${arrowStart.y}" stroke="#ff9500" stroke-width="3" stroke-dasharray="6 4"/>`;
    stageEl.appendChild(live);
  });
  stageEl.addEventListener('mousemove', e => {
    if(!arrowStart) return;
    const r = stageEl.getBoundingClientRect();
    const line = document.getElementById('arrow-live-line'); if(!line) return;
    line.setAttribute('x2', e.clientX-r.left); line.setAttribute('y2', e.clientY-r.top);
  });
  stageEl.addEventListener('mouseup', e => {
    if(!arrowStart) return;
    const r = stageEl.getBoundingClientRect();
    const cx = Math.max(0, Math.min(e.clientX-r.left, r.width));
    const cy = Math.max(0, Math.min(e.clientY-r.top, r.height));
    const live = document.getElementById('arrow-live-svg'); if(live) live.remove();
    const x1Pct = (arrowStart.x/r.width)*100, y1Pct = (arrowStart.y/r.height)*100;
    const x2Pct = (cx/r.width)*100, y2Pct = (cy/r.height)*100;
    arrowStart = null;
    const dist = Math.hypot(x2Pct-x1Pct, y2Pct-y1Pct);
    if(dist < 2){ Editor.stopPlacing(); return; }
    Editor.placeAnnotation('arrow', x1Pct, y1Pct, x2Pct, y2Pct);
  });

  stageEl.addEventListener('click', e => {
    const type = State.editor.placingType;
    if(!type || ANNOTATION_TYPES[type].twoPoint) return;
    const r = stageEl.getBoundingClientRect();
    const xPct = ((e.clientX-r.left)/r.width)*100;
    const yPct = ((e.clientY-r.top)/r.height)*100;
    Editor.placeAnnotation(type, xPct, yPct);
  });
})();

// Auto-draw mode when no step selected: clicking on canvas triggers draw
document.getElementById('editor-canvas').addEventListener('dblclick', e => {
  if(Editor.activeScreen() && !State.editor.drawMode) Editor.startDraw();
});

/* ===========================================================
   PLAYER
   =========================================================== */
const Player = {
  tutorial:null, steps:[], i:0,
  play(t){
    this.tutorial = t;
    this.steps = [];
    t.screens.forEach(s => s.steps.forEach(st => this.steps.push({...st, screenId: s.id, dataUrl: s.dataUrl, annotations: s.annotations||[]})));
    if(this.steps.length === 0){ toast('Nenhum passo'); return; }
    this.i = 0;
    this._zPrev = 'none'; this._cur = null;
    document.getElementById('player').classList.add('open');
    document.getElementById('player-title').textContent = t.name;
    this.show();
    window.addEventListener('resize', this._resize = () => this.position());
    document.addEventListener('keydown', this._keydown = e => {
      if(e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); this.next(); }
      else if(e.key === 'ArrowLeft') { e.preventDefault(); this.prev(); }
      else if(e.key === 'Escape') this.close();
    });
  },
  close(){
    document.getElementById('player').classList.remove('open');
    clearTimeout(this._ct);
    if(this._cursorEl) this._cursorEl.classList.remove('on');
    document.querySelectorAll('.player-click').forEach(el => el.remove());
    const im = document.getElementById('player-img'); if(im){ im.style.transform = 'none'; }
    this._zPrev = 'none'; this._cur = null;
    window.removeEventListener('resize', this._resize);
    document.removeEventListener('keydown', this._keydown);
  },
  next(){ if(this.i >= this.steps.length-1) return this.close(); this.i++; this.show(); },
  prev(){ if(this.i === 0) return; this.i--; this.show(); },
  show(){
    const step = this.steps[this.i];
    const img = document.getElementById('player-img');
    const tooltip = document.getElementById('player-tooltip');
    this._fromShow = true;
    if(img.getAttribute('data-cur') !== step.dataUrl){
      img.classList.add('transitioning');
      setTimeout(() => {
        // nova tela: zera o zoom sem animar (evita "voar" de uma tela para outra)
        img.style.transition = 'none'; img.style.transform = 'none'; this._zPrev = 'none';
        void img.offsetWidth; img.style.transition = '';
        img.src = step.dataUrl;
        img.setAttribute('data-cur', step.dataUrl);
        img.onload = () => {
          img.classList.remove('transitioning');
          requestAnimationFrame(() => requestAnimationFrame(() => this.position()));
        };
      }, 150);
    } else {
      requestAnimationFrame(() => this.position());
    }
    // fade tooltip briefly
    tooltip.classList.add('entering');
    setTimeout(() => tooltip.classList.remove('entering'), 30);
  },
  moveCursor(tx, ty, animate){
    let c = this._cursorEl;
    if(!c){
      c = this._cursorEl = document.createElement('div');
      c.className = 'player-cursor';
      c.innerHTML = '<svg width="24" height="28" viewBox="0 0 12 20" fill="none"><path d="M0.5 0.8v14.6l3.6-3.4 2.4 5.8 2.2-.9-2.4-5.7h5L0.5 0.8z" fill="#fff" stroke="#1d1d1f" stroke-width="1" stroke-linejoin="round"/></svg>';
      document.getElementById('player').appendChild(c);
    }
    if(!ExportOpts.cursor){ c.classList.remove('on'); return; }
    clearTimeout(this._ct);
    if(!animate){
      c.style.transition = 'none';
      c.style.transform = `translate(${tx}px,${ty}px)`;
      c.classList.add('on'); this._cur = {x:tx, y:ty};
      void c.offsetWidth; c.style.transition = '';
      return;
    }
    const from = this._cur || { x: tx - 180, y: ty + 150 };
    c.style.transition = 'none';
    c.style.transform = `translate(${from.x}px,${from.y}px)`;
    c.classList.add('on');
    void c.offsetWidth;
    c.style.transition = '';
    c.style.transform = `translate(${tx}px,${ty}px)`;
    this._cur = {x:tx, y:ty};
    this._ct = setTimeout(() => {
      const ping = document.createElement('div');
      ping.className = 'player-click';
      ping.style.left = tx + 'px'; ping.style.top = ty + 'px';
      ping.addEventListener('animationend', () => ping.remove());
      document.getElementById('player').appendChild(ping);
    }, 700);
  },
  position(){
    const step = this.steps[this.i];
    const img = document.getElementById('player-img');
    const fromShow = !!this._fromShow; this._fromShow = false;

    // 1) mede a imagem SEM zoom (restaurando depois o transform anterior para animar a partir dele)
    img.style.transition = 'none';
    img.style.transform = 'none';
    const r0 = img.getBoundingClientRect();
    img.style.transform = this._zPrev || 'none';
    void img.offsetWidth;
    img.style.transition = '';
    // 2) calcula o zoom do passo: leva o centro do destaque para o centro da tela
    const z = (ExportOpts.zoom && step.zoom > 1) ? step.zoom : 1;
    let ztx = 0, zty = 0;
    if(z > 1){
      const lcx = (step.xPct + step.wPct/2)/100*r0.width;
      const lcy = (step.yPct + step.hPct/2)/100*r0.height;
      ztx = window.innerWidth/2 - r0.left - lcx*z;
      zty = window.innerHeight*0.44 - r0.top - lcy*z;
    }
    const zT = z > 1 ? `translate(${ztx}px,${zty}px) scale(${z})` : 'none';
    img.style.transform = zT; this._zPrev = zT;
    // 3) a partir daqui tudo usa o retângulo já com zoom
    const r = { left: r0.left + ztx, top: r0.top + zty, width: r0.width*z, height: r0.height*z };
    const pad = 6;
    const rx = r.left + (step.xPct/100)*r.width - pad;
    const ry = r.top + (step.yPct/100)*r.height - pad;
    const rw = (step.wPct/100)*r.width + pad*2;
    const rh = (step.hPct/100)*r.height + pad*2;

    const sp = document.getElementById('player-spotlight');
    sp.style.left = rx+'px'; sp.style.top = ry+'px';
    sp.style.width = rw+'px'; sp.style.height = rh+'px';

    // hotspot (animated)
    const hs = document.getElementById('player-hotspot');
    hs.className = 'player-hotspot ' + (step.hotspotStyle||'pulse');
    if(step.hotspotStyle === 'dot'){
      const s = Math.min(rw, rh) * 0.5;
      hs.style.width = s+'px'; hs.style.height = s+'px';
      hs.style.left = (rx + rw/2 - s/2)+'px';
      hs.style.top = (ry + rh/2 - s/2)+'px';
    } else {
      hs.style.left = rx+'px'; hs.style.top = ry+'px';
      hs.style.width = rw+'px'; hs.style.height = rh+'px';
    }

    this.moveCursor(rx + rw/2, ry + rh/2, fromShow);

    // top progress
    document.getElementById('player-progress-fill').style.width = ((this.i+1)/this.steps.length*100)+'%';
    document.getElementById('player-counter').textContent = `${this.i+1} / ${this.steps.length}`;

    // free-floating annotations for this step's screen
    const annContainer = document.getElementById('player-annotations');
    annContainer.innerHTML = '';
    const arrowAnns = (step.annotations||[]).filter(a => a.type === 'arrow');
    if(arrowAnns.length){
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'player-arrows-svg');
      svg.style.left = r.left+'px'; svg.style.top = r.top+'px';
      svg.style.width = r.width+'px'; svg.style.height = r.height+'px';
      svg.setAttribute('viewBox', '0 0 100 100');
      svg.setAttribute('preserveAspectRatio', 'none');
      svg.innerHTML = '<defs><marker id="player-arrowhead" markerWidth="6" markerHeight="6" refX="4.5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#ff9500"/></marker></defs>' +
        arrowAnns.map(a => `<line x1="${a.xPct}" y1="${a.yPct}" x2="${a.x2Pct}" y2="${a.y2Pct}" stroke="#ff9500" stroke-width="1.2" vector-effect="non-scaling-stroke" marker-end="url(#player-arrowhead)"/>`).join('');
      annContainer.appendChild(svg);
    }
    (step.annotations||[]).filter(a => a.type !== 'arrow').forEach(a => {
      const el = document.createElement('div');
      el.className = 'player-annotation';
      el.style.left = (r.left + (a.xPct/100)*r.width) + 'px';
      el.style.top = (r.top + (a.yPct/100)*r.height) + 'px';
      el.innerHTML = annotationContentHTML(a);
      annContainer.appendChild(el);
    });

    // tooltip content
    document.getElementById('tooltip-counter').textContent = `Passo ${this.i+1} de ${this.steps.length}`;
    document.getElementById('tooltip-title').textContent = step.title || '';
    document.getElementById('tooltip-text').textContent = step.text || '';
    document.getElementById('tooltip-progress-fill').style.width = ((this.i+1)/this.steps.length*100)+'%';

    // dots
    document.getElementById('tooltip-dots').innerHTML = this.steps.map((_,idx) =>
      `<div class="tooltip-dot ${idx===this.i?'on':''}"></div>`).join('');

    // buttons
    document.getElementById('tooltip-prev').disabled = this.i === 0;
    document.getElementById('tooltip-next').textContent = this.i === this.steps.length-1 ? 'Concluir' : 'Próximo';

    // tooltip position
    const tt = document.getElementById('player-tooltip');
    const ttW = 340, ttH = tt.offsetHeight || 200, gap = 22;
    let pos = step.position || 'auto';
    const cx = rx+pad, cy = ry+pad, cw = rw-pad*2, ch = rh-pad*2;
    if(pos === 'auto'){
      if(cy + ch + ttH + gap < window.innerHeight - 20) pos = 'bottom';
      else if(cy - ttH - gap > 60) pos = 'top';
      else if(cx + cw + ttW + gap < window.innerWidth - 20) pos = 'right';
      else pos = 'left';
    }
    let top, left;
    if(pos === 'bottom'){ top = cy + ch + gap; left = cx; }
    else if(pos === 'top'){ top = cy - ttH - gap; left = cx; }
    else if(pos === 'right'){ top = cy; left = cx + cw + gap; }
    else { top = cy; left = cx - ttW - gap; }
    left = Math.max(20, Math.min(left, window.innerWidth - ttW - 20));
    top = Math.max(60, Math.min(top, window.innerHeight - ttH - 20));
    tt.style.left = left+'px'; tt.style.top = top+'px';
  }
};

/* ===========================================================
   EXPORT — HTML / PDF / GIF / VIDEO (preservado)
   =========================================================== */
Editor._cancelled = false;

function showProgress(title, sub){
  Editor.showExportView('progress');
  document.getElementById('progress-title').textContent = title;
  document.getElementById('progress-sub').textContent = sub || 'Isso pode levar alguns segundos';
  document.getElementById('progress-fill').style.width = '0%';
  document.getElementById('progress-status').textContent = 'Preparando...';
  Editor._cancelled = false;
}
function updateProg(pct, status){
  document.getElementById('progress-fill').style.width = Math.round(pct*100)+'%';
  if(status) document.getElementById('progress-status').textContent = status;
}
function showDone(sub){
  Editor.showExportView('done');
  document.getElementById('done-sub').textContent = sub;
}
function downloadBlob(blob, name){
  try { ExportLog.add(name); } catch(e){}
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

function collectStepsForExport(){
  const t = Editor.tutorial();
  const all = [];
  t.screens.forEach(s => s.steps.forEach(st => all.push({...st, dataUrl: s.dataUrl, imgEl: s.imgEl, annotations: s.annotations||[]})));
  return { tutorial: t, steps: all };
}

function preloadBrandLogo(brand){
  return new Promise(resolve => {
    if(!brand || !brand.logo){ resolve(null); return; }
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = brand.logo;
  });
}

function roundRectPath(ctx, x, y, w, h, r){
  ctx.beginPath();
  roundRectSub(ctx, x, y, w, h, r);
}
// só acrescenta o retângulo arredondado ao caminho atual (sem beginPath) — usado no recorte "evenodd"
function roundRectSub(ctx, x, y, w, h, r){
  r = Math.max(0, Math.min(r, w/2, h/2));
  ctx.moveTo(x+r, y);
  ctx.lineTo(x+w-r, y);
  ctx.quadraticCurveTo(x+w, y, x+w, y+r);
  ctx.lineTo(x+w, y+h-r);
  ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
  ctx.lineTo(x+r, y+h);
  ctx.quadraticCurveTo(x, y+h, x, y+h-r);
  ctx.lineTo(x, y+r);
  ctx.quadraticCurveTo(x, y, x+r, y);
  ctx.closePath();
}
function wrapText(ctx, text, maxWidth){
  if(!text) return [];
  const words = text.split(/\s+/);
  const lines = [];
  let cur = '';
  for(const w of words){
    const test = cur ? cur+' '+w : w;
    if(ctx.measureText(test).width > maxWidth && cur){ lines.push(cur); cur = w; }
    else cur = test;
  }
  if(cur) lines.push(cur);
  return lines;
}

const _annImgCache = new WeakMap();
function annImageFor(ann){
  if(!ann.dataUrl) return null;
  let im = _annImgCache.get(ann);
  if(!im){ im = new Image(); im.src = ann.dataUrl; _annImgCache.set(ann, im); }
  return im;
}

function drawAnnotationOnCanvas(ctx, ann, imgX, imgY, imgW, imgH){
  const px = imgX + (ann.xPct/100)*imgW;
  const py = imgY + (ann.yPct/100)*imgH;
  const s = Math.max(0.6, Math.min(imgW, imgH) / 900); // rough scale factor

  if(ann.type === 'arrow'){
    const px2 = imgX + (ann.x2Pct/100)*imgW;
    const py2 = imgY + (ann.y2Pct/100)*imgH;
    ctx.save();
    ctx.strokeStyle = '#ff9500'; ctx.fillStyle = '#ff9500';
    ctx.lineWidth = 4*s; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px2, py2); ctx.stroke();
    const angle = Math.atan2(py2-py, px2-px);
    const headLen = 16*s;
    ctx.beginPath();
    ctx.moveTo(px2, py2);
    ctx.lineTo(px2 - headLen*Math.cos(angle-Math.PI/7), py2 - headLen*Math.sin(angle-Math.PI/7));
    ctx.lineTo(px2 - headLen*Math.cos(angle+Math.PI/7), py2 - headLen*Math.sin(angle+Math.PI/7));
    ctx.closePath(); ctx.fill();
    ctx.restore();
    return;
  }

  if(ann.type === 'cursor'){
    ctx.save();
    ctx.translate(px, py);
    ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 4*s; ctx.shadowOffsetY = 2*s;
    ctx.fillStyle = '#ff9500'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5*s;
    ctx.beginPath();
    ctx.moveTo(0, -13*s); ctx.lineTo(11*s, -3*s); ctx.lineTo(3*s, -1*s); ctx.lineTo(6*s, 10*s); ctx.lineTo(2*s, 11.5*s); ctx.lineTo(-1*s, 0); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
    return;
  }

  if(ann.type === 'click'){
    ctx.save();
    ctx.fillStyle = '#ff9500';
    ctx.beginPath(); ctx.arc(px, py, 4*s, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = '#ff9500'; ctx.globalAlpha = 0.55; ctx.lineWidth = 2*s;
    ctx.beginPath(); ctx.arc(px, py, 9*s, 0, Math.PI*2); ctx.stroke();
    ctx.restore();
    return;
  }

  if(ann.type === 'image'){
    const im = annImageFor(ann);
    if(im && im.complete && im.naturalWidth){
      const maxW = 160*s, maxH = 120*s;
      const k = Math.min(maxW/im.naturalWidth, maxH/im.naturalHeight, 1*Math.max(1,s));
      const w = im.naturalWidth*k, h = im.naturalHeight*k;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = 10*s; ctx.shadowOffsetY = 3*s;
      roundRectPath(ctx, px-w/2, py-h/2, w, h, 8*s);
      ctx.clip();
      ctx.drawImage(im, px-w/2, py-h/2, w, h);
      ctx.restore();
    }
    return;
  }

  // text-bearing types: balloon, key, button, text, badge
  const text = ann.text || '';
  const fontSize = 13*s;
  ctx.font = `600 ${fontSize}px Inter, sans-serif`;
  const textW = ctx.measureText(text).width;

  if(ann.type === 'balloon'){
    const padX = 12*s, padY = 8*s, tailH = 6*s;
    const w = textW + padX*2, h = fontSize + padY*2;
    const bx = px - w/2, by = py - h - tailH;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.22)'; ctx.shadowBlur = 10*s; ctx.shadowOffsetY = 2*s;
    roundRectPath(ctx, bx, by, w, h, 8*s);
    ctx.fillStyle = '#fff'; ctx.fill();
    ctx.restore();
    ctx.beginPath();
    ctx.moveTo(bx+16*s, by+h); ctx.lineTo(bx+16*s+tailH, by+h); ctx.lineTo(bx+16*s, by+h+tailH);
    ctx.closePath(); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.fillStyle = '#1d1d1f'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.fillText(text, bx+padX, by+h/2);
    return;
  }
  if(ann.type === 'key'){
    const padX = 11*s, padY = 7*s;
    const w = textW + padX*2, h = fontSize + padY*2;
    const bx = px - w/2, by = py - h/2;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = 8*s; ctx.shadowOffsetY = 2*s;
    roundRectPath(ctx, bx, by, w, h, 6*s);
    ctx.fillStyle = '#1d1d1f'; ctx.fill();
    ctx.restore();
    ctx.font = `600 ${fontSize}px 'SF Mono', Menlo, monospace`;
    ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    ctx.fillText(text, px, py);
    return;
  }
  if(ann.type === 'badge'){
    const r = 13*s;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = 6*s; ctx.shadowOffsetY = 2*s;
    ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI*2);
    ctx.fillStyle = '#ff9500'; ctx.fill();
    ctx.restore();
    ctx.lineWidth = 2*s; ctx.strokeStyle = '#fff'; ctx.stroke();
    ctx.font = `700 ${13*s}px Inter, sans-serif`;
    ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    ctx.fillText(text.slice(0,3), px, py+0.5*s);
    return;
  }
  if(ann.type === 'text'){
    ctx.font = `600 ${15*s}px Inter, sans-serif`;
    const tw = ctx.measureText(text).width;
    const w = tw + 20*s, h = 15*s + 10*s;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.22)'; ctx.shadowBlur = 8*s; ctx.shadowOffsetY = 2*s;
    roundRectPath(ctx, px - w/2, py - h/2, w, h, 8*s);
    ctx.fillStyle = 'rgba(255,255,255,0.93)'; ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#1d1d1f'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    ctx.fillText(text, px, py);
    return;
  }
  if(ann.type === 'button'){
    const padX = 16*s, padY = 7*s;
    const w = textW + padX*2, h = fontSize + padY*2;
    const bx = px - w/2, by = py - h/2;
    roundRectPath(ctx, bx, by, w, h, h/2);
    ctx.fillStyle = 'rgba(255,255,255,0.96)'; ctx.fill();
    ctx.strokeStyle = '#007aff'; ctx.lineWidth = 2*s; ctx.stroke();
    ctx.fillStyle = '#007aff'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    ctx.fillText(text, px, py);
    return;
  }
}

/* ===========================================================
   MOLDURAS (fundo ao redor da tela) — extensões podem somar presets
   =========================================================== */
const FRAME_PRESETS = {
  default: { label: 'Padrão (limpo)', kind: 'default' },
  azul:    { label: 'Azul',        stops: ['#007aff', '#5ac8fa'] },
  grafite: { label: 'Grafite',     stops: ['#1d1d1f', '#48484a'] },
  aurora:  { label: 'Aurora',      stops: ['#7c5cff', '#ff375f'] },
  menta:   { label: 'Menta',       stops: ['#30d158', '#64d2ff'] },
  sol:     { label: 'Pôr do sol',  stops: ['#ff9500', '#ff375f'] },
  branco:  { label: 'Branco',      solid: '#ffffff' },
  nenhum:  { label: 'Sem moldura (tela cheia)', kind: 'none' }
};

function easeInOut(t){ t = Math.max(0, Math.min(1, t)); return t < .5 ? 2*t*t : 1 - Math.pow(-2*t + 2, 2)/2; }
function easeOut(t){ t = Math.max(0, Math.min(1, t)); return 1 - Math.pow(1 - t, 3); }
const lerp = (a, b, t) => a + (b - a)*t;

function aspectRatioOf(a){
  const m = String(a || '16:9').split(':').map(Number);
  return (m[0] > 0 && m[1] > 0) ? m[0]/m[1] : 16/9;
}
// Tamanho do canvas conforme qualidade (lado maior) e proporção
function exportDims(kind){
  const longSide = {
    pdf:   { low: 1200, med: 1600, high: 2200 },
    gif:   { low: 480,  med: 800,  high: 1000 },
    video: { low: 960,  med: 1280, high: 1920 }
  }[kind][ExportOpts.quality] || 1280;
  const ar = aspectRatioOf(ExportOpts.aspect);
  let W, H;
  if(ar >= 1){ W = longSide; H = Math.round(longSide/ar); }
  else { H = longSide; W = Math.round(longSide*ar); }
  return { W: W - (W % 2), H: H - (H % 2) };   // par: exigido por alguns codecs
}

function frameGeometry(W, H, iw, ih){
  const none = ExportOpts.frame === 'nenhum';
  const p = none ? 0 : Math.max(0, Math.min(0.2, (ExportOpts.pad || 0)/100));
  const scale = Math.min(W*(1 - 2*p)/iw, H*(1 - 2*p)/ih);
  const imgW = iw*scale, imgH = ih*scale;
  return { imgX: (W - imgW)/2, imgY: (H - imgH)/2, imgW, imgH };
}

// Zoom "câmera": leva o centro do destaque para o centro do quadro, sem deixar
// vazios dentro da área da tela (o recorte é a própria tela).
function stepZoomTarget(step, W, H){
  const id = { z: 1, tx: 0, ty: 0 };
  if(!ExportOpts.zoom || !(step.zoom > 1) || !step.imgEl) return id;
  const g = frameGeometry(W, H, step.imgEl.naturalWidth, step.imgEl.naturalHeight);
  const z = step.zoom;
  const cx = (step.xPct + step.wPct/2)/100*g.imgW;
  const cy = (step.yPct + step.hPct/2)/100*g.imgH;
  let tx = g.imgW/2 - cx*z, ty = g.imgH/2 - cy*z;
  tx = Math.max(g.imgW*(1 - z), Math.min(0, tx));
  ty = Math.max(g.imgH*(1 - z), Math.min(0, ty));
  return { z, tx, ty };
}

function paintFrameBackground(ctx, W, H, theme){
  const fp = FRAME_PRESETS[ExportOpts.frame] || FRAME_PRESETS.default;
  const isLight = theme === 'light';
  if(fp.stops){
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, fp.stops[0]); g.addColorStop(1, fp.stops[1]);
    ctx.fillStyle = g;
  } else if(fp.solid){
    ctx.fillStyle = fp.solid;
  } else {
    ctx.fillStyle = isLight ? '#f5f5f7' : '#0d0d0f';
  }
  ctx.fillRect(0, 0, W, H);
}

function drawAnimCursor(ctx, x, y, k){
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 5; ctx.shadowOffsetY = 2;
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(0, 17); ctx.lineTo(4.3, 13.2); ctx.lineTo(7.2, 19.8);
  ctx.lineTo(9.6, 18.8); ctx.lineTo(6.8, 12.4); ctx.lineTo(12, 12.4); ctx.closePath();
  ctx.fillStyle = '#fff'; ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 1.2; ctx.strokeStyle = '#1d1d1f'; ctx.lineJoin = 'round'; ctx.stroke();
  ctx.restore();
}

/*  anim (opcional): { t: 0..1 progresso dentro do passo, sec: segundos desde o início do passo,
                       prev: {z,tx,ty} zoom do passo anterior NA MESMA TELA ou null,
                       prevCenter: {xPct,yPct} do passo anterior na mesma tela ou null }
    Sem anim = quadro estático (PDF e modo estático de GIF/Vídeo). */
function renderStepToCanvas(step, canvas, stepIndex, total, brand, brandLogoImg, theme, anim){
  const isLight = theme === 'light';
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');
  const fp = FRAME_PRESETS[ExportOpts.frame] || FRAME_PRESETS.default;
  const uiScale = Math.max(W, H)/1280;
  const frameless = fp.kind === 'none';

  paintFrameBackground(ctx, W, H, theme);

  const iw = step.imgEl.naturalWidth, ih = step.imgEl.naturalHeight;
  const g = frameGeometry(W, H, iw, ih);
  const rad = frameless ? 0 : (ExportOpts.radius || 0)*uiScale;

  // zoom (somente com anim ou quando pedido explicitamente) -------------
  let zoomNow = { z: 1, tx: 0, ty: 0 };
  if(anim){
    const target = stepZoomTarget(step, W, H);
    const from = anim.prev || { z: 1, tx: 0, ty: 0 };
    const e = easeInOut(anim.t/0.30);
    zoomNow = { z: lerp(from.z, target.z, e), tx: lerp(from.tx, target.tx, e), ty: lerp(from.ty, target.ty, e) };
  }
  const imgX = g.imgX + zoomNow.tx, imgY = g.imgY + zoomNow.ty;
  const imgW = g.imgW*zoomNow.z, imgH = g.imgH*zoomNow.z;

  // sombra/cartão atrás da tela (rect original) --------------------------
  const useDefaultCard = isLight && fp.kind === 'default';
  if(!frameless){
    if(useDefaultCard){
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.12)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 4;
      ctx.fillStyle = '#ffffff';
      roundRectPath(ctx, g.imgX - 4, g.imgY - 4, g.imgW + 8, g.imgH + 8, Math.max(8, rad));
      ctx.fill();
      ctx.restore();
    } else if(ExportOpts.shadow){
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.38)'; ctx.shadowBlur = 40*uiScale; ctx.shadowOffsetY = 12*uiScale;
      ctx.fillStyle = '#000';
      roundRectPath(ctx, g.imgX, g.imgY, g.imgW, g.imgH, rad);
      ctx.fill();
      ctx.restore();
    }
  }

  // tela + destaque + elementos livres, recortados na área original -------
  ctx.save();
  roundRectPath(ctx, g.imgX, g.imgY, g.imgW, g.imgH, rad);
  ctx.clip();
  ctx.drawImage(step.imgEl, imgX, imgY, imgW, imgH);
  ctx.restore();

  const pad = 6;
  const rx = imgX + (step.xPct/100)*imgW - pad;
  const ry = imgY + (step.yPct/100)*imgH - pad;
  const rw = (step.wPct/100)*imgW + pad*2;
  const rh = (step.hPct/100)*imgH + pad*2;

  if(isLight){
    ctx.save();
    roundRectPath(ctx, rx, ry, rw, rh, 10);
    ctx.fillStyle = 'rgba(0,122,255,0.08)';
    ctx.fill();
    ctx.restore();
  } else {
    // escurece tudo, menos o destaque; limitado à tela para a moldura continuar visível
    ctx.save();
    roundRectPath(ctx, g.imgX, g.imgY, g.imgW, g.imgH, rad);
    ctx.clip();
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    roundRectSub(ctx, rx, ry, rw, rh, 10);
    ctx.fillStyle = 'rgba(6,6,9,0.62)';
    ctx.fill('evenodd');
    ctx.restore();
  }

  // borda do destaque (+ anel pulsante quando animado)
  ctx.save();
  roundRectPath(ctx, rx, ry, rw, rh, 10);
  ctx.strokeStyle = '#007aff'; ctx.lineWidth = 3*Math.max(1, uiScale);
  ctx.stroke();
  ctx.restore();
  if(anim){
    const cyc = 1.6;
    const ph = (anim.sec % cyc)/cyc;
    const grow = ph*16*uiScale;
    ctx.save();
    ctx.globalAlpha = (1 - ph)*0.85;
    roundRectPath(ctx, rx - grow, ry - grow, rw + grow*2, rh + grow*2, 10 + grow*0.6);
    ctx.strokeStyle = '#007aff'; ctx.lineWidth = 2.5*Math.max(1, uiScale);
    ctx.stroke();
    ctx.restore();
  }

  // elementos livres ficam por cima do escurecimento (sem ficarem apagados)
  if((step.annotations || []).length){
    ctx.save();
    roundRectPath(ctx, g.imgX, g.imgY, g.imgW, g.imgH, rad);
    ctx.clip();
    step.annotations.forEach(ann => drawAnnotationOnCanvas(ctx, ann, imgX, imgY, imgW, imgH));
    ctx.restore();
  }

  // tooltip --------------------------------------------------------------
  const ttW = Math.round(Math.min(380*uiScale, W*0.82));
  const ttPad = 22*uiScale;
  const titleSize = 20*uiScale, textSize = 15*uiScale, lineH = 22*uiScale;
  ctx.font = `600 ${titleSize}px Inter, sans-serif`;
  const titleLines = wrapText(ctx, step.title||'', ttW - ttPad*2);
  ctx.font = `${textSize}px Inter, sans-serif`;
  const bodyLines = wrapText(ctx, step.text||'', ttW - ttPad*2);
  const badgeH = 24*uiScale;
  const ttH = ttPad + badgeH + 12*uiScale
    + titleLines.length*(titleSize*1.25) + 12*uiScale
    + bodyLines.length*lineH + ttPad + 8*uiScale;

  const gap = 20*uiScale;
  let pos = step.position || 'auto';
  if(pos === 'auto'){
    if(ry+rh+ttH+gap < H-20) pos = 'bottom';
    else if(ry-ttH-gap > 20) pos = 'top';
    else pos = 'right';
  }
  let ttX, ttY;
  if(pos==='bottom'){ ttX=rx+pad; ttY=ry+rh+gap; }
  else if(pos==='top'){ ttX=rx+pad; ttY=ry-ttH-gap; }
  else if(pos==='right'){ ttX=rx+rw+gap; ttY=ry+pad; }
  else { ttX=rx-ttW-gap; ttY=ry+pad; }
  ttX = Math.max(20, Math.min(ttX, W-ttW-20));
  ttY = Math.max(20, Math.min(ttY, H-ttH-20));

  ctx.save();
  if(anim) ctx.globalAlpha = easeOut(anim.t/0.14);
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 30*uiScale; ctx.shadowOffsetY = 8*uiScale;
  roundRectPath(ctx, ttX, ttY, ttW, ttH, 16*uiScale);
  ctx.fillStyle = '#fff'; ctx.fill();
  ctx.restore();

  ctx.fillStyle = '#eaeaec';
  ctx.fillRect(ttX, ttY, ttW, 3*uiScale);
  ctx.fillStyle = '#007aff';
  ctx.fillRect(ttX, ttY, ttW*((stepIndex+1)/total), 3*uiScale);

  const badgeText = `Passo ${stepIndex+1} de ${total}`;
  ctx.font = `500 ${11*uiScale}px Inter, sans-serif`;
  const badgeX = ttX + ttPad, badgeY = ttY + ttPad + 4*uiScale;
  ctx.fillStyle = '#6e6e73';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(badgeText, badgeX, badgeY + badgeH/2);

  ctx.fillStyle = '#1d1d1f';
  ctx.font = `600 ${titleSize}px Inter, sans-serif`;
  ctx.textBaseline = 'top';
  let cy = ttY + ttPad + badgeH + 12*uiScale;
  for(const line of titleLines){ ctx.fillText(line, ttX+ttPad, cy); cy += titleSize*1.25; }
  cy += 8*uiScale;

  ctx.fillStyle = '#3a3a3c';
  ctx.font = `${textSize}px Inter, sans-serif`;
  for(const line of bodyLines){ ctx.fillText(line, ttX+ttPad, cy); cy += lineH; }
  ctx.restore();

  // cursor animado: chega ao destaque e "clica" -------------------------
  if(anim && ExportOpts.cursor){
    const endX = rx + rw/2, endY = ry + rh/2;
    let startX, startY;
    if(anim.prevCenter){
      startX = imgX + anim.prevCenter.xPct/100*imgW;
      startY = imgY + anim.prevCenter.yPct/100*imgH;
    } else {
      startX = endX - 150*uiScale; startY = endY + 120*uiScale;
    }
    const m = easeInOut((anim.t - 0.06)/0.40);
    const cx2 = lerp(startX, endX, m), cy2 = lerp(startY, endY, m);
    const ck = (anim.t - 0.46)/0.20;       // 0..1 durante o "clique"
    if(ck > 0 && ck < 1){
      ctx.save();
      ctx.globalAlpha = (1 - ck)*0.9;
      ctx.beginPath(); ctx.arc(endX, endY, (6 + ck*30)*uiScale, 0, Math.PI*2);
      ctx.strokeStyle = '#007aff'; ctx.lineWidth = 3*uiScale; ctx.stroke();
      ctx.restore();
    }
    const press = (ck > 0 && ck < 0.35) ? 0.88 : 1;
    drawAnimCursor(ctx, cx2, cy2, 1.25*uiScale*press);
  }

  // selo da marca (canto superior esquerdo)
  if(brand && (brand.name || brandLogoImg)){
    const bs = Math.max(W, H)/1280;
    const padX = 14*bs, padY = 10*bs;
    const logoSize = 22*bs;
    ctx.font = `600 ${13*bs}px Inter, sans-serif`;
    const nameW = brand.name ? ctx.measureText(brand.name).width : 0;
    const gapLogo = brandLogoImg ? logoSize + 8*bs : 0;
    const badgeW = gapLogo + nameW + padX*2;
    const badgeH2 = logoSize + padY*1.4;
    const bx = 16*bs, by = 16*bs;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.25)'; ctx.shadowBlur = 12*bs; ctx.shadowOffsetY = 2*bs;
    roundRectPath(ctx, bx, by, badgeW, badgeH2, badgeH2/2);
    ctx.fillStyle = 'rgba(255,255,255,0.94)';
    ctx.fill();
    ctx.restore();
    let cx = bx + padX;
    const midY = by + badgeH2/2;
    if(brandLogoImg){
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx + logoSize/2, midY, logoSize/2, 0, Math.PI*2);
      ctx.clip();
      ctx.drawImage(brandLogoImg, cx, midY - logoSize/2, logoSize, logoSize);
      ctx.restore();
      cx += logoSize + 8*bs;
    }
    if(brand.name){
      ctx.fillStyle = '#1d1d1f';
      ctx.font = `600 ${13*bs}px Inter, sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillText(brand.name, cx, midY);
    }
  }

  // ganchos das extensões (marca d'água etc.)
  if(typeof Extensions !== 'undefined') Extensions.postRender(ctx, W, H, uiScale);
}

// Monta o estado de animação do passo i (usa o passo anterior se for a MESMA tela)
function buildAnimState(steps, i, W, H, t, sec){
  const cur = steps[i], prev = i > 0 ? steps[i-1] : null;
  const same = prev && prev.dataUrl === cur.dataUrl;
  return {
    t, sec,
    prev: same ? stepZoomTarget(prev, W, H) : null,
    prevCenter: same ? { xPct: prev.xPct + prev.wPct/2, yPct: prev.yPct + prev.hPct/2 } : null
  };
}

Editor.runHTML = async function(){
  showProgress('Gerando HTML interativo', 'Empacotando imagens no arquivo...');
  updateProg(0.3, 'Serializando...');
  const html = buildExportHTML();
  const blob = new Blob([html], {type:'text/html'});
  downloadBlob(blob, this.tutorial().name.replace(/[^\w]/g,'-')+'.html');
  updateProg(1, 'Concluído');
  setTimeout(() => showDone('Arquivo HTML baixado.'), 300);
};

function buildExportHTML(){
  const { tutorial, steps } = collectStepsForExport();
  const stepsData = steps.map(s => ({dataUrl:s.dataUrl, xPct:s.xPct, yPct:s.yPct, wPct:s.wPct, hPct:s.hPct, title:s.title, text:s.text, position:s.position, hotspotStyle:s.hotspotStyle, zoom:s.zoom||1, annotations:s.annotations||[]}));
  const tourOpts = {zoom: !!ExportOpts.zoom, cursor: !!ExportOpts.cursor};
  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><title>${escapeHtml(tutorial.name)}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
body{margin:0;font-family:'Inter',-apple-system,sans-serif;background:#f5f5f7;color:#1d1d1f;display:flex;align-items:center;justify-content:center;min-height:100vh;}
.start-card{background:#fff;border-radius:20px;padding:40px;text-align:center;box-shadow:0 10px 40px rgba(0,0,0,0.08);max-width:400px;}
.start-brand{display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:16px;}
.start-brand img{width:28px;height:28px;border-radius:7px;object-fit:contain;}
.start-brand span{font-size:12.5px;font-weight:600;color:#6e6e73;letter-spacing:0.02em;text-transform:uppercase;}
.start-card h1{font-size:20px;margin:0 0 8px;letter-spacing:-0.01em;}
.start-card p{font-size:13.5px;color:#6e6e73;line-height:1.6;margin:0 0 22px;}
.start-btn{background:#007aff;color:#fff;border:none;border-radius:9999px;padding:12px 26px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;}
.start-btn:hover{background:#0062cc;}
.player{position:fixed;inset:0;z-index:99;background:rgba(6,6,9,0.85);backdrop-filter:blur(10px);display:none;align-items:center;justify-content:center;}
.player.on{display:flex;}
.player-progress{position:fixed;top:0;left:0;right:0;height:3px;background:rgba(255,255,255,0.10);z-index:110;}
.player-progress-fill{height:100%;background:#007aff;transition:width .35s ease;}
.player-header{position:fixed;top:16px;left:20px;right:20px;z-index:110;display:flex;align-items:center;gap:12px;color:#fff;}
.player-brand{display:flex;align-items:center;gap:8px;}
.player-brand img{width:22px;height:22px;border-radius:6px;object-fit:contain;background:#fff;}
.player-brand span{font-size:12.5px;font-weight:600;color:rgba(255,255,255,0.85);}
.player-title{font-size:13px;color:rgba(255,255,255,0.85);}
.player-counter{margin-left:auto;font-size:12px;color:rgba(255,255,255,0.6);padding:4px 10px;background:rgba(255,255,255,0.10);border-radius:20px;}
.player-close{width:32px;height:32px;border-radius:50%;background:rgba(255,255,255,0.12);color:#fff;border:none;cursor:pointer;}
.player-close:hover{background:rgba(255,255,255,0.22);}
.player-img{max-width:92vw;max-height:78vh;display:block;border-radius:12px;box-shadow:0 30px 90px rgba(0,0,0,0.6);transform-origin:0 0;transition:transform .35s cubic-bezier(.4,0,.2,1);}
.tour-cursor{position:fixed;left:0;top:0;z-index:115;pointer-events:none;opacity:0;transition:transform .65s cubic-bezier(.4,0,.2,1),opacity .25s ease;will-change:transform;}
.tour-cursor.on{opacity:1;}
.tour-cursor svg{display:block;filter:drop-shadow(0 2px 4px rgba(0,0,0,.4));}
.tour-click{position:fixed;z-index:114;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;border:2px solid #007aff;pointer-events:none;animation:tourPing .6s ease-out forwards;}
@keyframes tourPing{0%{transform:scale(.6);opacity:1;}100%{transform:scale(3.2);opacity:0;}}
.ann-text{font-size:15px;font-weight:600;color:#1d1d1f;background:rgba(255,255,255,.92);padding:4px 10px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.2);white-space:nowrap;}
.ann-badge{min-width:26px;height:26px;border-radius:50%;background:#ff9500;color:#fff;font-weight:700;font-size:13px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.3);border:2px solid #fff;}
.ann-image{display:block;max-width:160px;max-height:120px;border-radius:8px;box-shadow:0 3px 10px rgba(0,0,0,.3);}
.player-spotlight{position:fixed;border-radius:8px;box-shadow:0 0 0 9999px rgba(6,6,9,0.68);transition:all .35s cubic-bezier(.4,0,.2,1);pointer-events:none;border:2px solid #007aff;}
.player-hotspot{position:fixed;pointer-events:none;transition:all .35s cubic-bezier(.4,0,.2,1);}
.player-hotspot.pulse::before,.player-hotspot.pulse::after{content:'';position:absolute;inset:-8px;border-radius:12px;border:2px solid #007aff;animation:pulseRing 2s ease-out infinite;}
.player-hotspot.pulse::after{animation-delay:1s;}
@keyframes pulseRing{0%{transform:scale(1);opacity:0.9;}100%{transform:scale(1.35);opacity:0;}}
.player-hotspot.glow{box-shadow:0 0 0 4px rgba(0,122,255,0.20),0 0 30px 8px rgba(0,122,255,0.35);animation:glowPulse 2.2s ease-in-out infinite;border-radius:10px;}
@keyframes glowPulse{50%{box-shadow:0 0 0 6px rgba(0,122,255,0.30),0 0 50px 12px rgba(0,122,255,0.5);}}
.player-hotspot.ripple::before{content:'';position:absolute;inset:0;border-radius:8px;background:radial-gradient(circle, rgba(0,122,255,0.30) 0%, transparent 70%);animation:rippleAnim 1.8s ease-out infinite;}
@keyframes rippleAnim{0%{transform:scale(0.8);opacity:1;}100%{transform:scale(1.6);opacity:0;}}
.player-hotspot.dot{border-radius:50%;background:#007aff;animation:dotPulse 1.5s ease-in-out infinite;}
@keyframes dotPulse{50%{transform:scale(1.15);box-shadow:0 0 30px 8px rgba(0,122,255,0.30);}}
.player-hotspot.ring::before{content:'';position:absolute;inset:-6px;border-radius:10px;border:2.5px solid #007aff;animation:ringExpand 1.8s ease-out infinite;}
@keyframes ringExpand{0%{transform:scale(0.88);opacity:1;}100%{transform:scale(1.28);opacity:0;}}
.player-hotspot.simple{border-radius:8px;animation:simpleBreathe 2.4s ease-in-out infinite;}
@keyframes simpleBreathe{0%,100%{box-shadow:0 0 0 2px rgba(0,122,255,0.30);}50%{box-shadow:0 0 0 5px rgba(0,122,255,0.30);}}
.ann{position:fixed;transform:translate(-50%,-50%);pointer-events:none;transition:top .35s cubic-bezier(.4,0,.2,1), left .35s cubic-bezier(.4,0,.2,1);}
.ann-arrows-svg{position:fixed;pointer-events:none;transition:all .35s cubic-bezier(.4,0,.2,1);}
.ann-balloon{background:#fff;color:#1d1d1f;padding:7px 12px;border-radius:10px;font-size:12px;font-weight:500;box-shadow:0 4px 14px rgba(0,0,0,0.20);white-space:normal;max-width:200px;position:relative;line-height:1.35;}
.ann-balloon:after{content:'';position:absolute;bottom:-6px;left:18px;width:0;height:0;border:6px solid transparent;border-top-color:#fff;}
.ann-key{background:#1d1d1f;color:#fff;padding:6px 11px;border-radius:6px;font-size:12px;font-weight:600;font-family:'SF Mono',Menlo,Consolas,monospace;box-shadow:0 4px 10px rgba(0,0,0,0.25);white-space:nowrap;}
.ann-button{background:rgba(255,255,255,0.96);color:#007aff;border:2px solid #007aff;padding:5px 15px;border-radius:9999px;font-size:12px;font-weight:600;white-space:nowrap;}
.player-tooltip{position:fixed;width:340px;background:#fff;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,0.35);transition:all .35s cubic-bezier(.4,0,.2,1);overflow:hidden;}
.tt-progress{height:3px;background:#f5f5f7;}
.tt-progress-fill{height:100%;background:#007aff;transition:width .35s ease;}
.tt-body{padding:18px 20px 16px;}
.tt-meta{display:flex;align-items:center;gap:8px;margin-bottom:10px;}
.tt-icon{width:28px;height:28px;border-radius:8px;background:rgba(0,122,255,0.10);color:#007aff;display:flex;align-items:center;justify-content:center;}
.tt-counter{font-size:11px;color:#6e6e73;font-weight:500;}
.tt-title{font-size:16px;font-weight:600;margin-bottom:6px;line-height:1.3;}
.tt-text{font-size:13.5px;color:#3a3a3c;line-height:1.55;margin-bottom:16px;}
.tt-footer{display:flex;align-items:center;justify-content:space-between;gap:8px;}
.tt-dots{display:flex;gap:4px;}
.tt-dot{width:5px;height:5px;border-radius:50%;background:#d2d2d7;transition:all .2s ease;}
.tt-dot.on{background:#007aff;width:16px;border-radius:3px;}
.tt-actions{display:flex;gap:6px;}
.tt-btn{padding:7px 14px;border-radius:20px;font-size:12.5px;font-weight:500;border:none;cursor:pointer;font-family:inherit;}
.tt-btn.sec{background:#f5f5f7;color:#3a3a3c;}
.tt-btn.pri{background:#007aff;color:#fff;}
.tt-btn:disabled{opacity:.4;cursor:not-allowed;}
</style></head>
<body>
<div class="start-card">
  ${(tutorial.brand && (tutorial.brand.name || tutorial.brand.logo)) ? `
  <div class="start-brand">
    ${tutorial.brand.logo ? `<img src="${tutorial.brand.logo}">` : ''}
    ${tutorial.brand.name ? `<span>${escapeHtml(tutorial.brand.name)}</span>` : ''}
  </div>` : ''}
  <h1>${escapeHtml(tutorial.name)}</h1>
  <p>${steps.length} passo${steps.length!==1?'s':''} — clique abaixo para começar.</p>
  <button class="start-btn" onclick="Tour.start()">Iniciar tutorial</button>
</div>
<div class="player" id="tour-player">
  <div class="player-progress"><div class="player-progress-fill" id="tour-prog"></div></div>
  <div class="player-header">
    ${(tutorial.brand && (tutorial.brand.name || tutorial.brand.logo)) ? `
    <div class="player-brand">
      ${tutorial.brand.logo ? `<img src="${tutorial.brand.logo}">` : ''}
      ${tutorial.brand.name ? `<span>${escapeHtml(tutorial.brand.name)}</span>` : ''}
    </div>` : ''}
    <div class="player-title" id="tour-name">${escapeHtml(tutorial.name)}</div>
    <div class="player-counter" id="tour-count">1 / 1</div>
    <button class="player-close" onclick="Tour.close()">✕</button>
  </div>
  <img class="player-img" id="tour-img">
  <div class="player-spotlight" id="tour-spot"></div>
  <div class="player-hotspot pulse" id="tour-hs"></div>
  <div id="tour-ann"></div>
  <div class="player-tooltip" id="tour-tt">
    <div class="tt-progress"><div class="tt-progress-fill" id="tour-tt-prog"></div></div>
    <div class="tt-body">
      <div class="tt-meta">
        <div class="tt-icon"><svg width="15" height="15" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><path d="M9.5 12l2 2 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></div>
        <div class="tt-counter" id="tt-counter">Passo 1 de 1</div>
      </div>
      <div class="tt-title" id="tt-title"></div>
      <div class="tt-text" id="tt-text"></div>
      <div class="tt-footer">
        <div class="tt-dots" id="tt-dots"></div>
        <div class="tt-actions">
          <button class="tt-btn sec" id="tt-prev" onclick="Tour.prev()">Voltar</button>
          <button class="tt-btn pri" id="tt-next" onclick="Tour.next()">Próximo</button>
        </div>
      </div>
    </div>
  </div>
</div>
<script>
window.Tour = (function(){
  const steps = ${JSON.stringify(stepsData)};
  const OPTS = ${JSON.stringify(tourOpts)};
  let i = 0, zPrev = 'none', curPos = null, ct = null, fromShow = false, cursorEl = null;
  const P = document.getElementById('tour-player');
  const img = document.getElementById('tour-img');
  const sp = document.getElementById('tour-spot');
  const hs = document.getElementById('tour-hs');
  const tt = document.getElementById('tour-tt');
  function pos(){
    const s = steps[i];
    const fs = fromShow; fromShow = false;
    img.style.transition='none'; img.style.transform='none';
    const r0 = img.getBoundingClientRect();
    img.style.transform = zPrev; void img.offsetWidth; img.style.transition='';
    const z = (OPTS.zoom && s.zoom>1) ? s.zoom : 1;
    let ztx=0, zty=0;
    if(z>1){
      ztx = window.innerWidth/2 - r0.left - (s.xPct+s.wPct/2)/100*r0.width*z;
      zty = window.innerHeight*0.44 - r0.top - (s.yPct+s.hPct/2)/100*r0.height*z;
    }
    zPrev = z>1 ? 'translate('+ztx+'px,'+zty+'px) scale('+z+')' : 'none';
    img.style.transform = zPrev;
    const r = {left:r0.left+ztx, top:r0.top+zty, width:r0.width*z, height:r0.height*z};
    const pad=6;
    const rx = r.left + s.xPct/100*r.width - pad;
    const ry = r.top + s.yPct/100*r.height - pad;
    const rw = s.wPct/100*r.width + pad*2;
    const rh = s.hPct/100*r.height + pad*2;
    sp.style.left=rx+'px';sp.style.top=ry+'px';sp.style.width=rw+'px';sp.style.height=rh+'px';
    hs.className = 'player-hotspot '+(s.hotspotStyle||'pulse');
    if(s.hotspotStyle === 'dot'){
      const dsz = Math.min(rw, rh) * 0.5;
      hs.style.width = dsz+'px'; hs.style.height = dsz+'px';
      hs.style.left = (rx + rw/2 - dsz/2)+'px';
      hs.style.top = (ry + rh/2 - dsz/2)+'px';
    } else {
      hs.style.left=rx+'px';hs.style.top=ry+'px';hs.style.width=rw+'px';hs.style.height=rh+'px';
    }
    moveCursor(rx+rw/2, ry+rh/2, fs);

    const annC = document.getElementById('tour-ann');
    annC.innerHTML = '';
    const arrows = (s.annotations||[]).filter(a=>a.type==='arrow');
    if(arrows.length){
      const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
      svg.setAttribute('class','ann-arrows-svg');
      svg.style.left=r.left+'px'; svg.style.top=r.top+'px';
      svg.style.width=r.width+'px'; svg.style.height=r.height+'px';
      svg.setAttribute('viewBox','0 0 100 100'); svg.setAttribute('preserveAspectRatio','none');
      svg.innerHTML = '<defs><marker id="tour-arrowhead" markerWidth="6" markerHeight="6" refX="4.5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#ff9500"/></marker></defs>' +
        arrows.map(a=>'<line x1="'+a.xPct+'" y1="'+a.yPct+'" x2="'+a.x2Pct+'" y2="'+a.y2Pct+'" stroke="#ff9500" stroke-width="1.2" vector-effect="non-scaling-stroke" marker-end="url(#tour-arrowhead)"/>').join('');
      annC.appendChild(svg);
    }
    (s.annotations||[]).filter(a=>a.type!=='arrow').forEach(a=>{
      const el = document.createElement('div');
      el.className = 'ann';
      el.style.left = (r.left + (a.xPct/100)*r.width)+'px';
      el.style.top = (r.top + (a.yPct/100)*r.height)+'px';
      if(a.type==='cursor') el.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24" style="filter:drop-shadow(0 2px 4px rgba(0,0,0,.35))"><path d="M4 2l16 8-6.5 2-2.2 6.5z" fill="#ff9500" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/></svg>';
      else if(a.type==='click') el.innerHTML = '<svg width="30" height="30" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4" fill="#ff9500"/><circle cx="12" cy="12" r="9" stroke="#ff9500" stroke-width="2" opacity="0.55"/></svg>';
      else if(a.type==='balloon') el.innerHTML = '<div class="ann-balloon">'+(a.text||'').replace(/&/g,'&amp;').replace(/</g,'&lt;')+'</div>';
      else if(a.type==='key') el.innerHTML = '<div class="ann-key">'+(a.text||'').replace(/&/g,'&amp;').replace(/</g,'&lt;')+'</div>';
      else if(a.type==='button') el.innerHTML = '<div class="ann-button">'+(a.text||'').replace(/&/g,'&amp;').replace(/</g,'&lt;')+'</div>';
      else if(a.type==='text') el.innerHTML = '<div class="ann-text">'+(a.text||'').replace(/&/g,'&amp;').replace(/</g,'&lt;')+'</div>';
      else if(a.type==='badge') el.innerHTML = '<div class="ann-badge">'+(a.text||'').slice(0,3).replace(/&/g,'&amp;').replace(/</g,'&lt;')+'</div>';
      else if(a.type==='image'){ const im=document.createElement('img'); im.className='ann-image'; im.src=a.dataUrl||''; el.appendChild(im); }
      annC.appendChild(el);
    });

    document.getElementById('tour-prog').style.width=((i+1)/steps.length*100)+'%';
    document.getElementById('tour-count').textContent=(i+1)+' / '+steps.length;
    document.getElementById('tt-counter').textContent='Passo '+(i+1)+' de '+steps.length;
    document.getElementById('tt-title').textContent=s.title||'';
    document.getElementById('tt-text').textContent=s.text||'';
    document.getElementById('tour-tt-prog').style.width=((i+1)/steps.length*100)+'%';
    document.getElementById('tt-dots').innerHTML = steps.map((_,idx)=>'<div class="tt-dot '+(idx===i?'on':'')+'"></div>').join('');
    document.getElementById('tt-prev').disabled = i===0;
    document.getElementById('tt-next').textContent = i===steps.length-1?'Concluir':'Próximo';
    const ttW=340, ttH=tt.offsetHeight||200, gap=22;
    const cx=rx+pad, cy=ry+pad, cw=rw-pad*2, ch=rh-pad*2;
    let p = s.position||'auto';
    if(p==='auto'){
      if(cy+ch+ttH+gap < window.innerHeight-20) p='bottom';
      else if(cy-ttH-gap > 60) p='top';
      else if(cx+cw+ttW+gap < window.innerWidth-20) p='right';
      else p='left';
    }
    let top,left;
    if(p==='bottom'){top=cy+ch+gap;left=cx;}
    else if(p==='top'){top=cy-ttH-gap;left=cx;}
    else if(p==='right'){top=cy;left=cx+cw+gap;}
    else{top=cy;left=cx-ttW-gap;}
    left=Math.max(20,Math.min(left,window.innerWidth-ttW-20));
    top=Math.max(60,Math.min(top,window.innerHeight-ttH-20));
    tt.style.left=left+'px';tt.style.top=top+'px';
  }
  function moveCursor(tx,ty,animate){
    if(!cursorEl){
      cursorEl=document.createElement('div'); cursorEl.className='tour-cursor';
      cursorEl.innerHTML='<svg width="24" height="28" viewBox="0 0 12 20" fill="none"><path d="M0.5 0.8v14.6l3.6-3.4 2.4 5.8 2.2-.9-2.4-5.7h5L0.5 0.8z" fill="#fff" stroke="#1d1d1f" stroke-width="1" stroke-linejoin="round"/></svg>';
      P.appendChild(cursorEl);
    }
    if(!OPTS.cursor){ cursorEl.classList.remove('on'); return; }
    clearTimeout(ct);
    const from = animate ? (curPos || {x:tx-180,y:ty+150}) : {x:tx,y:ty};
    cursorEl.style.transition='none';
    cursorEl.style.transform='translate('+from.x+'px,'+from.y+'px)';
    cursorEl.classList.add('on'); void cursorEl.offsetWidth;
    cursorEl.style.transition='';
    cursorEl.style.transform='translate('+tx+'px,'+ty+'px)';
    curPos={x:tx,y:ty};
    if(animate){
      ct=setTimeout(function(){
        const p=document.createElement('div'); p.className='tour-click';
        p.style.left=tx+'px'; p.style.top=ty+'px';
        p.addEventListener('animationend',function(){p.remove();});
        P.appendChild(p);
      },700);
    }
  }
  function show(){
    const s=steps[i];
    fromShow = true;
    if(img.getAttribute('data-cur')!==s.dataUrl){
      img.style.transition='none'; img.style.transform='none'; zPrev='none'; void img.offsetWidth; img.style.transition='';
      img.src=s.dataUrl;img.setAttribute('data-cur',s.dataUrl);
      img.onload=()=>requestAnimationFrame(()=>requestAnimationFrame(pos));
    } else requestAnimationFrame(pos);
  }
  return {
    start(){ i=0; zPrev='none'; curPos=null; P.classList.add('on'); show(); window.addEventListener('resize',pos); document.addEventListener('keydown',this._kd=e=>{if(e.key==='ArrowRight'||e.key===' ')this.next();else if(e.key==='ArrowLeft')this.prev();else if(e.key==='Escape')this.close();}); },
    close(){ P.classList.remove('on'); clearTimeout(ct); if(cursorEl) cursorEl.classList.remove('on'); window.removeEventListener('resize',pos); document.removeEventListener('keydown',this._kd); },
    next(){ if(i===steps.length-1)return this.close(); i++; show(); },
    prev(){ if(i===0)return; i--; show(); }
  };
})();
<\/script>
</body></html>`;
}

Editor.runPDF = async function(){
  showProgress('Gerando PDF', 'Renderizando cada passo em uma página...');
  try {
    const {jsPDF} = window.jspdf;
    const { tutorial, steps } = collectStepsForExport();
    if(steps.length === 0){
      alert('Adicione ao menos um passo antes de exportar em PDF.');
      Editor.showExportView('choose');
      return;
    }
    const { W, H } = exportDims('pdf');
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const portrait = H > W;
    const doc = new jsPDF({orientation: portrait ? 'portrait' : 'landscape', unit:'mm', format:'a4'});
    const pw = doc.internal.pageSize.getWidth(), ph = doc.internal.pageSize.getHeight();
    const m = 8, k = Math.min((pw - 2*m)/W, (ph - 2*m)/H);
    const dw = W*k, dh = H*k, dx = (pw - dw)/2, dy = (ph - dh)/2;
    const jq = {low: 0.8, med: 0.88, high: 0.94}[ExportOpts.quality] || 0.88;
    const brand = tutorial.brand;
    const brandLogoImg = await preloadBrandLogo(brand);
    for(let i=0; i<steps.length; i++){
      if(Editor._cancelled) return;
      renderStepToCanvas(steps[i], canvas, i, steps.length, brand, brandLogoImg, 'light');
      const data = canvas.toDataURL('image/jpeg', jq);
      if(i>0) doc.addPage();
      doc.addImage(data, 'JPEG', dx, dy, dw, dh);
      updateProg((i+1)/steps.length, `Página ${i+1} de ${steps.length}`);
      await new Promise(r=>setTimeout(r,30));
    }
    downloadBlob(doc.output('blob'), this.tutorial().name.replace(/[^\w]/g,'-')+'.pdf');
    showDone('Arquivo PDF baixado.');
  } catch(err){ console.error(err); alert('Erro: '+err.message); Editor.showExportView('choose'); }
};

let gifWorkerUrl = null;
async function getGifWorker(){
  if(gifWorkerUrl) return gifWorkerUrl;
  const res = await fetch('https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/gif.worker.js');
  const text = await res.text();
  gifWorkerUrl = URL.createObjectURL(new Blob([text], {type:'application/javascript'}));
  return gifWorkerUrl;
}

Editor.runGIF = async function(dur){
  showProgress('Gerando GIF animado', ExportOpts.anim ? 'Renderizando animação quadro a quadro...' : 'Renderizando quadros...');
  try {
    const { tutorial, steps } = collectStepsForExport();
    if(steps.length === 0){
      alert('Adicione ao menos um passo antes de exportar em GIF.');
      Editor.showExportView('choose');
      return;
    }
    const workerUrl = await getGifWorker();
    const { W, H } = exportDims('gif');
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const gq = {low: 20, med: 10, high: 5}[ExportOpts.quality] || 10;
    const gif = new GIF({workers:2, quality:gq, workerScript:workerUrl, width:W, height:H, repeat: ExportOpts.loop ? 0 : -1});
    const brand = tutorial.brand;
    const brandLogoImg = await preloadBrandLogo(brand);

    // Animado: ~animSec de movimento por passo e depois o quadro final parado.
    // O total de quadros é limitado para o arquivo/memória não explodirem.
    const fps = Math.max(2, ExportOpts.fps || 10);
    const animSec = Math.min(dur, 2.8);
    const perStep = Math.max(4, Math.min(Math.round(animSec*fps), Math.floor(260/steps.length)));
    const totalWork = ExportOpts.anim ? steps.length*(perStep + 1) : steps.length;
    let done = 0;

    for(let i=0; i<steps.length; i++){
      if(Editor._cancelled) return;
      if(!ExportOpts.anim){
        renderStepToCanvas(steps[i], canvas, i, steps.length, brand, brandLogoImg);
        gif.addFrame(canvas, {delay: dur*1000, copy:true});
        done++;
      } else {
        const frameMs = Math.max(20, Math.round(animSec/perStep*1000/10)*10);
        for(let k=0; k<perStep; k++){
          if(Editor._cancelled) return;
          const sec = k*animSec/perStep;
          renderStepToCanvas(steps[i], canvas, i, steps.length, brand, brandLogoImg, undefined,
            buildAnimState(steps, i, W, H, sec/dur, sec));
          gif.addFrame(canvas, {delay: frameMs, copy:true});
          done++;
          if(k % 4 === 3) await new Promise(r=>setTimeout(r,0));
        }
        // quadro final do passo (mantido até completar a duração)
        renderStepToCanvas(steps[i], canvas, i, steps.length, brand, brandLogoImg, undefined,
          buildAnimState(steps, i, W, H, animSec/dur, 0));
        gif.addFrame(canvas, {delay: Math.max(100, Math.round((dur - animSec)*1000) || 100), copy:true});
        done++;
      }
      updateProg(done/totalWork*0.5, `Passo ${i+1} de ${steps.length}`);
      await new Promise(r=>setTimeout(r,20));
    }
    gif.on('progress', p => updateProg(0.5 + p*0.5, `Codificando ${Math.round(p*100)}%`));
    gif.on('finished', blob => { downloadBlob(blob, Editor.tutorial().name.replace(/[^\w]/g,'-')+'.gif'); showDone('Arquivo GIF baixado.'); });
    gif.render();
  } catch(err){ console.error(err); alert('Erro: '+err.message); Editor.showExportView('choose'); }
};

Editor.runVideo = async function(dur){
  if(!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream){
    alert('Seu navegador não suporta gravação de vídeo. Use Chrome, Edge ou Firefox.');
    Editor.showExportView('choose');
    return;
  }
  const precheck = collectStepsForExport();
  if(precheck.steps.length === 0){
    alert('Adicione ao menos um passo antes de exportar em vídeo.');
    Editor.showExportView('choose');
    return;
  }
  showProgress('Gerando vídeo', `Gravando em tempo real (cerca de ${dur*precheck.steps.length}s)`);
  try {
    const { W, H } = exportDims('video');
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const { tutorial, steps } = collectStepsForExport();
    const brand = tutorial.brand;
    const brandLogoImg = await preloadBrandLogo(brand);
    renderStepToCanvas(steps[0], canvas, 0, steps.length, brand, brandLogoImg);
    const stream = canvas.captureStream(30);
    const mimes = ['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'];
    let mime = mimes.find(m => MediaRecorder.isTypeSupported(m));
    const vbps = {low: 2_000_000, med: 3_500_000, high: 6_000_000}[ExportOpts.quality] || 3_500_000;
    const rec = new MediaRecorder(stream, {mimeType:mime, videoBitsPerSecond: vbps});
    const chunks = [];
    rec.ondataavailable = e => e.data && e.data.size && chunks.push(e.data);
    const stopped = new Promise(res => rec.onstop = res);
    rec.start(200);
    await new Promise(r=>setTimeout(r,300));
    const total = steps.length*dur*1000;
    for(let i=0; i<steps.length; i++){
      if(Editor._cancelled){ rec.stop(); return; }
      const t0 = performance.now();
      if(!ExportOpts.anim){
        renderStepToCanvas(steps[i], canvas, i, steps.length, brand, brandLogoImg);
        while(performance.now() - t0 < dur*1000){
          if(Editor._cancelled){ rec.stop(); return; }
          updateProg((i*dur*1000 + (performance.now() - t0))/total, `Passo ${i+1} de ${steps.length}`);
          await new Promise(r=>setTimeout(r,150));
        }
      } else {
        let el;
        while((el = performance.now() - t0) < dur*1000){
          if(Editor._cancelled){ rec.stop(); return; }
          renderStepToCanvas(steps[i], canvas, i, steps.length, brand, brandLogoImg, undefined,
            buildAnimState(steps, i, W, H, el/(dur*1000), el/1000));
          updateProg((i*dur*1000 + el)/total, `Passo ${i+1} de ${steps.length}`);
          await new Promise(r=>setTimeout(r,33));
        }
      }
    }
    await new Promise(r=>setTimeout(r,300));
    rec.stop();
    await stopped;
    downloadBlob(new Blob(chunks, {type:mime||'video/webm'}), Editor.tutorial().name.replace(/[^\w]/g,'-')+'.webm');
    showDone('Vídeo WebM baixado.');
  } catch(err){ console.error(err); alert('Erro: '+err.message); Editor.showExportView('choose'); }
};

/* ===========================================================
   I18N — PT / EN / ES (menu, títulos das telas e exportação)
   O editor interno segue em português por enquanto.
   =========================================================== */
const I18N_DICT = {
  'g.start':      ['Início','Start','Inicio'],
  'g.tutorials':  ['Tutoriais','Tutorials','Tutoriales'],
  'g.publish':    ['Publicar','Publish','Publicar'],
  'g.studio':     ['Estúdio · mídia','Studio · media','Estudio · medios'],
  'g.system':     ['Sistema','System','Sistema'],
  'n.dashboard':  ['Dashboard','Dashboard','Panel'],
  'd.dashboard':  ['Resumo e atalhos para começar','Overview and quick start','Resumen y accesos rápidos'],
  'n.tutorials':  ['Meus tutoriais','My tutorials','Mis tutoriales'],
  'd.tutorials':  ['Criar, abrir e excluir tutoriais','Create, open and delete tutorials','Crear, abrir y eliminar tutoriales'],
  'n.library':    ['Biblioteca','Library','Biblioteca'],
  'd.library':    ['Estilos de destaque e elementos','Highlight styles and elements','Estilos de resalte y elementos'],
  'n.exports':    ['Exportar','Export','Exportar'],
  'd.exports':    ['Formato, moldura e animação','Format, frame and animation','Formato, marco y animación'],
  'n.projects':   ['Projetos e backup','Projects and backup','Proyectos y copia'],
  'd.projects':   ['Salvar e abrir arquivos de projeto','Save and open project files','Guardar y abrir proyectos'],
  'n.capture':    ['Captura de tela','Screen capture','Captura de pantalla'],
  'd.capture':    ['Gravar a tela ou tirar um print','Record the screen or take a screenshot','Grabar la pantalla o hacer una captura'],
  'n.webcam':     ['Webcam','Webcam','Cámara web'],
  'd.webcam':     ['Câmera, formato e posição','Camera, shape and position','Cámara, forma y posición'],
  'n.video':      ['Editor de vídeo','Video editor','Editor de video'],
  'd.video':      ['Cortar, acelerar, zoom e texto','Trim, speed, zoom and text','Recortar, acelerar, zoom y texto'],
  'n.audio':      ['Áudio','Audio','Audio'],
  'd.audio':      ['Gravar narração e ouvir','Record narration and listen','Grabar narración y escuchar'],
  'n.extensions': ['Extensões','Extensions','Extensiones'],
  'd.extensions': ['Molduras, presets e opções extras','Frames, presets and extra options','Marcos, presets y opciones extra'],
  'n.shortcuts':  ['Atalhos','Shortcuts','Atajos'],
  'd.shortcuts':  ['Teclas rápidas editáveis','Editable hotkeys','Teclas rápidas editables'],
  'n.settings':   ['Configurações','Settings','Configuración'],
  'd.settings':   ['Tema, cor, idioma e armazenamento','Theme, color, language and storage','Tema, color, idioma y almacenamiento'],
  't.exports':    ['Exportar','Export','Exportar'],
  's.exports':    ['Formato, qualidade, moldura e animação — vale para PDF, GIF, vídeo e HTML','Format, quality, frame and animation — applies to PDF, GIF, video and HTML','Formato, calidad, marco y animación — vale para PDF, GIF, video y HTML'],
  't.projects':   ['Projetos e backup','Projects and backup','Proyectos y copia de seguridad'],
  's.projects':   ['Salve tutoriais em arquivo e abra em outro computador','Save tutorials to a file and open them on another computer','Guarde tutoriales en un archivo y ábralos en otro equipo'],
  't.shortcuts':  ['Atalhos de teclado','Keyboard shortcuts','Atajos de teclado'],
  's.shortcuts':  ['Clique em Alterar e pressione a nova combinação','Click Change and press the new combination','Haga clic en Cambiar y presione la nueva combinación'],
  't.settings':   ['Configurações','Settings','Configuración'],
  's.settings':   ['Personalize a aparência do Tutor SNC','Customize the look of Tutor SNC','Personalice la apariencia de Tutor SNC'],
  't.dashboard':  ['Dashboard','Dashboard','Panel'],
  't.tutorials':  ['Meus tutoriais','My tutorials','Mis tutoriales'],
  't.library':    ['Biblioteca de elementos','Element library','Biblioteca de elementos'],
  's.library':    ['Estilos de destaque, cursores e componentes visuais','Highlight styles, cursors and visual components','Estilos de resalte, cursores y componentes visuales'],
  'b.newTutorial':['Novo tutorial','New tutorial','Nuevo tutorial'],
  'lang':         ['Idioma','Language','Idioma']
};
const I18n = {
  idx(){ return {pt:0, en:1, es:2}[State.lang] ?? 0; },
  t(key){ const e = I18N_DICT[key]; return e ? (e[this.idx()] || e[0]) : key; },
  apply(){
    document.documentElement.setAttribute('lang', {pt:'pt-BR', en:'en', es:'es'}[State.lang] || 'pt-BR');
    document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = this.t(el.dataset.i18n); });
  }
};
const tr = (k) => I18n.t(k);

/* ===========================================================
   OPÇÕES DE EXPORTAÇÃO — painel único usado no modal e na tela "Exportar"
   =========================================================== */
const ExportUI = {
  html(){
    const frames = Object.entries(FRAME_PRESETS).map(([id, f]) => `<option value="${id}">${escapeHtml(f.label)}</option>`).join('');
    return `
      <details class="export-opts">
        <summary>Opções de exportação <span>qualidade, proporção, moldura e animação</span></summary>
        <div class="eo-grid">
          <label class="eo-field"><span>Qualidade</span>
            <select data-eo="quality"><option value="low">Rascunho (leve)</option><option value="med">Padrão</option><option value="high">Alta</option></select></label>
          <label class="eo-field"><span>Proporção</span>
            <select data-eo="aspect"><option value="16:9">16:9 · widescreen</option><option value="4:3">4:3 · clássico</option><option value="1:1">1:1 · quadrado</option><option value="9:16">9:16 · vertical</option></select></label>
          <label class="eo-field"><span>Moldura (fundo)</span>
            <select data-eo="frame">${frames}</select></label>
          <label class="eo-field"><span>Quadros por segundo (GIF)</span>
            <select data-eo="fps"><option value="6">6 · leve</option><option value="10">10 · padrão</option><option value="15">15 · suave</option></select></label>
          <label class="eo-field"><span>Espaçamento <b data-eo-v="pad"></b></span>
            <input type="range" data-eo="pad" min="0" max="12" step="1"></label>
          <label class="eo-field"><span>Cantos arredondados <b data-eo-v="radius"></b></span>
            <input type="range" data-eo="radius" min="0" max="32" step="2"></label>
        </div>
        <div class="eo-checks">
          <label><input type="checkbox" data-eo="anim"> Animar GIF e vídeo (destaque pulsando, zoom e cursor)</label>
          <label><input type="checkbox" data-eo="zoom"> Zoom no destaque (nos passos que tiverem zoom)</label>
          <label><input type="checkbox" data-eo="cursor"> Cursor animado indo até o destaque</label>
          <label><input type="checkbox" data-eo="shadow"> Sombra na tela</label>
          <label><input type="checkbox" data-eo="loop"> GIF em loop infinito</label>
        </div>
      </details>`;
  },
  mount(host, onChange){
    if(!host) return;
    host.innerHTML = this.html();
    if(!host.dataset.collapsed){ const dt = host.querySelector('details.export-opts'); if(dt) dt.open = true; }
    const num = ['pad','radius','fps'];
    host.querySelectorAll('[data-eo]').forEach(el => {
      const k = el.dataset.eo;
      if(el.type === 'checkbox') el.checked = !!ExportOpts[k];
      else el.value = String(ExportOpts[k]);
      const upd = () => {
        let v = el.type === 'checkbox' ? el.checked : el.value;
        if(num.includes(k)) v = Number(v);
        ExportOpts[k] = v;
        const lab = host.querySelector(`[data-eo-v="${k}"]`);
        if(lab) lab.textContent = k === 'pad' ? v + '%' : v + 'px';
        Persist.saveSettings();
        onChange && onChange();
      };
      el.addEventListener(el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input', upd);
      const lab = host.querySelector(`[data-eo-v="${k}"]`);
      if(lab) lab.textContent = k === 'pad' ? ExportOpts.pad + '%' : ExportOpts.radius + 'px';
    });
  },
  // Pré-visualização: usa a primeira tela com passo, ou uma tela de exemplo
  sampleStep(){
    for(const t of State.tutorials){
      for(const sc of t.screens){
        if(sc.steps[0] && sc.imgEl && sc.imgEl.naturalWidth){
          return { step: { ...sc.steps[0], imgEl: sc.imgEl, annotations: sc.annotations||[] }, brand: t.brand };
        }
      }
    }
    const c = document.createElement('canvas'); c.width = 1280; c.height = 800;
    const x = c.getContext('2d');
    x.fillStyle = '#ffffff'; x.fillRect(0,0,1280,800);
    x.fillStyle = '#f5f5f7'; x.fillRect(0,0,1280,64); x.fillRect(0,64,230,736);
    x.fillStyle = '#d2d2d7';
    for(let i=0;i<6;i++){ x.fillRect(24, 96+i*44, 160, 14); }
    x.fillStyle = '#e5e5ea'; for(let i=0;i<5;i++){ x.fillRect(270, 110+i*90, 900, 58); }
    x.fillStyle = '#007aff'; x.fillRect(1020, 20, 120, 28);
    Object.defineProperty(c, 'naturalWidth', {value: 1280});
    Object.defineProperty(c, 'naturalHeight', {value: 800});
    return { step: { imgEl: c, xPct: 78, yPct: 2.5, wPct: 10, hPct: 4.5, title: 'Exemplo de passo', text: 'Assim fica o seu tutorial exportado com esta moldura.', position: 'auto', zoom: 1, annotations: [] }, brand: null };
  },
  drawPreview(canvas){
    if(!canvas) return;
    const { W, H } = exportDims('video');
    canvas.width = Math.min(W, 960); canvas.height = Math.round(canvas.width*H/W);
    const { step, brand } = this.sampleStep();
    try { renderStepToCanvas(step, canvas, 0, 3, brand, null, undefined, { t: 0.8, sec: 0.5, prev: null, prevCenter: null }); }
    catch(e){ console.warn('preview', e); }
  }
};

/* Histórico simples de exportações (somente nomes e datas) */
const ExportLog = {
  KEY: 'tutor_snc_exportlog_v1',
  list(){ try { return JSON.parse(localStorage.getItem(this.KEY) || '[]'); } catch(e){ return []; } },
  add(name){
    const ext = (name.split('.').pop() || '').toLowerCase();
    if(!['html','pdf','gif','webm','json','mp4','png'].includes(ext)) return;
    const l = this.list(); l.unshift({ name, ext, at: now() });
    try { localStorage.setItem(this.KEY, JSON.stringify(l.slice(0, 15))); } catch(e){}
  },
  clear(){ try { localStorage.removeItem(this.KEY); } catch(e){} }
};

Views.exports = function(){
  const root = document.getElementById('view-root');
  const withSteps = State.tutorials.filter(t => t.screens.some(s => s.steps.length));
  const log = ExportLog.list();
  root.innerHTML = `
    <div class="workspace-header"><div>
      <div class="workspace-title">${tr('t.exports')}</div>
      <div class="workspace-sub">${tr('s.exports')}</div></div></div>
    <div class="workspace-body" style="max-width:880px;">
      <div class="v4-card">
        <h4>Prévia da moldura</h4>
        <p>Mostra como cada passo sai no PDF, GIF e vídeo com as opções abaixo (usa o primeiro passo de um tutorial seu, ou um exemplo).</p>
        <div class="studio-stage" style="aspect-ratio:auto;background:transparent;box-shadow:none;"><canvas id="ev-preview" style="width:100%;border-radius:12px;box-shadow:var(--shadow);"></canvas></div>
      </div>
      <div class="v4-card"><h4>Opções</h4><p>Ficam salvas e valem para todas as exportações.</p><div id="ev-opts"></div></div>
      <div class="v4-card">
        <h4>Exportar um tutorial</h4>
        <p>Escolha o tutorial; o formato (HTML, PDF, GIF ou vídeo) você define na janela seguinte.</p>
        ${withSteps.length ? `<div class="rec-list">${withSteps.map(t => `
          <div class="rec-item">
            <div class="rec-meta"><div class="rec-name">${escapeHtml(t.name)}</div>
            <div class="rec-info">${t.screens.reduce((a,s)=>a+s.steps.length,0)} passo(s) · ${fmtDate(t.updatedAt)}</div></div>
            <button class="btn btn-primary btn-sm btn-pill" onclick="Exports.quick('${t.id}')">Exportar</button>
          </div>`).join('')}</div>` : '<div class="v4-empty">Nenhum tutorial com passos ainda. Crie um tutorial e marque ao menos um passo.</div>'}
      </div>
      <div class="v4-card">
        <div class="v4-row spread"><h4>Últimas exportações</h4>${log.length ? '<button class="btn btn-secondary btn-sm" onclick="ExportLog.clear();Views.exports()">Limpar</button>' : ''}</div>
        ${log.length ? `<div class="rec-list" style="margin-top:10px;">${log.map(l => `
          <div class="rec-item"><div class="rec-meta"><div class="rec-name">${escapeHtml(l.name)}</div><div class="rec-info">${fmtDate(l.at)}</div></div><span class="v4-tag">${escapeHtml(l.ext.toUpperCase())}</span></div>`).join('')}</div>` : '<p class="v4-sub" style="margin:8px 0 0;">Ainda nada por aqui. Os arquivos ficam na sua pasta de downloads; aqui só aparece o registro.</p>'}
      </div>
    </div>`;
  const prev = () => ExportUI.drawPreview(document.getElementById('ev-preview'));
  ExportUI.mount(document.getElementById('ev-opts'), prev);
  prev();
};
const Exports = {
  quick(id){
    const t = State.tutorials.find(x => x.id === id); if(!t) return;
    State.editor.tutorialId = id;
    Editor.exportOpen();
  }
};

// abrir o modal de exportação: monta o painel de opções com os valores atuais
const _origExportOpen = Editor.exportOpen;
Editor.exportOpen = function(){
  ExportUI.mount(document.getElementById('export-opts-host'));
  _origExportOpen.call(this);
};

/* ===========================================================
   PROJETOS — salvar / abrir arquivo de projeto (.json)
   =========================================================== */
const Projects = {
  FORMAT: 'tutor-snc-project',
  clean(t){
    return { ...t, screens: t.screens.map(s => ({
      id: s.id, name: s.name, customName: s.customName || null, dataUrl: s.dataUrl,
      steps: s.steps, annotations: s.annotations || [], collapsed: !!s.collapsed })) };
  },
  pack(list){ return { format: this.FORMAT, version: 1, build: BUILD_ID, exportedAt: new Date().toISOString(), tutorials: list.map(t => this.clean(t)) }; },
  download(obj, filename){
    downloadBlob(new Blob([JSON.stringify(obj)], {type:'application/json'}), filename);
  },
  exportOne(id){
    const t = State.tutorials.find(x => x.id === id); if(!t) return;
    this.download(this.pack([t]), t.name.replace(/[^\w]+/g, '-') + '.tutor.json');
    toast('Projeto salvo');
  },
  exportAll(){
    if(!State.tutorials.length){ toast('Nenhum tutorial para salvar'); return; }
    this.download(this.pack(State.tutorials), 'tutor-snc-backup.tutor.json');
    toast('Backup baixado');
  },
  pickFile(){
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json,application/json'; inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.onchange = () => { const f = inp.files[0]; inp.remove(); if(f) this.importFile(f); };
    inp.click();
  },
  importFile(file){
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const data = JSON.parse(rd.result);
        const n = this.importData(data);
        toast(n + ' tutorial' + (n !== 1 ? 'is importados' : ' importado'));
        Views[State.view] && Views[State.view]();
        updateSidebarCounts();
      } catch(e){ console.error(e); toast('Arquivo inválido: não é um projeto do Tutor SNC'); }
    };
    rd.readAsText(file);
  },
  importData(data){
    if(!data || !Array.isArray(data.tutorials)) throw new Error('formato');
    const numOr = (v, d) => Number.isFinite(Number(v)) ? Number(v) : d;
    const styles = ['pulse','glow','ripple','dot','ring','simple'];
    const positions = ['auto','top','bottom','left','right'];
    let count = 0;
    data.tutorials.forEach(src => {
      if(!src || typeof src.name !== 'string' || !Array.isArray(src.screens)) return;
      const t = {
        id: uid(), name: src.name.slice(0, 160) || 'Tutorial importado',
        brand: { name: String((src.brand && src.brand.name) || '').slice(0, 120), logo: (src.brand && typeof src.brand.logo === 'string' && src.brand.logo.startsWith('data:image/')) ? src.brand.logo : '' },
        createdAt: numOr(src.createdAt, now()), updatedAt: now(), screens: []
      };
      src.screens.forEach(ss => {
        if(!ss || typeof ss.dataUrl !== 'string' || !ss.dataUrl.startsWith('data:image/')) return;
        const img = new Image(); img.src = ss.dataUrl;
        t.screens.push({
          id: uid(), name: String(ss.name || 'Tela').slice(0, 160), customName: ss.customName || null,
          dataUrl: ss.dataUrl, imgEl: img, collapsed: !!ss.collapsed,
          steps: (Array.isArray(ss.steps) ? ss.steps : []).map(st => ({
            id: uid(), xPct: numOr(st.xPct, 10), yPct: numOr(st.yPct, 10), wPct: numOr(st.wPct, 20), hPct: numOr(st.hPct, 10),
            title: String(st.title || '').slice(0, 300), text: String(st.text || '').slice(0, 2000),
            position: positions.includes(st.position) ? st.position : 'auto',
            hotspotStyle: styles.includes(st.hotspotStyle) ? st.hotspotStyle : 'pulse',
            zoom: [1,1.5,2,3].includes(Number(st.zoom)) ? Number(st.zoom) : 1
          })),
          annotations: (Array.isArray(ss.annotations) ? ss.annotations : []).filter(a => a && ANNOTATION_TYPES[a.type]).map(a => ({
            id: uid(), type: a.type, xPct: numOr(a.xPct, 50), yPct: numOr(a.yPct, 50),
            ...(ANNOTATION_TYPES[a.type].twoPoint ? { x2Pct: numOr(a.x2Pct, 60), y2Pct: numOr(a.y2Pct, 60) } : {}),
            ...(ANNOTATION_TYPES[a.type].hasText ? { text: String(a.text || '').slice(0, 300) } : {}),
            ...(a.type === 'image' && typeof a.dataUrl === 'string' && a.dataUrl.startsWith('data:image/') ? { dataUrl: a.dataUrl } : {})
          }))
        });
      });
      State.tutorials.push(t); count++;
    });
    if(!count) throw new Error('vazio');
    Persist.saveData();
    return count;
  },
  usage(){
    let chars = 0;
    try { for(let i = 0; i < localStorage.length; i++){ const k = localStorage.key(i); chars += k.length + (localStorage.getItem(k) || '').length; } } catch(e){}
    const bytes = chars*2, quota = 5*1024*1024;
    return { bytes, pct: Math.min(100, Math.round(bytes/quota*100)) };
  }
};
Settings.exportAll = () => Projects.exportAll();

Views.projects = function(){
  const root = document.getElementById('view-root');
  const u = Projects.usage();
  root.innerHTML = `
    <div class="workspace-header"><div>
      <div class="workspace-title">${tr('t.projects')}</div>
      <div class="workspace-sub">${tr('s.projects')}</div></div>
      <div class="workspace-actions">
        <button class="btn btn-secondary btn-pill" onclick="Projects.pickFile()">Abrir projeto</button>
        <button class="btn btn-primary btn-pill" onclick="Projects.exportAll()">Salvar todos</button>
      </div></div>
    <div class="workspace-body" style="max-width:820px;">
      <div class="v4-card">
        <h4>Armazenamento deste navegador</h4>
        <p>Os tutoriais ficam salvos aqui (cerca de 5 MB). Se encher, salve um projeto e exclua os que não usa mais.</p>
        <div class="meter" style="height:10px;"><div style="width:${u.pct}%;"></div></div>
        <div class="v4-help" style="margin-top:6px;">${(u.bytes/1048576).toFixed(1)} MB usados · ${u.pct}% do limite estimado</div>
      </div>
      <div class="v4-card">
        <h4>Seus tutoriais</h4>
        <p>Cada projeto vira um arquivo <b>.tutor.json</b> com telas, passos, elementos, marca e zoom. Abra-o em qualquer computador.</p>
        ${State.tutorials.length ? `<div class="rec-list">${State.tutorials.map(t => `
          <div class="rec-item">
            <div class="rec-meta"><div class="rec-name">${escapeHtml(t.name)}</div>
              <div class="rec-info">${t.screens.length} tela(s) · ${t.screens.reduce((a,s)=>a+s.steps.length,0)} passo(s) · ${fmtDate(t.updatedAt)}</div></div>
            <button class="btn btn-secondary btn-sm btn-pill" onclick="Projects.exportOne('${t.id}')">Salvar projeto</button>
          </div>`).join('')}</div>` : '<div class="v4-empty">Nenhum tutorial ainda.</div>'}
      </div>
      <div class="v4-card">
        <h4>Abrir um projeto</h4>
        <p>Importa um arquivo salvo aqui (ou um backup antigo). Os tutoriais são <b>adicionados</b> aos que você já tem — nada é substituído.</p>
        <button class="btn btn-secondary btn-pill" onclick="Projects.pickFile()">Escolher arquivo…</button>
      </div>
    </div>`;
};

/* ===========================================================
   ATALHOS — registro editável
   =========================================================== */
const Shortcuts = {
  recording: null,
  defs: [
    { id:'newStep',    group:'Editor', label:'Novo passo (desenhar área)', def:'N',      run:() => Editor.startDraw() },
    { id:'addScreen',  group:'Editor', label:'Adicionar tela (enviar print)', def:'U',   run:() => Editor.upload() },
    { id:'preview',    group:'Editor', label:'Visualizar o tutorial',      def:'P',      run:() => Editor.play() },
    { id:'export',     group:'Editor', label:'Exportar',                   def:'E',      run:() => Editor.exportOpen() },
    { id:'deleteStep', group:'Editor', label:'Excluir passo selecionado',  def:'Delete', run:() => { if(State.editor.activeStepId) Editor.deleteStep(); } },
    { id:'undo',       group:'Editor', label:'Desfazer exclusão',          def:'Ctrl+Z', run:() => Editor.undo() },
    { id:'zoomIn',     group:'Tela',   label:'Aumentar zoom da tela',      def:'+',      run:() => Editor.zoomBy(0.15) },
    { id:'zoomOut',    group:'Tela',   label:'Diminuir zoom da tela',      def:'-',      run:() => Editor.zoomBy(-0.15) },
    { id:'zoomReset',  group:'Tela',   label:'Zoom 100%',                  def:'0',      run:() => Editor.zoomReset() }
  ],
  fixed: [
    ['Setas ← ↑ → ↓', 'Mover o passo selecionado (Shift = mais rápido)'],
    ['Ctrl + roda do mouse', 'Zoom da tela no editor'],
    ['Duplo clique na tela', 'Desenhar um passo'],
    ['→ ou Espaço / ←', 'Próximo / anterior no Visualizar'],
    ['Esc', 'Fechar o Visualizar']
  ],
  combo(e){
    let k = e.key;
    if(['Control','Shift','Alt','Meta'].includes(k)) return null;
    if(k === '=') k = '+';
    if(k === ' ') k = 'Space';
    const letter = k.length === 1 && /[a-z0-9]/i.test(k);
    const parts = [];
    if(e.ctrlKey || e.metaKey) parts.push('Ctrl');
    if(e.altKey) parts.push('Alt');
    if(e.shiftKey && (k.length > 1 || letter)) parts.push('Shift');
    parts.push(k.length === 1 ? k.toUpperCase() : k);
    return parts.join('+');
  },
  keyOf(d){ return State.shortcuts[d.id] || d.def; },
  dispatch(e){
    if(this.recording) return false;
    const c = this.combo(e); if(!c) return false;
    const d = this.defs.find(x => this.keyOf(x) === c);
    if(!d) return false;
    e.preventDefault(); d.run(); return true;
  },
  startRecord(id){ this.recording = id; Views.shortcuts(); },
  setKey(id, combo){
    const clash = this.defs.find(x => x.id !== id && this.keyOf(x) === combo);
    if(clash){ toast('Já usada em: ' + clash.label); return false; }
    State.shortcuts[id] = combo; Persist.saveSettings(); return true;
  },
  reset(id){ delete State.shortcuts[id]; Persist.saveSettings(); Views.shortcuts(); },
  resetAll(){ State.shortcuts = {}; Persist.saveSettings(); Views.shortcuts(); toast('Atalhos restaurados'); }
};
// Captura da nova combinação (fase de captura: ganha dos demais atalhos)
document.addEventListener('keydown', e => {
  if(!Shortcuts.recording) return;
  e.preventDefault(); e.stopPropagation();
  if(e.key === 'Escape'){ Shortcuts.recording = null; Views.shortcuts(); return; }
  const c = Shortcuts.combo(e); if(!c) return;
  const id = Shortcuts.recording;
  if(Shortcuts.setKey(id, c)) Shortcuts.recording = null;
  Views.shortcuts();
}, true);

Views.shortcuts = function(){
  const root = document.getElementById('view-root');
  const groups = [...new Set(Shortcuts.defs.map(d => d.group))];
  const chips = k => k.split('+').map(p => `<span class="sc-kbd">${escapeHtml(p)}</span>`).join('');
  root.innerHTML = `
    <div class="workspace-header"><div>
      <div class="workspace-title">${tr('t.shortcuts')}</div>
      <div class="workspace-sub">${tr('s.shortcuts')}</div></div>
      <div class="workspace-actions"><button class="btn btn-secondary btn-pill" onclick="Shortcuts.resetAll()">Restaurar padrão</button></div></div>
    <div class="workspace-body" style="max-width:760px;">
      <div class="v4-card">
        ${groups.map(g => `
          <div class="sc-group">${g}</div>
          <table class="sc-table">${Shortcuts.defs.filter(d => d.group === g).map(d => `
            <tr><td>${d.label}${State.shortcuts[d.id] ? ' <span class="v4-tag">alterado</span>' : ''}</td>
            <td style="width:260px;"><div class="sc-keys">
              ${Shortcuts.recording === d.id ? '<span class="sc-kbd rec">Pressione a combinação… (Esc cancela)</span>' : chips(Shortcuts.keyOf(d))}
              <button class="btn btn-secondary btn-sm btn-pill" onclick="Shortcuts.startRecord('${d.id}')">Alterar</button>
              ${State.shortcuts[d.id] ? `<button class="btn btn-sm" title="Voltar ao padrão" onclick="Shortcuts.reset('${d.id}')" style="color:var(--text-muted);">↺</button>` : ''}
            </div></td></tr>`).join('')}</table>`).join('')}
      </div>
      <div class="v4-card">
        <h4>Fixos (não editáveis)</h4>
        <table class="sc-table">${Shortcuts.fixed.map(([k, d]) => `<tr><td>${d}</td><td style="text-align:right;"><span class="sc-kbd">${escapeHtml(k)}</span></td></tr>`).join('')}</table>
      </div>
    </div>`;
};

/* ===========================================================
   CONFIGURAÇÕES — idioma + importar projeto (complementa a tela)
   =========================================================== */
Settings.setLang = function(l){ State.lang = l; Persist.saveSettings(); I18n.apply(); Views[State.view] && Views[State.view](); };
const _origSettingsView = Views.settings;
Views.settings = function(){
  _origSettingsView.call(Views);
  const body = document.querySelector('#view-root .workspace-body');
  if(!body) return;
  const t = document.getElementById('view-root').querySelector('.workspace-title'); if(t) t.textContent = tr('t.settings');
  const sub = document.getElementById('view-root').querySelector('.workspace-sub'); if(sub) sub.textContent = tr('s.settings');
  const card = document.createElement('div');
  card.className = 'settings-card';
  card.innerHTML = `<h4>${tr('lang')}</h4>
    <p>Idioma do menu, dos títulos e da exportação. O editor interno ainda está em português.</p>
    <div class="seg">${[['pt','Português'],['en','English'],['es','Español']].map(([k,l]) => `<button class="${State.lang===k?'on':''}" onclick="Settings.setLang('${k}')">${l}</button>`).join('')}</div>`;
  body.insertBefore(card, body.children[2] || null);
};

/* ===========================================================
   NAV BINDINGS + INIT
   =========================================================== */
document.querySelectorAll('.nav-item').forEach(el => {
  el.addEventListener('click', () => App.switchView(el.dataset.view));
});

Persist.load();
I18n.apply();
document.documentElement.setAttribute('data-theme', State.theme);
document.documentElement.setAttribute('data-accent', State.accent);
App.switchView('dashboard');
updateSidebarCounts();
