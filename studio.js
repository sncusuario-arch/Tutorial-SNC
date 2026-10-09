/* ===========================================================
   TUTOR SNC — ESTÚDIO (v4.0)
   Captura de tela · Webcam · Editor de vídeo · Áudio · Extensões
   Tudo roda no navegador. Gravações ficam no IndexedDB deste navegador.
   Depende de app.js (State, Views, App, Editor, Persist, toast, FRAME_PRESETS...).
   =========================================================== */
'use strict';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const fmtClock = (sec) => {
  sec = Math.max(0, sec || 0);
  const m = Math.floor(sec/60), s = Math.floor(sec % 60);
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
};
const fmtBytes = (b) => b > 1048576 ? (b/1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b/1024)) + ' KB';
const ico = (d, extra) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" ${extra||''}>${d}</svg>`;
const ICON = {
  rec:   ico('<circle cx="12" cy="12" r="6" fill="currentColor"/>'),
  stop:  ico('<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>'),
  play:  ico('<path d="M7 4l13 8-13 8V4z" fill="currentColor"/>'),
  pause: ico('<path d="M8 5v14M16 5v14"/>'),
  cam:   ico('<path d="M3 7h4l2-3h6l2 3h4v13H3z"/><circle cx="12" cy="13" r="4"/>'),
  dl:    ico('<path d="M12 3v13m0 0l-5-5m5 5l5-5M4 21h16"/>'),
  trash: ico('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
  edit:  ico('<path d="M4 20h4l11-11-4-4L4 16v4z"/>'),
  plus:  ico('<path d="M12 5v14M5 12h14"/>'),
  send:  ico('<path d="M4 12l16-8-6 16-3-7-7-1z"/>')
};

/* ===========================================================
   ARMAZENAMENTO DE MÍDIA — IndexedDB (com fallback em memória)
   =========================================================== */
const MediaStore = {
  _db: null, _mem: new Map(),
  open(){
    if(this._db) return Promise.resolve(this._db);
    return new Promise(resolve => {
      if(!window.indexedDB){ resolve(null); return; }
      let req;
      try { req = indexedDB.open('tutor_snc_studio', 1); } catch(e){ resolve(null); return; }
      req.onupgradeneeded = () => { req.result.createObjectStore('media', { keyPath: 'id' }); };
      req.onsuccess = () => { this._db = req.result; resolve(this._db); };
      req.onerror = () => resolve(null);
    });
  },
  async put(rec){
    const db = await this.open();
    if(!db){ this._mem.set(rec.id, rec); return rec; }
    return new Promise((res, rej) => {
      const tx = db.transaction('media', 'readwrite');
      tx.objectStore('media').put(rec);
      tx.oncomplete = () => res(rec);
      tx.onerror = () => { this._mem.set(rec.id, rec); res(rec); };
    });
  },
  async all(){
    const db = await this.open();
    let list = [];
    if(db){
      list = await new Promise(res => {
        const rq = db.transaction('media').objectStore('media').getAll();
        rq.onsuccess = () => res(rq.result || []);
        rq.onerror = () => res([]);
      });
    }
    this._mem.forEach(v => { if(!list.find(x => x.id === v.id)) list.push(v); });
    return list.sort((a, b) => b.createdAt - a.createdAt);
  },
  async get(id){
    if(this._mem.has(id)) return this._mem.get(id);
    const db = await this.open(); if(!db) return null;
    return new Promise(res => {
      const rq = db.transaction('media').objectStore('media').get(id);
      rq.onsuccess = () => res(rq.result || null);
      rq.onerror = () => res(null);
    });
  },
  async del(id){
    this._mem.delete(id);
    const db = await this.open(); if(!db) return;
    return new Promise(res => {
      const tx = db.transaction('media', 'readwrite');
      tx.objectStore('media').delete(id);
      tx.oncomplete = () => res(); tx.onerror = () => res();
    });
  },
  async rename(id, name){
    const r = await this.get(id); if(!r) return;
    r.name = name; await this.put(r);
  }
};

/* Relógio que não "dorme" em aba em segundo plano (Worker) */
const Ticker = {
  start(fn, ms){
    let w;
    try {
      const src = 'setInterval(function(){postMessage(1)},' + ms + ');';
      w = new Worker(URL.createObjectURL(new Blob([src], {type:'application/javascript'})));
      w.onmessage = () => fn();
      return () => { w.terminate(); };
    } catch(e){
      const id = setInterval(fn, ms);
      return () => clearInterval(id);
    }
  }
};

/* Configurações do estúdio (localStorage separado) */
const StudioCfg = {
  KEY: 'tutor_snc_studio_cfg_v1',
  data: {
    capture: { countdown: 3, sysAudio: true, mic: false, useCam: false, compose: false, fps: 30 },
    webcam:  { shape: 'circle', size: 22, corner: 'br', mirror: true, deviceId: '' },
    mic:     { deviceId: '' }
  },
  load(){
    try {
      const d = JSON.parse(localStorage.getItem(this.KEY) || 'null');
      if(d){ ['capture','webcam','mic'].forEach(k => Object.assign(this.data[k], d[k] || {})); }
    } catch(e){}
  },
  save(){ try { localStorage.setItem(this.KEY, JSON.stringify(this.data)); } catch(e){} }
};
StudioCfg.load();

/* ===========================================================
   SHELL: cabeçalho padrão, indicador de gravação, limpeza ao sair
   =========================================================== */
const Studio = {
  streams: new Set(),     // streams de pré-visualização (fecham ao sair da tela)
  header(key, actionsHTML){
    return `<div class="workspace-header"><div>
      <div class="workspace-title">${tr('n.' + key)}</div>
      <div class="workspace-sub">${tr('d.' + key)}</div></div>
      ${actionsHTML ? `<div class="workspace-actions">${actionsHTML}</div>` : ''}</div>`;
  },
  secure(){
    return window.isSecureContext && navigator.mediaDevices
      ? null
      : 'Gravação exige HTTPS ou localhost. Abra o sistema pelo link publicado (https) ou por http://localhost.';
  },
  track(stream){ this.streams.add(stream); return stream; },
  stopStream(stream){ if(!stream) return; try { stream.getTracks().forEach(t => t.stop()); } catch(e){} this.streams.delete(stream); },
  leave(){
    // fecha câmera/microfone de pré-visualização; NÃO interrompe uma gravação em andamento
    this.streams.forEach(s => { if(!Capture.isUsing(s)) this.stopStream(s); });
    WebcamView.stopPreview(true); AudioView.stopTest(true);
    VE.pause();
  },
  async thumbFromVideoBlob(blob){
    return new Promise(resolve => {
      const v = document.createElement('video');
      v.muted = true; v.preload = 'auto'; v.src = URL.createObjectURL(blob);
      const done = (d) => { URL.revokeObjectURL(v.src); resolve(d); };
      v.onloadeddata = () => { try { v.currentTime = 0.05; } catch(e){ done(''); } };
      v.onseeked = () => {
        try {
          const c = document.createElement('canvas'); c.width = 160; c.height = 90;
          c.getContext('2d').drawImage(v, 0, 0, 160, 90);
          done(c.toDataURL('image/jpeg', 0.7));
        } catch(e){ done(''); }
      };
      v.onerror = () => done('');
      setTimeout(() => done(''), 4000);
    });
  },
  // envia uma imagem para um tutorial (existente ou novo) como nova tela
  sendToTutorial(canvasOrDataUrl, suggested){
    let dataUrl = canvasOrDataUrl;
    if(typeof canvasOrDataUrl !== 'string') dataUrl = canvasOrDataUrl.toDataURL('image/jpeg', 0.9);
    const back = document.createElement('div');
    back.className = 'modal-backdrop on';
    const opts = State.tutorials.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
    back.innerHTML = `<div class="modal"><h2>Adicionar a um tutorial</h2>
      <p class="modal-sub">O quadro vira uma nova tela. Depois você marca os passos no editor.</p>
      <div class="field"><label>Tutorial</label>
        <select id="stt-select">${opts}<option value="__new">+ Novo tutorial…</option></select></div>
      <div class="field" id="stt-name-wrap" style="display:${State.tutorials.length ? 'none' : 'block'};"><label>Nome do novo tutorial</label>
        <input type="text" id="stt-name" placeholder="Ex: Como cadastrar um município"></div>
      <div class="modal-actions"><button class="btn btn-secondary" id="stt-cancel">Cancelar</button>
        <button class="btn btn-primary" id="stt-ok">Adicionar e abrir</button></div></div>`;
    document.body.appendChild(back);
    const sel = back.querySelector('#stt-select'), wrap = back.querySelector('#stt-name-wrap');
    if(!State.tutorials.length) sel.value = '__new';
    sel.onchange = () => { wrap.style.display = sel.value === '__new' ? 'block' : 'none'; };
    const close = () => back.remove();
    back.addEventListener('click', e => { if(e.target === back) close(); });
    back.querySelector('#stt-cancel').onclick = close;
    back.querySelector('#stt-ok').onclick = () => {
      let t;
      if(sel.value === '__new'){
        const name = back.querySelector('#stt-name').value.trim() || 'Tutorial sem nome';
        t = { id: uid(), name, screens: [], brand: {name:'', logo:''}, createdAt: now(), updatedAt: now() };
        State.tutorials.push(t);
      } else t = State.tutorials.find(x => x.id === sel.value);
      if(!t){ close(); return; }
      const img = new Image();
      img.onload = () => {
        const sc = { id: uid(), name: suggested || 'Captura', dataUrl, imgEl: img, steps: [], annotations: [], collapsed: false };
        t.screens.push(sc); t.updatedAt = now();
        const ok = Persist.saveData();
        close(); updateSidebarCounts();
        if(ok) toast('Tela adicionada ao tutorial');
        Editor.open(t.id);
        State.editor.activeScreenId = sc.id; Editor.render();
      };
      img.src = dataUrl;
    };
  },
  downloadDataUrl(dataUrl, name){
    fetch(dataUrl).then(r => r.blob()).then(b => downloadBlob(b, name));
  }
};

// indicador flutuante de gravação (visível em qualquer tela)
const RecBar = {
  el: null, timer: null,
  show(label, onStop){
    if(!this.el){
      this.el = document.createElement('div');
      this.el.style.cssText = 'position:fixed;top:14px;right:18px;z-index:400;display:flex;align-items:center;gap:10px;background:#1d1d1f;color:#fff;border-radius:9999px;padding:7px 8px 7px 14px;box-shadow:0 8px 28px rgba(0,0,0,.35);font-size:13px;';
      document.body.appendChild(this.el);
    }
    this.start = Date.now();
    this.el.innerHTML = `<span class="rec-dot"></span><span>${label}</span><span class="rec-timer" id="recbar-t">00:00</span>
      <button class="btn btn-sm btn-pill" style="background:#ff3b30;color:#fff;" id="recbar-stop">Parar</button>`;
    this.el.querySelector('#recbar-stop').onclick = onStop;
    this.el.style.display = 'flex';
    clearInterval(this.timer);
    this.timer = setInterval(() => {
      const t = document.getElementById('recbar-t'); if(t) t.textContent = fmtClock((Date.now() - this.start)/1000);
      const t2 = document.getElementById('cap-timer'); if(t2) t2.textContent = fmtClock((Date.now() - this.start)/1000);
    }, 250);
  },
  hide(){ clearInterval(this.timer); if(this.el) this.el.style.display = 'none'; }
};

// ao trocar de tela do menu, fecha pré-visualizações do estúdio
(function(){
  const sw = App.switchView;
  App.switchView = function(name){ Studio.leave(); return sw.call(this, name); };
})();

/* ===========================================================
   EXTENSÕES — declarativas (sem executar código de terceiros)
   Uma extensão é um arquivo JSON (tutor-extension.json) que pode somar:
     · frames    → novas molduras para exportação e vídeo
     · presets   → combinações prontas de opções de exportação
     · settings  → painel de opções (toggle, slider, select, color, text)
     · watermark → marca d'água desenhada em todos os quadros exportados
   =========================================================== */
const BASE_FRAMES = Object.assign({}, FRAME_PRESETS);

const BUILTIN_EXTENSIONS = [
  {
    id: 'snc.molduras-extra', name: 'Molduras extras', version: '1.0.0', builtin: true,
    description: 'Quatro fundos em degradê para dar acabamento aos GIFs, vídeos e PDFs.',
    contributes: { frames: [
      { id: 'oceano',  label: 'Oceano',   stops: ['#0a84ff', '#30d5c8'] },
      { id: 'lavanda', label: 'Lavanda',  stops: ['#a78bfa', '#f0abfc'] },
      { id: 'areia',   label: 'Areia',    stops: ['#f5e6d3', '#e9d5c0'] },
      { id: 'noite',   label: 'Noite',    stops: ['#0f172a', '#312e81'] }
    ] }
  },
  {
    id: 'snc.presets', name: 'Predefinições de exportação', version: '1.0.0', builtin: true,
    description: 'Atalhos que ajustam qualidade, proporção, moldura e animação de uma vez.',
    contributes: { presets: [
      { id: 'manual',  label: 'Manual impresso', opts: { aspect: '4:3', quality: 'high', frame: 'default', anim: false, cursor: false, zoom: false, pad: 3 } },
      { id: 'social',  label: 'Rede social (vertical)', opts: { aspect: '9:16', quality: 'med', frame: 'aurora', anim: true, cursor: true, zoom: true, pad: 6, radius: 18, shadow: true } },
      { id: 'leve',    label: 'Leve e rápido', opts: { aspect: '16:9', quality: 'low', frame: 'nenhum', anim: true, cursor: true, zoom: false, fps: 6 } },
      { id: 'demo',    label: 'Demonstração em vídeo', opts: { aspect: '16:9', quality: 'high', frame: 'azul', anim: true, cursor: true, zoom: true, pad: 5, radius: 16, shadow: true } }
    ] }
  },
  {
    id: 'snc.marca-dagua', name: "Marca d'água", version: '1.0.0', builtin: true,
    description: 'Escreve um texto discreto em um canto de todos os quadros exportados (PDF, GIF, vídeo) e do editor de vídeo.',
    contributes: {
      settings: [
        { key: 'on',      type: 'toggle', label: 'Ativar marca d\'água', default: false },
        { key: 'text',    type: 'text',   label: 'Texto', default: 'Tutor SNC' },
        { key: 'corner',  type: 'select', label: 'Canto', default: 'br', options: [
          { value: 'tl', label: 'Superior esquerdo' }, { value: 'tr', label: 'Superior direito' },
          { value: 'bl', label: 'Inferior esquerdo' }, { value: 'br', label: 'Inferior direito' } ] },
        { key: 'opacity', type: 'slider', label: 'Opacidade', default: 0.55, min: 0.1, max: 1, step: 0.05 },
        { key: 'color',   type: 'color',  label: 'Cor', default: '#ffffff' }
      ],
      watermark: { textFrom: 'text', enabledFrom: 'on', cornerFrom: 'corner', opacityFrom: 'opacity', colorFrom: 'color' }
    }
  }
];

const EXT_EXAMPLE = {
  id: 'meu.exemplo',
  name: 'Exemplo da minha equipe',
  version: '1.0.0',
  description: 'Uma moldura da cor da instituição e um preset pronto.',
  contributes: {
    frames: [{ id: 'instituicao', label: 'Cor da instituição', stops: ['#0b5fff', '#00b894'] }],
    presets: [{ id: 'oficial', label: 'Padrão oficial', opts: { aspect: '16:9', quality: 'med', frame: 'instituicao', anim: true, cursor: true, zoom: true } }],
    settings: [{ key: 'selo', type: 'text', label: 'Texto do selo', default: 'Material oficial' }],
    watermark: { textFrom: 'selo', corner: 'bl', opacity: 0.6 }
  }
};

const Extensions = {
  KEY: 'tutor_snc_ext_v1',
  st: { enabled: {}, settings: {}, user: {} },
  PRESET_KEYS: { quality:['low','med','high'], aspect:['16:9','4:3','1:1','9:16'], fps:[6,10,15] },
  load(){
    try { const d = JSON.parse(localStorage.getItem(this.KEY) || 'null'); if(d) this.st = Object.assign({ enabled:{}, settings:{}, user:{} }, d); } catch(e){}
    this.refresh();
  },
  save(){ try { localStorage.setItem(this.KEY, JSON.stringify(this.st)); } catch(e){ toast('Não foi possível salvar as extensões'); } },
  all(){
    const list = BUILTIN_EXTENSIONS.map(m => m);
    Object.values(this.st.user).forEach(m => list.push(m));
    return list;
  },
  isOn(id){ const m = this.all().find(x => x.id === id); const v = this.st.enabled[id]; return v === undefined ? !!(m && m.builtin) : !!v; },
  setting(ext, key){
    const def = ((ext.contributes.settings || []).find(s => s.key === key) || {}).default;
    const v = (this.st.settings[ext.id] || {})[key];
    return v === undefined ? def : v;
  },
  // Reconstrói FRAME_PRESETS a partir da base + extensões ligadas
  refresh(){
    Object.keys(FRAME_PRESETS).forEach(k => { if(!(k in BASE_FRAMES)) delete FRAME_PRESETS[k]; });
    this.all().filter(m => this.isOn(m.id)).forEach(m => {
      (m.contributes.frames || []).forEach(f => {
        const id = m.builtin ? f.id : (m.id + ':' + f.id);
        FRAME_PRESETS[id] = f.solid ? { label: f.label + ' · ' + m.name, solid: f.solid } : { label: f.label + (m.builtin ? '' : ' · ' + m.name), stops: f.stops };
      });
    });
    if(!FRAME_PRESETS[ExportOpts.frame]) ExportOpts.frame = 'default';
  },
  presets(){
    const out = [];
    this.all().filter(m => this.isOn(m.id)).forEach(m => (m.contributes.presets || []).forEach(p => {
      const opts = Object.assign({}, p.opts);
      if(opts.frame && !m.builtin && m.contributes.frames && m.contributes.frames.some(f => f.id === opts.frame)) opts.frame = m.id + ':' + opts.frame;
      out.push({ id: m.id + '/' + p.id, label: p.label, opts });
    }));
    return out;
  },
  presetBarHTML(){
    const ps = this.presets();
    return `<div class="v4-row" style="margin-bottom:12px;gap:6px;">
      <span class="v4-help" style="margin-right:4px;">Predefinições:</span>
      <button class="btn btn-secondary btn-sm btn-pill" data-preset="__default">Padrão</button>
      ${ps.map(p => `<button class="btn btn-secondary btn-sm btn-pill" data-preset="${escapeHtml(p.id)}">${escapeHtml(p.label)}</button>`).join('')}
    </div>`;
  },
  applyPreset(id){
    if(id === '__default'){
      Object.assign(ExportOpts, { quality:'med', aspect:'16:9', frame:'default', pad:3, radius:10, shadow:true, anim:true, zoom:true, cursor:true, fps:10, loop:true });
    } else {
      const p = this.presets().find(x => x.id === id); if(!p) return;
      Object.assign(ExportOpts, p.opts);
    }
    if(!FRAME_PRESETS[ExportOpts.frame]) ExportOpts.frame = 'default';
    Persist.saveSettings();
  },
  // gancho de renderização: marcas d'água de todas as extensões ligadas
  postRender(ctx, W, H, uiScale){
    const k = uiScale || Math.max(W, H)/1280;
    this.all().filter(m => this.isOn(m.id) && m.contributes.watermark).forEach(m => {
      const w = m.contributes.watermark;
      if(w.enabledFrom && !this.setting(m, w.enabledFrom)) return;
      const text = String(w.textFrom ? this.setting(m, w.textFrom) : (w.text || '')).slice(0, 80);
      if(!text) return;
      const corner = w.cornerFrom ? this.setting(m, w.cornerFrom) : (w.corner || 'br');
      const opacity = Number(w.opacityFrom ? this.setting(m, w.opacityFrom) : (w.opacity ?? 0.5));
      const color = w.colorFrom ? this.setting(m, w.colorFrom) : '#ffffff';
      ctx.save();
      ctx.globalAlpha = Math.max(0.05, Math.min(1, opacity));
      ctx.font = `600 ${14*k}px Inter, sans-serif`;
      ctx.fillStyle = /^#[0-9a-f]{6}$/i.test(color) ? color : '#ffffff';
      ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 4*k;
      ctx.textBaseline = 'middle';
      const mx = 18*k, my = 20*k;
      const tw = ctx.measureText(text).width;
      const x = corner.endsWith('l') ? mx : W - mx - tw;
      const y = corner.startsWith('t') ? my + 38*k : H - my;
      ctx.textAlign = 'left';
      ctx.fillText(text, x, y);
      ctx.restore();
    });
  },
  /* ---- validação do manifesto ---- */
  validate(m){
    const err = [];
    const isHex = c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
    if(!m || typeof m !== 'object' || Array.isArray(m)) return ['O arquivo precisa ser um objeto JSON.'];
    if(typeof m.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{2,60}$/.test(m.id)) err.push('"id" inválido (use letras minúsculas, números, ponto, hífen; 3 a 61 caracteres).');
    if(typeof m.name !== 'string' || !m.name.trim() || m.name.length > 60) err.push('"name" é obrigatório (até 60 caracteres).');
    if(typeof m.version !== 'string' || m.version.length > 20) err.push('"version" é obrigatório (ex: 1.0.0).');
    if(!m.contributes || typeof m.contributes !== 'object') { err.push('"contributes" é obrigatório.'); return err; }
    const c = m.contributes;
    const idRe = /^[a-z0-9_-]{1,30}$/;
    if(c.frames !== undefined){
      if(!Array.isArray(c.frames) || c.frames.length > 20) err.push('"frames" deve ser uma lista de até 20 itens.');
      else c.frames.forEach((f, i) => {
        if(!f || !idRe.test(f.id || '')) err.push('frames[' + i + '].id inválido.');
        if(typeof f.label !== 'string' || !f.label || f.label.length > 40) err.push('frames[' + i + '].label inválido.');
        if(!(isHex(f.solid) || (Array.isArray(f.stops) && f.stops.length === 2 && f.stops.every(isHex)))) err.push('frames[' + i + '] precisa de "stops" (2 cores #rrggbb) ou "solid".');
      });
    }
    if(c.presets !== undefined){
      if(!Array.isArray(c.presets) || c.presets.length > 10) err.push('"presets" deve ser uma lista de até 10 itens.');
      else c.presets.forEach((p, i) => {
        if(!p || !idRe.test(p.id || '')) err.push('presets[' + i + '].id inválido.');
        if(typeof p.label !== 'string' || !p.label || p.label.length > 40) err.push('presets[' + i + '].label inválido.');
        const o = p.opts || {};
        Object.keys(o).forEach(k => {
          const v = o[k];
          if(this.PRESET_KEYS[k]){ if(!this.PRESET_KEYS[k].includes(v)) err.push('presets[' + i + '].opts.' + k + ' inválido.'); }
          else if(k === 'pad'){ if(!(typeof v === 'number' && v >= 0 && v <= 12)) err.push('presets[' + i + '].opts.pad deve ser 0 a 12.'); }
          else if(k === 'radius'){ if(!(typeof v === 'number' && v >= 0 && v <= 32)) err.push('presets[' + i + '].opts.radius deve ser 0 a 32.'); }
          else if(['shadow','anim','zoom','cursor','loop'].includes(k)){ if(typeof v !== 'boolean') err.push('presets[' + i + '].opts.' + k + ' deve ser true/false.'); }
          else if(k === 'frame'){ if(typeof v !== 'string' || v.length > 60) err.push('presets[' + i + '].opts.frame inválido.'); }
          else err.push('presets[' + i + '].opts.' + k + ' não é uma opção conhecida.');
        });
      });
    }
    if(c.settings !== undefined){
      if(!Array.isArray(c.settings) || c.settings.length > 10) err.push('"settings" deve ser uma lista de até 10 itens.');
      else c.settings.forEach((s, i) => {
        if(!s || !/^[a-zA-Z0-9_]{1,30}$/.test(s.key || '')) err.push('settings[' + i + '].key inválida.');
        if(!['toggle','slider','select','color','text'].includes(s && s.type)) err.push('settings[' + i + '].type deve ser toggle, slider, select, color ou text.');
        if(typeof (s && s.label) !== 'string') err.push('settings[' + i + '].label é obrigatório.');
        if(s && s.type === 'select' && !(Array.isArray(s.options) && s.options.length && s.options.length <= 20 && s.options.every(o => o && typeof o.value === 'string' && typeof o.label === 'string'))) err.push('settings[' + i + '].options inválidas.');
        if(s && s.type === 'slider' && !(Number.isFinite(s.min) && Number.isFinite(s.max) && s.max > s.min)) err.push('settings[' + i + '] (slider) precisa de min e max.');
      });
    }
    if(c.watermark !== undefined && (typeof c.watermark !== 'object' || c.watermark === null)) err.push('"watermark" deve ser um objeto.');
    ['frames','presets','settings','watermark'].forEach(k => {});
    Object.keys(c).forEach(k => { if(!['frames','presets','settings','watermark'].includes(k)) err.push('"contributes.' + k + '" não é suportado.'); });
    return err;
  },
  install(m){
    const errs = this.validate(m);
    if(errs.length) return errs;
    if(BUILTIN_EXTENSIONS.some(b => b.id === m.id)) return ['Já existe uma extensão embutida com este id.'];
    // copia só os campos conhecidos (nunca guardamos nada além do manifesto validado)
    const clean = JSON.parse(JSON.stringify({ id: m.id, name: m.name, version: m.version, description: String(m.description || '').slice(0, 300), author: String(m.author || '').slice(0, 60), contributes: m.contributes }));
    this.st.user[clean.id] = clean;
    this.st.enabled[clean.id] = true;
    this.save(); this.refresh();
    return [];
  },
  remove(id){
    delete this.st.user[id]; delete this.st.enabled[id]; delete this.st.settings[id];
    this.save(); this.refresh();
  }
};
Extensions.load();

/* ---- tela Extensões ---- */
Views.extensions = function(){
  const root = document.getElementById('view-root');
  const card = (m) => {
    const c = m.contributes, on = Extensions.isOn(m.id);
    const tags = [];
    if(c.frames) tags.push(c.frames.length + ' moldura' + (c.frames.length > 1 ? 's' : ''));
    if(c.presets) tags.push(c.presets.length + ' predefinição' + (c.presets.length > 1 ? 'ões' : ''));
    if(c.settings) tags.push('opções');
    if(c.watermark) tags.push("marca d'água");
    const sets = (on && c.settings) ? `<div class="ext-settings">${c.settings.map(s => {
      const v = Extensions.setting(m, s.key);
      const id = `${m.id}|${s.key}`;
      let ctl = '';
      if(s.type === 'toggle') ctl = `<label class="v4-switch"><input type="checkbox" ${v ? 'checked' : ''} onchange="ExtUI.set('${m.id}','${s.key}',this.checked)"><span></span></label>`;
      else if(s.type === 'slider') ctl = `<div class="v4-range" style="width:180px;"><input type="range" min="${s.min}" max="${s.max}" step="${s.step || 1}" value="${v}" oninput="this.nextElementSibling.textContent=this.value;ExtUI.set('${m.id}','${s.key}',Number(this.value))"><output>${v}</output></div>`;
      else if(s.type === 'select') ctl = `<select class="v4-select" onchange="ExtUI.set('${m.id}','${s.key}',this.value)">${s.options.map(o => `<option value="${escapeHtml(o.value)}" ${o.value === v ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}</select>`;
      else if(s.type === 'color') ctl = `<input type="color" value="${escapeHtml(v)}" onchange="ExtUI.set('${m.id}','${s.key}',this.value)">`;
      else ctl = `<input class="v4-input" type="text" maxlength="80" value="${escapeHtml(v)}" onchange="ExtUI.set('${m.id}','${s.key}',this.value)" style="width:200px;">`;
      return `<div class="ext-set-row"><span>${escapeHtml(s.label)}</span>${ctl}</div>`;
    }).join('')}</div>` : '';
    return `<div class="v4-card ext-card">
      <div class="ext-head">
        <div class="ext-icon">${ico('<path d="M10 3h4v4a2 2 0 104 0h3v5h-3a2 2 0 100 4h3v5h-5v-3a2 2 0 10-4 0v3H4v-5h3a2 2 0 100-4H4V7h4V3z"/>')}</div>
        <div style="flex:1;min-width:0;"><div class="ext-title">${escapeHtml(m.name)} <span class="v4-tag ${m.builtin ? '' : 'warn'}">${m.builtin ? 'embutida' : 'instalada'}</span></div>
          <div class="ext-meta">v${escapeHtml(m.version)} · ${escapeHtml(m.id)}</div></div>
        <label class="v4-switch" title="Ligar/desligar"><input type="checkbox" ${on ? 'checked' : ''} onchange="ExtUI.toggle('${m.id}',this.checked)"><span></span></label>
      </div>
      <div class="v4-help">${escapeHtml(m.description || '')}</div>
      <div class="ext-contrib">${tags.map(t => `<span class="v4-tag off">${t}</span>`).join('')}</div>
      ${sets}
      ${m.builtin ? '' : `<div><button class="btn btn-secondary btn-sm btn-danger-ghost" onclick="ExtUI.remove('${m.id}')">Remover</button></div>`}
    </div>`;
  };
  root.innerHTML = Studio.header('extensions', `<button class="btn btn-secondary btn-pill" onclick="ExtUI.pickFile()">Instalar arquivo…</button>`) + `
    <div class="workspace-body" style="max-width:900px;">
      <div class="v4-card">
        <h4>Como funcionam</h4>
        <p>Extensões são arquivos <b>.json</b> que acrescentam molduras, predefinições de exportação, painéis de opções e marca d'água. Elas <b>não executam código</b> — o sistema só lê e valida o arquivo, então instalar é seguro.</p>
        <div class="v4-row">
          <button class="btn btn-secondary btn-sm btn-pill" onclick="ExtUI.showExample()">Ver exemplo de arquivo</button>
          <button class="btn btn-secondary btn-sm btn-pill" onclick="ExtUI.downloadExample()">Baixar exemplo</button>
        </div>
        <div id="ext-install-area" style="margin-top:12px;display:none;">
          <textarea class="ext-code" id="ext-code" spellcheck="false" placeholder='Cole aqui o conteúdo do tutor-extension.json'></textarea>
          <div id="ext-errors" class="v4-help" style="color:#d92d20;margin:6px 0;"></div>
          <button class="btn btn-primary btn-sm btn-pill" onclick="ExtUI.installFromText()">Instalar</button>
        </div>
      </div>
      <div class="v4-grid" style="grid-template-columns:repeat(auto-fill,minmax(380px,1fr));">${Extensions.all().map(card).join('')}</div>
    </div>`;
};
const ExtUI = {
  toggle(id, on){ Extensions.st.enabled[id] = on; Extensions.save(); Extensions.refresh(); Views.extensions(); },
  set(id, key, v){ (Extensions.st.settings[id] = Extensions.st.settings[id] || {})[key] = v; Extensions.save(); },
  remove(id){ if(confirm('Remover esta extensão?')){ Extensions.remove(id); Views.extensions(); toast('Extensão removida'); } },
  showExample(){
    const a = document.getElementById('ext-install-area'); a.style.display = 'block';
    document.getElementById('ext-code').value = JSON.stringify(EXT_EXAMPLE, null, 2);
  },
  downloadExample(){ downloadBlob(new Blob([JSON.stringify(EXT_EXAMPLE, null, 2)], {type:'application/json'}), 'tutor-extension.json'); },
  pickFile(){
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json'; inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.onchange = () => {
      const f = inp.files[0]; inp.remove(); if(!f) return;
      const rd = new FileReader();
      rd.onload = () => { document.getElementById('ext-install-area').style.display = 'block'; document.getElementById('ext-code').value = rd.result; this.installFromText(); };
      rd.readAsText(f);
    };
    inp.click();
  },
  installFromText(){
    const box = document.getElementById('ext-code'), errBox = document.getElementById('ext-errors');
    let m;
    try { m = JSON.parse(box.value); } catch(e){ errBox.textContent = 'JSON inválido: ' + e.message; return; }
    const errs = Extensions.install(m);
    if(errs.length){ errBox.innerHTML = errs.map(e => '• ' + escapeHtml(e)).join('<br>'); return; }
    toast('Extensão instalada'); Views.extensions();
  }
};

// os painéis de exportação ganham a barra de predefinições das extensões
(function(){
  const baseHtml = ExportUI.html.bind(ExportUI);
  ExportUI.html = function(){ return Extensions.presetBarHTML() + baseHtml(); };
  const baseMount = ExportUI.mount.bind(ExportUI);
  ExportUI.mount = function(host, onChange){
    if(!host) return;
    baseMount(host, onChange);
    host.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', () => {
      Extensions.applyPreset(b.dataset.preset);
      ExportUI.mount(host, onChange);
      onChange && onChange();
      toast('Predefinição aplicada');
    }));
  };
})();

/* ===========================================================
   GRAVADOR GENÉRICO
   =========================================================== */
const Rec = {
  mime(kind){
    const list = kind === 'audio'
      ? ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']
      : ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    return (window.MediaRecorder && list.find(m => MediaRecorder.isTypeSupported(m))) || '';
  },
  start(stream, kind, bps){
    const mime = this.mime(kind);
    const opts = {}; if(mime) opts.mimeType = mime; if(bps) opts.videoBitsPerSecond = bps;
    const mr = new MediaRecorder(stream, opts);
    const chunks = [];
    mr.ondataavailable = e => { if(e.data && e.data.size) chunks.push(e.data); };
    const t0 = Date.now();
    const stopped = new Promise(res => { mr.onstop = () => res(new Blob(chunks, { type: mime || (kind === 'audio' ? 'audio/webm' : 'video/webm') })); });
    mr.start(500);
    return { mr, mime, t0, stop(){ if(mr.state !== 'inactive') mr.stop(); return stopped; } };
  }
};

/* Lista de gravações (usada em Captura, Webcam, Áudio e Editor de vídeo) */
const MediaList = {
  async render(hostId, kinds, opts){
    opts = opts || {};
    const host = document.getElementById(hostId); if(!host) return;
    const items = (await MediaStore.all()).filter(r => kinds.includes(r.kind));
    if(!items.length){ host.innerHTML = `<div class="v4-empty">${opts.empty || 'Nada gravado ainda.'}</div>`; return; }
    host.innerHTML = `<div class="rec-list">${items.map(r => `
      <div class="rec-item">
        ${r.kind === 'audio' ? `<div class="rec-thumb" style="display:flex;align-items:center;justify-content:center;background:var(--accent-soft);color:var(--accent);">${ico('<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/>')}</div>`
          : (r.thumb ? `<img class="rec-thumb" src="${r.thumb}">` : '<div class="rec-thumb"></div>')}
        <div class="rec-meta">
          <div class="rec-name" title="${escapeHtml(r.name)}">${escapeHtml(r.name)}</div>
          <div class="rec-info">${fmtClock(r.duration)} · ${fmtBytes(r.size)} · ${fmtDate(r.createdAt)}</div>
          ${r.kind === 'audio' ? `<audio controls preload="none" data-mid="${r.id}" style="height:30px;margin-top:6px;width:100%;max-width:340px;"></audio>` : ''}
        </div>
        <div class="v4-row" style="gap:6px;flex-shrink:0;">
          ${opts.edit && r.kind !== 'audio' ? `<button class="btn btn-primary btn-sm btn-pill" onclick="VE.openMedia('${r.id}')">Editar</button>` : ''}
          <button class="btn btn-secondary btn-sm btn-pill" title="Renomear" onclick="MediaList.rename('${r.id}')">${ICON.edit}</button>
          <button class="btn btn-secondary btn-sm btn-pill" title="Baixar" onclick="MediaList.download('${r.id}')">${ICON.dl}</button>
          <button class="btn btn-secondary btn-sm btn-pill btn-danger-ghost" title="Excluir" onclick="MediaList.remove('${r.id}','${hostId}')">${ICON.trash}</button>
        </div>
      </div>`).join('')}</div>`;
    // áudio: liga a fonte só ao renderizar (evita guardar URLs soltas)
    for(const a of host.querySelectorAll('audio[data-mid]')){
      const rec = items.find(x => x.id === a.dataset.mid);
      if(rec) a.src = URL.createObjectURL(rec.blob);
    }
    host._kinds = kinds; host._opts = opts;
  },
  async download(id){
    const r = await MediaStore.get(id); if(!r) return;
    const ext = r.mime && r.mime.includes('ogg') ? 'ogg' : 'webm';
    downloadBlob(r.blob, r.name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') + '.' + ext);
  },
  async rename(id){
    const r = await MediaStore.get(id); if(!r) return;
    const n = prompt('Novo nome:', r.name);
    if(n && n.trim()){ await MediaStore.rename(id, n.trim().slice(0, 80)); Views[State.view] && Views[State.view](); }
  },
  async remove(id, hostId){
    if(!confirm('Excluir esta gravação?')) return;
    await MediaStore.del(id);
    if(VE.media && VE.media.id === id) VE.unload();
    const host = document.getElementById(hostId);
    if(host) this.render(hostId, host._kinds || ['screen','webcam','edited'], host._opts);
  }
};

async function saveRecording(kind, name, blob, durationSec, mime){
  let thumb = '';
  if(kind !== 'audio') thumb = await Studio.thumbFromVideoBlob(blob);
  const rec = { id: uid() + uid(), kind, name, blob, mime: mime || blob.type, size: blob.size, duration: durationSec, thumb, createdAt: now() };
  await MediaStore.put(rec);
  return rec;
}
function defaultName(prefix){
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${prefix} ${p(d.getDate())}-${p(d.getMonth()+1)} ${p(d.getHours())}.${p(d.getMinutes())}`;
}

/* ===========================================================
   CAPTURA DE TELA
   =========================================================== */
const Capture = {
  state: 'idle', stream: null, cam: null, mic: null, rec: null, stopTick: null,
  used: new Set(), shot: null, previewStream: null,
  isUsing(s){ return this.used.has(s); },
  cfg(){ return StudioCfg.data.capture; },

  async countdown(n){
    if(!n) return;
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;inset:0;z-index:500;background:rgba(6,6,9,.55);display:flex;align-items:center;justify-content:center;color:#fff;font-size:120px;font-weight:700;backdrop-filter:blur(4px);';
    document.body.appendChild(el);
    for(let i = n; i > 0; i--){ el.textContent = i; await sleep(1000); }
    el.remove();
  },

  async start(){
    const err = Studio.secure(); if(err){ toast(err); return; }
    if(this.state !== 'idle') return;
    const cfg = this.cfg();
    let display;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: cfg.fps, cursor: 'always' }, audio: !!cfg.sysAudio });
    } catch(e){ toast('Captura cancelada ou bloqueada pelo navegador'); return; }
    this.used.add(display); this.stream = display;
    try {
      if(cfg.mic){
        try { this.mic = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: StudioCfg.data.mic.deviceId ? { exact: StudioCfg.data.mic.deviceId } : undefined, echoCancellation: true, noiseSuppression: true } }); this.used.add(this.mic); }
        catch(e){ toast('Microfone indisponível — gravando sem ele'); }
      }
      if(cfg.useCam){
        try { this.cam = await navigator.mediaDevices.getUserMedia({ video: { deviceId: StudioCfg.data.webcam.deviceId ? { exact: StudioCfg.data.webcam.deviceId } : undefined, width: { ideal: 640 } } }); this.used.add(this.cam); }
        catch(e){ toast('Webcam indisponível — gravando sem ela'); }
      }
      this.state = 'countdown'; Views.capture();
      await this.countdown(cfg.countdown);
      if(!display.active){ this.cleanup(); toast('O compartilhamento foi encerrado'); return; }
      await this.begin(display);
    } catch(e){ console.error(e); toast('Erro ao iniciar: ' + e.message); this.cleanup(); }
  },

  async begin(display){
    const cfg = this.cfg();
    const vTrack = display.getVideoTracks()[0];
    const needCompose = !!(cfg.compose || this.cam);
    let outStream;
    let composeCleanup = null;

    if(needCompose){
      const st = vTrack.getSettings();
      let W = st.width || 1280, H = st.height || 720;
      const k = Math.min(1, 1920/Math.max(W, H)); W = Math.round(W*k/2)*2; H = Math.round(H*k/2)*2;
      const sv = document.createElement('video'); sv.muted = true; sv.srcObject = new MediaStream([vTrack]); await sv.play().catch(()=>{});
      let cv = null;
      if(this.cam){ cv = document.createElement('video'); cv.muted = true; cv.srcObject = this.cam; await cv.play().catch(()=>{}); }
      const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');
      const wc = StudioCfg.data.webcam;
      const draw = () => {
        const vw = sv.videoWidth || W, vh = sv.videoHeight || H;
        paintFrameBackground(ctx, W, H);
        const g = frameGeometry(W, H, vw, vh);
        const rad = ExportOpts.frame === 'nenhum' ? 0 : (ExportOpts.radius || 0)*Math.max(W, H)/1280;
        if(ExportOpts.shadow && ExportOpts.frame !== 'nenhum' && ExportOpts.frame !== 'default'){
          ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.38)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 12; ctx.fillStyle = '#000';
          roundRectPath(ctx, g.imgX, g.imgY, g.imgW, g.imgH, rad); ctx.fill(); ctx.restore();
        }
        ctx.save(); roundRectPath(ctx, g.imgX, g.imgY, g.imgW, g.imgH, rad); ctx.clip();
        ctx.drawImage(sv, g.imgX, g.imgY, g.imgW, g.imgH); ctx.restore();
        if(cv && cv.videoWidth) Capture.drawBubble(ctx, cv, W, H, wc);
      };
      draw();
      composeCleanup = Ticker.start(draw, Math.round(1000/cfg.fps));
      outStream = canvas.captureStream(cfg.fps);
    } else {
      outStream = new MediaStream([vTrack]);
    }

    // áudio: mistura sistema + microfone quando há os dois
    const aTracks = [...display.getAudioTracks(), ...(this.mic ? this.mic.getAudioTracks() : [])];
    let audioCtx = null;
    if(aTracks.length === 1) outStream.addTrack(aTracks[0]);
    else if(aTracks.length > 1){
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const dest = audioCtx.createMediaStreamDestination();
      aTracks.forEach(t => audioCtx.createMediaStreamSource(new MediaStream([t])).connect(dest));
      dest.stream.getAudioTracks().forEach(t => outStream.addTrack(t));
    }

    this.rec = Rec.start(outStream, 'video', needCompose ? 6_000_000 : 5_000_000);
    this.stopTick = () => { if(composeCleanup) composeCleanup(); if(audioCtx) audioCtx.close().catch(()=>{}); };
    vTrack.onended = () => { if(this.state === 'recording') this.stop(); };
    this.state = 'recording';
    RecBar.show('Gravando a tela', () => this.stop());
    Views.capture();
  },

  drawBubble(ctx, cv, W, H, wc){
    const size = Math.round(W*(wc.size/100));
    const m = Math.round(W*0.03);
    const x = wc.corner.endsWith('l') ? m : W - size - m;
    const y = wc.corner.startsWith('t') ? m : H - size - m;
    const vw = cv.videoWidth, vh = cv.videoHeight, s = Math.min(vw, vh);
    ctx.save();
    const r = wc.shape === 'circle' ? size/2 : wc.shape === 'rounded' ? size*0.2 : 6;
    ctx.shadowColor = 'rgba(0,0,0,.4)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 6;
    roundRectPath(ctx, x, y, size, size, r); ctx.fillStyle = '#222'; ctx.fill();
    ctx.shadowColor = 'transparent';
    roundRectPath(ctx, x, y, size, size, r); ctx.clip();
    if(wc.mirror){ ctx.translate(x + size, y); ctx.scale(-1, 1); ctx.drawImage(cv, (vw - s)/2, (vh - s)/2, s, s, 0, 0, size, size); }
    else ctx.drawImage(cv, (vw - s)/2, (vh - s)/2, s, s, x, y, size, size);
    ctx.restore();
    ctx.save(); roundRectPath(ctx, x, y, size, size, r); ctx.lineWidth = Math.max(2, size*0.02); ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.restore();
  },

  async stop(){
    if(this.state !== 'recording' || !this.rec) return;
    const rec = this.rec; this.state = 'saving';
    RecBar.hide();
    const dur = (Date.now() - rec.t0)/1000;
    const blob = await rec.stop();
    this.cleanup();
    if(blob.size < 1000){ toast('A gravação ficou vazia'); Views[State.view] && State.view === 'capture' && Views.capture(); return; }
    const saved = await saveRecording('screen', defaultName('Tela'), blob, dur, rec.mime);
    toast('Gravação salva (' + fmtClock(dur) + ')');
    if(State.view === 'capture') Views.capture();
    return saved;
  },

  cleanup(){
    [this.stream, this.cam, this.mic].forEach(s => { Studio.stopStream(s); if(s) this.used.delete(s); });
    this.stream = this.cam = this.mic = null;
    if(this.stopTick){ this.stopTick(); this.stopTick = null; }
    this.rec = null; this.state = 'idle'; RecBar.hide();
  },

  async screenshot(){
    const err = Studio.secure(); if(err){ toast(err); return; }
    let display;
    try { display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }); }
    catch(e){ toast('Captura cancelada ou bloqueada pelo navegador'); return; }
    try {
      const v = document.createElement('video'); v.muted = true; v.srcObject = display;
      await v.play(); await sleep(250);
      const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
      c.getContext('2d').drawImage(v, 0, 0);
      this.shot = c;
      toast('Print capturado');
    } catch(e){ toast('Não foi possível capturar o quadro'); }
    Studio.stopStream(display);
    if(State.view === 'capture') Views.capture();
  },
  shotToTutorial(){ if(this.shot) Studio.sendToTutorial(this.shot, defaultName('Print')); },
  shotDownload(){ if(this.shot) this.shot.toBlob(b => downloadBlob(b, defaultName('print').replace(/\s+/g, '-') + '.png'), 'image/png'); },
  shotDiscard(){ this.shot = null; Views.capture(); },
  set(k, v){ this.cfg()[k] = v; StudioCfg.save(); }
};

Views.capture = function(){
  const root = document.getElementById('view-root');
  const c = Capture.cfg(), secureMsg = Studio.secure();
  const rec = Capture.state === 'recording', busy = Capture.state !== 'idle';
  root.innerHTML = Studio.header('capture') + `
    <div class="workspace-body" style="max-width:980px;">
      ${secureMsg ? `<div class="v4-card" style="border-color:#ff9500;"><h4>Atenção</h4><p style="margin:0;">${secureMsg}</p></div>` : ''}
      <div class="v4-grid" style="grid-template-columns:1.4fr 1fr;align-items:start;">
        <div>
          <div class="studio-stage" id="cap-stage">
            ${rec ? `<div class="studio-ph"><span class="rec-dot"></span>Gravando — <span class="rec-timer" id="cap-timer">00:00</span><br><span style="opacity:.7;">Volte para a janela ou aba que está compartilhando. O botão Parar fica no canto superior direito.</span></div>`
              : Capture.state === 'countdown' ? '<div class="studio-ph">Preparando a gravação…</div>'
              : Capture.shot ? '<canvas id="cap-shot"></canvas>'
              : '<div class="studio-ph">Clique em <b>Gravar tela</b> e escolha o que compartilhar<br>(tela inteira, uma janela ou uma aba).</div>'}
          </div>
          <div class="v4-row" style="margin-top:14px;">
            ${rec ? `<button class="btn btn-primary btn-pill" style="background:#ff3b30;" onclick="Capture.stop()">${ICON.stop} Parar gravação</button>`
              : `<button class="btn btn-primary btn-pill" ${busy ? 'disabled' : ''} onclick="Capture.start()">${ICON.rec} Gravar tela</button>
                 <button class="btn btn-secondary btn-pill" ${busy ? 'disabled' : ''} onclick="Capture.screenshot()">${ICON.cam} Tirar print</button>`}
          </div>
          ${Capture.shot && !busy ? `<div class="v4-row" style="margin-top:12px;">
            <button class="btn btn-primary btn-sm btn-pill" onclick="Capture.shotToTutorial()">${ICON.send} Adicionar a um tutorial</button>
            <button class="btn btn-secondary btn-sm btn-pill" onclick="Capture.shotDownload()">${ICON.dl} Baixar PNG</button>
            <button class="btn btn-secondary btn-sm btn-pill" onclick="Capture.shotDiscard()">Descartar</button></div>` : ''}
        </div>
        <div class="v4-card" style="margin:0;">
          <h4>Opções da gravação</h4>
          <div class="ext-settings" style="border:none;padding:0;margin-top:8px;">
            <div class="ext-set-row"><span>Contagem regressiva</span>
              <select class="v4-select" onchange="Capture.set('countdown',Number(this.value))">${[0,3,5].map(n => `<option value="${n}" ${c.countdown === n ? 'selected' : ''}>${n ? n + ' s' : 'Sem'}</option>`).join('')}</select></div>
            <div class="ext-set-row"><span>Qualidade (quadros/s)</span>
              <select class="v4-select" onchange="Capture.set('fps',Number(this.value))">${[15,24,30].map(n => `<option value="${n}" ${c.fps === n ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
            <div class="ext-set-row"><span>Áudio do sistema/aba</span><label class="v4-switch"><input type="checkbox" ${c.sysAudio ? 'checked' : ''} onchange="Capture.set('sysAudio',this.checked)"><span></span></label></div>
            <div class="ext-set-row"><span>Microfone (narração)</span><label class="v4-switch"><input type="checkbox" ${c.mic ? 'checked' : ''} onchange="Capture.set('mic',this.checked)"><span></span></label></div>
            <div class="ext-set-row"><span>Webcam no canto da tela</span><label class="v4-switch"><input type="checkbox" ${c.useCam ? 'checked' : ''} onchange="Capture.set('useCam',this.checked)"><span></span></label></div>
            <div class="ext-set-row"><span>Aplicar moldura da exportação</span><label class="v4-switch"><input type="checkbox" ${c.compose ? 'checked' : ''} onchange="Capture.set('compose',this.checked)"><span></span></label></div>
          </div>
          <p class="v4-help" style="margin-top:12px;">Webcam e moldura são combinadas durante a gravação, então esta aba precisa continuar aberta (pode ficar em segundo plano). Formato e posição da webcam: menu <b>Webcam</b>. Moldura: menu <b>Exportar</b>.</p>
        </div>
      </div>
      <div class="section-head" style="margin-top:26px;"><h3>Gravações de tela</h3><span class="section-sub">Salvas neste navegador — clique em Editar para cortar, dar zoom e exportar</span></div>
      <div id="cap-list"></div>
    </div>`;
  if(Capture.shot && !busy){
    const cv = document.getElementById('cap-shot');
    if(cv){ cv.width = Capture.shot.width; cv.height = Capture.shot.height; cv.getContext('2d').drawImage(Capture.shot, 0, 0); cv.style.maxWidth = '100%'; }
  }
  MediaList.render('cap-list', ['screen'], { edit: true, empty: 'Nenhuma gravação de tela ainda.' });
};

/* ===========================================================
   WEBCAM
   =========================================================== */
const WebcamView = {
  stream: null, rec: null, recStream: null,
  async devices(kind){
    try { const d = await navigator.mediaDevices.enumerateDevices(); return d.filter(x => x.kind === kind); } catch(e){ return []; }
  },
  async startPreview(){
    const err = Studio.secure(); if(err){ toast(err); return; }
    this.stopPreview(true);
    try {
      const wc = StudioCfg.data.webcam;
      this.stream = Studio.track(await navigator.mediaDevices.getUserMedia({ video: { deviceId: wc.deviceId ? { exact: wc.deviceId } : undefined, width: { ideal: 1280 } }, audio: false }));
    } catch(e){ toast('Não foi possível acessar a webcam: ' + (e.name === 'NotAllowedError' ? 'permissão negada' : e.message)); return; }
    Views.webcam();
  },
  stopPreview(silent){
    if(this.rec) return;
    Studio.stopStream(this.stream); this.stream = null;
    if(!silent && State.view === 'webcam') Views.webcam();
  },
  set(k, v){ StudioCfg.data.webcam[k] = v; StudioCfg.save(); if(k === 'deviceId' && this.stream) this.startPreview(); else this.applyStyle(); },
  applyStyle(){
    const b = document.getElementById('wc-bubble'); if(!b) return;
    const wc = StudioCfg.data.webcam;
    b.style.width = wc.size + '%';
    b.style.borderRadius = wc.shape === 'circle' ? '50%' : wc.shape === 'rounded' ? '20%' : '6px';
    b.style.left = wc.corner.endsWith('l') ? '3%' : 'auto'; b.style.right = wc.corner.endsWith('r') ? '3%' : 'auto';
    b.style.top = wc.corner.startsWith('t') ? '5%' : 'auto'; b.style.bottom = wc.corner.startsWith('b') ? '5%' : 'auto';
    const v = b.querySelector('video'); if(v) v.style.transform = wc.mirror ? 'scaleX(-1)' : 'none';
    document.querySelectorAll('[data-wc-seg]').forEach(el => {
      el.querySelectorAll('button').forEach(btn => btn.classList.toggle('on', btn.dataset.v === String(wc[el.dataset.wcSeg])));
    });
    const out = document.getElementById('wc-size-out'); if(out) out.textContent = wc.size + '%';
  },
  async record(){
    if(!this.stream){ await this.startPreview(); if(!this.stream) return; }
    let rs = new MediaStream(this.stream.getVideoTracks());
    const wantMic = document.getElementById('wc-mic') && document.getElementById('wc-mic').checked;
    if(wantMic){
      try { const m = Studio.track(await navigator.mediaDevices.getUserMedia({ audio: true })); m.getAudioTracks().forEach(t => rs.addTrack(t)); this._mic = m; } catch(e){ toast('Microfone indisponível'); }
    }
    this.recStream = rs;
    this.rec = Rec.start(rs, 'video', 3_000_000);
    RecBar.show('Gravando a webcam', () => this.stopRecord());
    Views.webcam();
  },
  async stopRecord(){
    if(!this.rec) return;
    const r = this.rec; this.rec = null; RecBar.hide();
    const dur = (Date.now() - r.t0)/1000;
    const blob = await r.stop();
    if(this._mic){ Studio.stopStream(this._mic); this._mic = null; }
    if(blob.size > 1000){ await saveRecording('webcam', defaultName('Webcam'), blob, dur, r.mime); toast('Gravação da webcam salva'); }
    if(State.view === 'webcam') Views.webcam();
  },
  photo(){
    const v = document.querySelector('#wc-bubble video'); if(!v || !v.videoWidth){ toast('Ligue a câmera primeiro'); return; }
    const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
    const x = c.getContext('2d');
    if(StudioCfg.data.webcam.mirror){ x.translate(c.width, 0); x.scale(-1, 1); }
    x.drawImage(v, 0, 0);
    c.toBlob(b => downloadBlob(b, defaultName('foto').replace(/\s+/g, '-') + '.png'), 'image/png');
  }
};

Views.webcam = async function(){
  const root = document.getElementById('view-root');
  const wc = StudioCfg.data.webcam, on = !!WebcamView.stream, recording = !!WebcamView.rec;
  const seg = (key, items) => `<div class="seg" data-wc-seg="${key}">${items.map(([v, l]) => `<button data-v="${v}" class="${String(wc[key]) === String(v) ? 'on' : ''}" onclick="WebcamView.set('${key}',${typeof v === 'number' ? v : `'${v}'`})">${l}</button>`).join('')}</div>`;
  const cams = on ? await WebcamView.devices('videoinput') : [];
  if(State.view !== 'webcam') return;
  root.innerHTML = Studio.header('webcam') + `
    <div class="workspace-body" style="max-width:980px;">
      <div class="v4-grid" style="grid-template-columns:1.4fr 1fr;align-items:start;">
        <div>
          <div class="studio-stage" style="background:linear-gradient(135deg,#1d2b64,#3a6073);">
            <div class="studio-ph" style="color:rgba(255,255,255,.55);">Prévia: assim a webcam aparece sobre a gravação de tela</div>
            <div class="webcam-bubble-preview" id="wc-bubble">${on ? '<video autoplay muted playsinline></video>' : ''}</div>
          </div>
          <div class="v4-row" style="margin-top:14px;">
            ${on ? `<button class="btn btn-secondary btn-pill" onclick="WebcamView.stopPreview()">Desligar câmera</button>`
                 : `<button class="btn btn-primary btn-pill" onclick="WebcamView.startPreview()">${ICON.cam} Ligar câmera</button>`}
            ${on && !recording ? `<button class="btn btn-secondary btn-pill" onclick="WebcamView.photo()">Tirar foto</button>
              <button class="btn btn-primary btn-pill" style="background:#ff3b30;" onclick="WebcamView.record()">${ICON.rec} Gravar webcam</button>
              <label class="v4-help" style="display:flex;gap:6px;align-items:center;"><input type="checkbox" id="wc-mic"> com microfone</label>` : ''}
            ${recording ? `<button class="btn btn-primary btn-pill" style="background:#ff3b30;" onclick="WebcamView.stopRecord()">${ICON.stop} Parar gravação</button>` : ''}
          </div>
        </div>
        <div class="v4-card" style="margin:0;">
          <h4>Aparência na gravação de tela</h4>
          <div class="ext-settings" style="border:none;padding:0;margin-top:8px;">
            <div class="ext-set-row"><span>Formato</span>${seg('shape', [['circle','Círculo'],['rounded','Arredondado'],['square','Quadrado']])}</div>
            <div class="ext-set-row"><span>Canto</span>${seg('corner', [['tl','↖'],['tr','↗'],['bl','↙'],['br','↘']])}</div>
            <div class="ext-set-row"><span>Tamanho</span><div class="v4-range" style="width:170px;"><input type="range" min="12" max="40" step="1" value="${wc.size}" oninput="WebcamView.set('size',Number(this.value))"><output id="wc-size-out">${wc.size}%</output></div></div>
            <div class="ext-set-row"><span>Espelhar imagem</span><label class="v4-switch"><input type="checkbox" ${wc.mirror ? 'checked' : ''} onchange="WebcamView.set('mirror',this.checked)"><span></span></label></div>
            ${cams.length > 1 ? `<div class="ext-set-row"><span>Câmera</span><select class="v4-select" onchange="WebcamView.set('deviceId',this.value)">${cams.map((c, i) => `<option value="${c.deviceId}" ${wc.deviceId === c.deviceId ? 'selected' : ''}>${escapeHtml(c.label || 'Câmera ' + (i + 1))}</option>`).join('')}</select></div>` : ''}
          </div>
          <p class="v4-help" style="margin-top:12px;">Para gravar a tela com a webcam, ative <b>Webcam no canto da tela</b> em <b>Captura de tela</b>.</p>
        </div>
      </div>
      <div class="section-head" style="margin-top:26px;"><h3>Gravações da webcam</h3></div>
      <div id="wc-list"></div>
    </div>`;
  if(on){
    const v = root.querySelector('#wc-bubble video');
    v.srcObject = WebcamView.stream; v.play().catch(()=>{});
  }
  WebcamView.applyStyle();
  MediaList.render('wc-list', ['webcam'], { edit: true, empty: 'Nenhuma gravação da webcam ainda.' });
};

/* ===========================================================
   ÁUDIO (narração)
   =========================================================== */
const AudioView = {
  stream: null, rec: null, ac: null, raf: null,
  async startMeter(stream){
    this.stopMeter();
    try {
      this.ac = new (window.AudioContext || window.webkitAudioContext)();
      const src = this.ac.createMediaStreamSource(stream);
      const an = this.ac.createAnalyser(); an.fftSize = 512; src.connect(an);
      const buf = new Uint8Array(an.fftSize);
      const loop = () => {
        an.getByteTimeDomainData(buf);
        let peak = 0; for(let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128));
        const el = document.querySelector('#au-meter > div'); if(el) el.style.width = Math.min(100, peak/128*140) + '%';
        this.raf = requestAnimationFrame(loop);
      };
      loop();
    } catch(e){}
  },
  stopMeter(){ cancelAnimationFrame(this.raf); if(this.ac){ this.ac.close().catch(()=>{}); this.ac = null; } },
  async test(){
    const err = Studio.secure(); if(err){ toast(err); return; }
    this.stopTest(true);
    try {
      const id = StudioCfg.data.mic.deviceId;
      this.stream = Studio.track(await navigator.mediaDevices.getUserMedia({ audio: { deviceId: id ? { exact: id } : undefined, echoCancellation: true, noiseSuppression: true } }));
    } catch(e){ toast('Não foi possível acessar o microfone: ' + (e.name === 'NotAllowedError' ? 'permissão negada' : e.message)); return; }
    this.startMeter(this.stream);
    Views.audio();
  },
  stopTest(silent){
    if(this.rec) return;
    this.stopMeter(); Studio.stopStream(this.stream); this.stream = null;
    if(!silent && State.view === 'audio') Views.audio();
  },
  async record(){
    if(!this.stream){ await this.test(); if(!this.stream) return; }
    this.rec = Rec.start(this.stream, 'audio');
    RecBar.show('Gravando áudio', () => this.stop());
    Views.audio();
  },
  async stop(){
    if(!this.rec) return;
    const r = this.rec; this.rec = null; RecBar.hide();
    const dur = (Date.now() - r.t0)/1000;
    const blob = await r.stop();
    this.stopMeter(); Studio.stopStream(this.stream); this.stream = null;
    if(blob.size > 500){ await saveRecording('audio', defaultName('Narração'), blob, dur, r.mime); toast('Áudio salvo'); }
    if(State.view === 'audio') Views.audio();
  },
  setMic(id){ StudioCfg.data.mic.deviceId = id; StudioCfg.save(); if(this.stream) this.test(); }
};

Views.audio = async function(){
  const root = document.getElementById('view-root');
  const on = !!AudioView.stream, recording = !!AudioView.rec;
  const mics = on ? await WebcamView.devices('audioinput') : [];
  if(State.view !== 'audio') return;
  root.innerHTML = Studio.header('audio') + `
    <div class="workspace-body" style="max-width:820px;">
      <div class="v4-card">
        <h4>Gravar narração</h4>
        <p>Fale explicando o passo a passo. As gravações ficam na lista abaixo e podem ser usadas como <b>faixa extra</b> no Editor de vídeo.</p>
        <div class="meter" id="au-meter" style="margin-bottom:14px;"><div></div></div>
        <div class="v4-row">
          ${recording ? `<button class="btn btn-primary btn-pill" style="background:#ff3b30;" onclick="AudioView.stop()">${ICON.stop} Parar gravação</button>`
            : on ? `<button class="btn btn-primary btn-pill" style="background:#ff3b30;" onclick="AudioView.record()">${ICON.rec} Gravar</button>
                    <button class="btn btn-secondary btn-pill" onclick="AudioView.stopTest()">Desligar microfone</button>`
            : `<button class="btn btn-primary btn-pill" onclick="AudioView.test()">Ligar microfone e testar nível</button>`}
          ${mics.length > 1 ? `<select class="v4-select" onchange="AudioView.setMic(this.value)">${mics.map((m, i) => `<option value="${m.deviceId}" ${StudioCfg.data.mic.deviceId === m.deviceId ? 'selected' : ''}>${escapeHtml(m.label || 'Microfone ' + (i + 1))}</option>`).join('')}</select>` : ''}
          ${recording ? '<span class="rec-timer"><span class="rec-dot"></span><span id="cap-timer">00:00</span></span>' : ''}
        </div>
      </div>
      <div class="section-head"><h3>Gravações de áudio</h3></div>
      <div id="au-list"></div>
    </div>`;
  if(on) AudioView.startMeter(AudioView.stream);
  MediaList.render('au-list', ['audio'], { empty: 'Nenhum áudio gravado ainda.' });
};

/* ===========================================================
   EDITOR DE VÍDEO — corte, velocidade, zoom, texto, áudio extra, moldura
   Exporta em WebM regravando o resultado no navegador (tempo real).
   =========================================================== */
async function ensureDuration(v, fallback){
  if(Number.isFinite(v.duration) && v.duration > 0) return v.duration;
  // WebM gravado pelo navegador vem sem duração: força o cálculo
  await new Promise(res => {
    const on = () => { v.removeEventListener('timeupdate', on); res(); };
    v.addEventListener('timeupdate', on);
    try { v.currentTime = 1e101; } catch(e){}
    setTimeout(res, 2500);
  });
  const d = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : (fallback || 0);
  await new Promise(res => { v.addEventListener('seeked', res, { once: true }); v.currentTime = 0; setTimeout(res, 1500); });
  return d;
}

const VE = {
  media: null, video: null, url: null, duration: 0,
  trimIn: 0, trimOut: 0, speed: 1, origVol: 1, extraId: null, extraVol: 0.8,
  zooms: [], texts: [], focus: { x: 50, y: 50 }, pickFocus: false, playing: false, raf: null,
  ac: null, srcNode: null, gOrig: null, outPreview: null, canvas: null, ctx: null, exporting: false, cancel: false,

  unload(){
    this.pause();
    if(this.url) URL.revokeObjectURL(this.url);
    if(this.ac){ this.ac.close().catch(()=>{}); }
    Object.assign(this, { media: null, video: null, url: null, duration: 0, trimIn: 0, trimOut: 0, speed: 1, zooms: [], texts: [], ac: null, srcNode: null, gOrig: null, outPreview: null });
    if(State.view === 'video') Views.video();
  },

  async openMedia(id){
    App.switchView('video');
    await this.load(id);
  },

  async load(id){
    const rec = await MediaStore.get(id); if(!rec){ toast('Gravação não encontrada'); return; }
    this.pause();
    if(this.url) URL.revokeObjectURL(this.url);
    if(this.ac){ try { await this.ac.close(); } catch(e){} this.ac = null; }
    this.media = rec; this.url = URL.createObjectURL(rec.blob);
    const v = document.createElement('video');
    v.preload = 'auto'; v.playsInline = true; v.src = this.url; v.crossOrigin = 'anonymous';
    this.video = v;
    toast('Carregando vídeo…');
    await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('formato não suportado')); }).catch(e => { toast('Não foi possível abrir: ' + e.message); this.media = null; this.video = null; });
    if(!this.video) { if(State.view === 'video') Views.video(); return; }
    this.duration = await ensureDuration(v, rec.duration);
    this.trimIn = 0; this.trimOut = this.duration; this.speed = 1; this.zooms = []; this.texts = [];
    this.focus = { x: 50, y: 50 }; this.pickFocus = false;
    // áudio: encaminha a mídia por um grafo (permite exportar com áudio e mixar faixa extra)
    try {
      this.ac = new (window.AudioContext || window.webkitAudioContext)();
      this.srcNode = this.ac.createMediaElementSource(v);
      this.gOrig = this.ac.createGain(); this.gOrig.gain.value = this.origVol;
      this.outPreview = this.ac.createGain(); this.outPreview.gain.value = 1;
      this.srcNode.connect(this.gOrig); this.gOrig.connect(this.outPreview); this.outPreview.connect(this.ac.destination);
    } catch(e){ console.warn('audio graph', e); }
    if(State.view !== 'video') App.switchView('video'); else Views.video();
  },

  async importFile(file){
    if(!file || !file.type.startsWith('video/')){ toast('Escolha um arquivo de vídeo'); return; }
    let dur = 0;
    const tmp = document.createElement('video'); tmp.preload = 'metadata'; tmp.src = URL.createObjectURL(file);
    await new Promise(r => { tmp.onloadedmetadata = r; tmp.onerror = r; setTimeout(r, 4000); });
    dur = Number.isFinite(tmp.duration) ? tmp.duration : 0; URL.revokeObjectURL(tmp.src);
    const rec = await saveRecording('screen', file.name.replace(/\.[^.]+$/, '').slice(0, 60) || defaultName('Vídeo'), file, dur, file.type);
    toast('Vídeo importado');
    await this.load(rec.id);
  },
  pickVideo(){
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'video/*'; inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.onchange = () => { const f = inp.files[0]; inp.remove(); if(f) this.importFile(f); };
    inp.click();
  },

  /* ---------- tempo & reprodução ---------- */
  outDuration(){ return Math.max(0, (this.trimOut - this.trimIn)/this.speed); },
  async play(){
    const v = this.video; if(!v || this.exporting) return;
    if(this.ac && this.ac.state === 'suspended') await this.ac.resume().catch(()=>{});
    if(v.currentTime < this.trimIn || v.currentTime >= this.trimOut - 0.05) v.currentTime = this.trimIn;
    v.playbackRate = this.speed;
    try { await v.play(); } catch(e){ toast('Não foi possível reproduzir'); return; }
    this.playing = true; this.updatePlayBtn();
    cancelAnimationFrame(this.raf);
    const loop = () => {
      if(!this.playing) return;
      if(v.currentTime >= this.trimOut || v.ended){ this.pause(); v.currentTime = this.trimOut; this.redraw(); return; }
      this.redraw();
      this.raf = requestAnimationFrame(loop);
    };
    loop();
  },
  pause(){
    this.playing = false; cancelAnimationFrame(this.raf);
    if(this.video && !this.exporting) this.video.pause();
    this.updatePlayBtn();
  },
  toggle(){ this.playing ? this.pause() : this.play(); },
  seek(t){
    const v = this.video; if(!v) return;
    v.currentTime = Math.max(0, Math.min(this.duration, Number(t)));
    if(!this.playing) v.addEventListener('seeked', () => this.redraw(), { once: true });
  },
  updatePlayBtn(){
    const b = document.getElementById('ve-play'); if(b) b.innerHTML = this.playing ? ICON.pause + ' Pausar' : ICON.play + ' Reproduzir';
  },

  /* ---------- desenho do quadro (preview e exportação) ---------- */
  zoomAt(t){
    let z = 1, fx = 0.5, fy = 0.5;
    this.zooms.forEach(r => {
      if(t >= r.start && t <= r.end){
        const k = Math.min(easeInOut((t - r.start)/0.5), easeInOut((r.end - t)/0.5));
        const zz = 1 + (r.scale - 1)*k;
        if(zz >= z){ z = zz; fx = r.fx/100; fy = r.fy/100; }
      }
    });
    return { z, fx, fy };
  },
  drawFrame(ctx, W, H, t, overlay){
    const v = this.video; if(!v || !v.videoWidth) return;
    paintFrameBackground(ctx, W, H);
    const g = frameGeometry(W, H, v.videoWidth, v.videoHeight);
    const frameless = ExportOpts.frame === 'nenhum';
    const rad = frameless ? 0 : (ExportOpts.radius || 0)*Math.max(W, H)/1280;
    const zs = this.zoomAt(t);
    let tx = g.imgW/2 - zs.fx*g.imgW*zs.z, ty = g.imgH/2 - zs.fy*g.imgH*zs.z;
    if(zs.z === 1){ tx = 0; ty = 0; }
    tx = Math.max(g.imgW*(1 - zs.z), Math.min(0, tx)); ty = Math.max(g.imgH*(1 - zs.z), Math.min(0, ty));
    if(!frameless && ExportOpts.shadow && ExportOpts.frame !== 'default'){
      ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.38)'; ctx.shadowBlur = 40*Math.max(W, H)/1280; ctx.shadowOffsetY = 12; ctx.fillStyle = '#000';
      roundRectPath(ctx, g.imgX, g.imgY, g.imgW, g.imgH, rad); ctx.fill(); ctx.restore();
    }
    ctx.save(); roundRectPath(ctx, g.imgX, g.imgY, g.imgW, g.imgH, rad); ctx.clip();
    ctx.drawImage(v, g.imgX + tx, g.imgY + ty, g.imgW*zs.z, g.imgH*zs.z);
    if(overlay && this.pickFocus){
      const fx = g.imgX + tx + this.focus.x/100*g.imgW*zs.z, fy = g.imgY + ty + this.focus.y/100*g.imgH*zs.z;
      ctx.beginPath(); ctx.arc(fx, fy, 14, 0, Math.PI*2); ctx.strokeStyle = '#ff9500'; ctx.lineWidth = 3; ctx.stroke();
      ctx.beginPath(); ctx.arc(fx, fy, 3, 0, Math.PI*2); ctx.fillStyle = '#ff9500'; ctx.fill();
    }
    ctx.restore();
    // textos
    const k = Math.max(W, H)/1280;
    this.texts.forEach(tx2 => {
      if(t < tx2.start || t > tx2.end) return;
      const a = Math.min(1, (t - tx2.start)/0.25, (tx2.end - t)/0.25);
      ctx.save(); ctx.globalAlpha = Math.max(0, a);
      ctx.font = `600 ${30*k}px Inter, sans-serif`;
      const tw = ctx.measureText(tx2.text).width, padX = 22*k, h = 52*k;
      const cx = W/2, cy = tx2.pos === 'top' ? H*0.12 : tx2.pos === 'center' ? H*0.5 : H*0.88;
      roundRectPath(ctx, cx - tw/2 - padX, cy - h/2, tw + padX*2, h, h/2);
      ctx.fillStyle = 'rgba(20,20,22,.82)'; ctx.fill();
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(tx2.text, cx, cy + 1*k);
      ctx.restore();
    });
    Extensions.postRender(ctx, W, H, k);
  },
  previewSize(){
    const { W, H } = exportDims('video');
    const w = 960; return { W: w, H: Math.round(w*H/W) };
  },
  redraw(){
    if(!this.canvas || !this.video) return;
    this.drawFrame(this.ctx, this.canvas.width, this.canvas.height, this.video.currentTime, true);
    const t = this.video.currentTime;
    const seek = document.getElementById('ve-seek'); if(seek && document.activeElement !== seek) seek.value = t;
    const cur = document.getElementById('ve-cur'); if(cur) cur.textContent = fmtClock(t) + ' / ' + fmtClock(this.duration);
    const ph = document.getElementById('ve-playhead'); if(ph && this.duration) ph.style.left = (t/this.duration*100) + '%';
  },

  /* ---------- edição ---------- */
  setIn(v){ this.trimIn = Math.min(Number(v), this.trimOut - 0.2); this.afterEdit(); },
  setOut(v){ this.trimOut = Math.max(Number(v), this.trimIn + 0.2); this.afterEdit(); },
  markIn(){ this.trimIn = Math.min(this.video.currentTime, this.trimOut - 0.2); this.afterEdit(true); },
  markOut(){ this.trimOut = Math.max(this.video.currentTime, this.trimIn + 0.2); this.afterEdit(true); },
  setSpeed(s){ this.speed = s; if(this.video) this.video.playbackRate = s; this.afterEdit(true); },
  setOrigVol(v){ this.origVol = Number(v); if(this.gOrig) this.gOrig.gain.value = this.origVol; },
  setExtra(id){ this.extraId = id || null; },
  setExtraVol(v){ this.extraVol = Number(v); },
  afterEdit(rerender){ if(rerender) Views.video(); else { this.drawTrack(); this.updateInfo(); } },
  updateInfo(){
    const el = document.getElementById('ve-info');
    if(el) el.textContent = `Saída: ${fmtClock(this.outDuration())} (corte ${fmtClock(this.trimIn)} → ${fmtClock(this.trimOut)} a ${this.speed}×)`;
  },
  addZoom(){
    const dur = Number(document.getElementById('ve-z-dur').value) || 3, scale = Number(document.getElementById('ve-z-scale').value) || 2;
    const start = Math.max(this.trimIn, Math.min(this.video.currentTime, this.trimOut - 0.5));
    this.zooms.push({ id: uid(), start, end: Math.min(this.trimOut, start + dur), scale, fx: this.focus.x, fy: this.focus.y });
    this.pickFocus = false; this.afterEdit(true);
  },
  addText(){
    const text = document.getElementById('ve-t-text').value.trim(); if(!text){ toast('Digite o texto'); return; }
    const dur = Number(document.getElementById('ve-t-dur').value) || 3, pos = document.getElementById('ve-t-pos').value;
    const start = Math.max(this.trimIn, Math.min(this.video.currentTime, this.trimOut - 0.5));
    this.texts.push({ id: uid(), start, end: Math.min(this.trimOut, start + dur), text: text.slice(0, 120), pos });
    this.afterEdit(true);
  },
  removeItem(kind, id){ this[kind] = this[kind].filter(x => x.id !== id); this.afterEdit(true); },
  togglePick(){ this.pickFocus = !this.pickFocus; this.redraw(); const b = document.getElementById('ve-pick'); if(b) b.classList.toggle('btn-primary', this.pickFocus); if(this.pickFocus) toast('Clique no vídeo para escolher o ponto do zoom'); },
  canvasClick(e){
    if(!this.pickFocus || !this.video) return;
    const r = this.canvas.getBoundingClientRect();
    const W = this.canvas.width, H = this.canvas.height;
    const px = (e.clientX - r.left)/r.width*W, py = (e.clientY - r.top)/r.height*H;
    const g = frameGeometry(W, H, this.video.videoWidth, this.video.videoHeight);
    const zs = this.zoomAt(this.video.currentTime);
    let tx = g.imgW/2 - zs.fx*g.imgW*zs.z, ty = g.imgH/2 - zs.fy*g.imgH*zs.z;
    if(zs.z === 1){ tx = 0; ty = 0; }
    tx = Math.max(g.imgW*(1 - zs.z), Math.min(0, tx)); ty = Math.max(g.imgH*(1 - zs.z), Math.min(0, ty));
    const x = (px - g.imgX - tx)/(g.imgW*zs.z)*100, y = (py - g.imgY - ty)/(g.imgH*zs.z)*100;
    this.focus = { x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) };
    this.redraw();
  },
  grabFrame(){
    const v = this.video; if(!v || !v.videoWidth) return null;
    const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0); return c;
  },
  frameToTutorial(){ const c = this.grabFrame(); if(c) Studio.sendToTutorial(c, 'Quadro ' + fmtClock(this.video.currentTime)); },
  frameDownload(){ const c = this.grabFrame(); if(c) c.toBlob(b => downloadBlob(b, 'quadro-' + fmtClock(this.video.currentTime).replace(':', '-') + '.png'), 'image/png'); },
  setFrameOpt(k, v){
    ExportOpts[k] = (k === 'pad') ? Number(v) : v; Persist.saveSettings();
    if(k === 'aspect') this.resizeCanvas();
    this.redraw();
  },
  resizeCanvas(){
    if(!this.canvas) return;
    const s = this.previewSize(); this.canvas.width = s.W; this.canvas.height = s.H;
  },

  /* ---------- timeline ---------- */
  drawTrack(){
    const tr_ = document.getElementById('ve-track'); if(!tr_ || !this.duration) return;
    const d = this.duration, pct = x => (x/d*100) + '%';
    tr_.innerHTML = `<div class="ve-range" style="left:${pct(this.trimIn)};width:${(this.trimOut - this.trimIn)/d*100}%;"></div>` +
      this.zooms.map(z => `<div class="ve-chip zoom" style="left:${pct(z.start)};width:${(z.end - z.start)/d*100}%;">zoom ${z.scale}×</div>`).join('') +
      this.texts.map(x => `<div class="ve-chip text" style="left:${pct(x.start)};width:${(x.end - x.start)/d*100}%;top:auto;height:12px;bottom:2px;">${escapeHtml(x.text)}</div>`).join('') +
      `<div class="ve-playhead" id="ve-playhead" style="left:${pct(this.video ? this.video.currentTime : 0)};"></div>`;
  },

  /* ---------- exportação ---------- */
  async export(){
    if(!this.video || this.exporting) return;
    if(!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream){ toast('Seu navegador não suporta gravação de vídeo. Use Chrome, Edge ou Firefox.'); return; }
    this.pause(); this.exporting = true; this.cancel = false;
    const v = this.video;
    const back = document.createElement('div'); back.className = 'modal-backdrop on';
    back.innerHTML = `<div class="modal"><div class="progress-panel"><div class="spinner"></div>
      <h3>Exportando vídeo</h3><p>Gravando o resultado em tempo real (~${fmtClock(this.outDuration())}). Não feche esta aba.</p>
      <div class="progress-bar"><div class="progress-bar-fill" id="vex-fill"></div></div>
      <div class="progress-status" id="vex-status">Preparando…</div></div>
      <div class="modal-actions"><button class="btn btn-secondary" id="vex-cancel">Cancelar</button></div></div>`;
    document.body.appendChild(back);
    back.querySelector('#vex-cancel').onclick = () => { this.cancel = true; };

    let mediaDest = null, extraEl = null, extraSrc = null, gExtra = null, stopTick = null, rec = null;
    try {
      const { W, H } = exportDims('video');
      const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');
      const stream = canvas.captureStream(30);

      // áudio da gravação + faixa extra de narração
      if(this.ac){
        if(this.ac.state === 'suspended') await this.ac.resume().catch(()=>{});
        mediaDest = this.ac.createMediaStreamDestination();
        this.gOrig.connect(mediaDest); this.outPreview.gain.value = 0;
        if(this.extraId){
          const ar = await MediaStore.get(this.extraId);
          if(ar){
            extraEl = new Audio(URL.createObjectURL(ar.blob));
            extraSrc = this.ac.createMediaElementSource(extraEl);
            gExtra = this.ac.createGain(); gExtra.gain.value = this.extraVol;
            extraSrc.connect(gExtra); gExtra.connect(mediaDest);
          }
        }
        mediaDest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
      }

      v.currentTime = this.trimIn;
      await new Promise(r => { v.addEventListener('seeked', r, { once: true }); setTimeout(r, 1500); });
      v.playbackRate = this.speed;
      this.drawFrame(ctx, W, H, v.currentTime);
      rec = Rec.start(stream, 'video', {low: 2_000_000, med: 3_500_000, high: 6_000_000}[ExportOpts.quality] || 3_500_000);
      await v.play();
      if(extraEl) extraEl.play().catch(()=>{});
      const t0 = performance.now();
      await new Promise(resolve => {
        stopTick = Ticker.start(() => {
          const t = v.currentTime;
          this.drawFrame(ctx, W, H, t);
          const p = Math.min(1, (t - this.trimIn)/Math.max(0.1, this.trimOut - this.trimIn));
          const f = document.getElementById('vex-fill'); if(f) f.style.width = Math.round(p*100) + '%';
          const s = document.getElementById('vex-status'); if(s) s.textContent = `${fmtClock((performance.now() - t0)/1000)} gravados`;
          if(this.cancel || t >= this.trimOut || v.ended) resolve();
        }, 33);
      });
      v.pause(); if(extraEl) extraEl.pause();
      if(stopTick) stopTick();
      const blob = await rec.stop();
      if(this.cancel){ toast('Exportação cancelada'); }
      else {
        const dur = (performance.now() - t0)/1000;
        const base = (this.media.name || 'video').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-');
        downloadBlob(blob, base + '-editado.webm');
        await saveRecording('edited', this.media.name + ' (editado)', blob, dur, rec.mime);
        toast('Vídeo exportado e salvo na biblioteca');
      }
    } catch(e){
      console.error(e); toast('Erro ao exportar: ' + e.message);
      try { if(stopTick) stopTick(); if(rec) rec.stop(); } catch(_){}
    } finally {
      try { if(mediaDest) this.gOrig.disconnect(mediaDest); } catch(e){}
      if(this.outPreview) this.outPreview.gain.value = 1;
      if(extraEl){ extraEl.pause(); URL.revokeObjectURL(extraEl.src); }
      this.exporting = false; back.remove();
      v.currentTime = this.trimIn;
      if(State.view === 'video') Views.video();
    }
  },

  afterRender(){
    this.canvas = document.getElementById('ve-canvas');
    if(!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.resizeCanvas();
    this.canvas.addEventListener('click', e => this.canvasClick(e));
    const track = document.getElementById('ve-track');
    if(track) track.addEventListener('click', e => { const r = track.getBoundingClientRect(); this.seek((e.clientX - r.left)/r.width*this.duration); });
    this.drawTrack(); this.updateInfo(); this.updatePlayBtn();
    if(this.video.readyState >= 2) this.redraw();
    else this.video.addEventListener('loadeddata', () => this.redraw(), { once: true });
  }
};

Views.video = async function(){
  const root = document.getElementById('view-root');
  const hasMedia = !!VE.video;
  const audios = (await MediaStore.all()).filter(r => r.kind === 'audio');
  if(State.view !== 'video') return;
  const actions = `<button class="btn btn-secondary btn-pill" onclick="VE.pickVideo()">Importar vídeo…</button>` +
    (hasMedia ? `<button class="btn btn-primary btn-pill" onclick="VE.export()">Exportar WebM</button>` : '');
  let body;
  if(!hasMedia){
    body = `<div class="workspace-body" style="max-width:900px;">
      <div class="v4-card"><h4>Escolha um vídeo para editar</h4>
        <p>Grave a tela em <b>Captura de tela</b> (ou a câmera em <b>Webcam</b>) e clique em <b>Editar</b>, ou importe um vídeo do seu computador.</p>
        <button class="btn btn-primary btn-pill" onclick="VE.pickVideo()">Importar vídeo…</button></div>
      <div class="section-head"><h3>Biblioteca de gravações</h3></div><div id="ve-list"></div></div>`;
  } else {
    const z = ExportOpts;
    const frames = Object.entries(FRAME_PRESETS).map(([id, f]) => `<option value="${id}" ${z.frame === id ? 'selected' : ''}>${escapeHtml(f.label)}</option>`).join('');
    body = `<div class="workspace-body">
      <div class="ve-layout">
        <div>
          <div class="studio-stage" style="aspect-ratio:auto;"><canvas id="ve-canvas" style="width:100%;${VE.pickFocus ? 'cursor:crosshair;' : ''}"></canvas></div>
          <div class="v4-row" style="margin-top:12px;">
            <button class="btn btn-primary btn-pill" id="ve-play" onclick="VE.toggle()">${ICON.play} Reproduzir</button>
            <input type="range" id="ve-seek" min="0" max="${VE.duration}" step="0.01" value="0" style="flex:1;accent-color:var(--accent);" oninput="VE.seek(this.value)">
            <span class="rec-timer" id="ve-cur" style="color:var(--text-muted);font-weight:500;">00:00 / ${fmtClock(VE.duration)}</span>
          </div>
          <div class="ve-timeline">
            <div class="v4-row spread"><b style="font-size:13px;">${escapeHtml(VE.media.name)}</b><span class="v4-help" id="ve-info"></span></div>
            <div class="ve-track" id="ve-track"></div>
            <div class="v4-row" style="gap:18px;">
              <label class="v4-help" style="flex:1;min-width:200px;">Início do corte: <b>${fmtClock(VE.trimIn)}</b>
                <input type="range" min="0" max="${VE.duration}" step="0.05" value="${VE.trimIn}" style="width:100%;accent-color:var(--accent);" onchange="VE.setIn(this.value);Views.video()" ></label>
              <label class="v4-help" style="flex:1;min-width:200px;">Fim do corte: <b>${fmtClock(VE.trimOut)}</b>
                <input type="range" min="0" max="${VE.duration}" step="0.05" value="${VE.trimOut}" style="width:100%;accent-color:var(--accent);" onchange="VE.setOut(this.value);Views.video()" ></label>
            </div>
            <div class="v4-row" style="margin-top:8px;">
              <button class="btn btn-secondary btn-sm btn-pill" onclick="VE.markIn()">Começar aqui</button>
              <button class="btn btn-secondary btn-sm btn-pill" onclick="VE.markOut()">Terminar aqui</button>
              <button class="btn btn-secondary btn-sm btn-pill" onclick="VE.trimIn=0;VE.trimOut=VE.duration;Views.video()">Limpar corte</button>
            </div>
          </div>
          ${VE.zooms.length || VE.texts.length ? `<div class="ve-list">
            ${VE.zooms.map(x => `<div class="ve-li"><span>Zoom ${x.scale}× · ${fmtClock(x.start)} → ${fmtClock(x.end)}</span><button class="btn btn-sm" onclick="VE.seek(${x.start})">ir</button><button class="btn btn-sm btn-danger-ghost" onclick="VE.removeItem('zooms','${x.id}')">excluir</button></div>`).join('')}
            ${VE.texts.map(x => `<div class="ve-li"><span>Texto “${escapeHtml(x.text)}” · ${fmtClock(x.start)} → ${fmtClock(x.end)}</span><button class="btn btn-sm" onclick="VE.seek(${x.start})">ir</button><button class="btn btn-sm btn-danger-ghost" onclick="VE.removeItem('texts','${x.id}')">excluir</button></div>`).join('')}
          </div>` : ''}
        </div>
        <div>
          <div class="v4-card"><h4>Velocidade</h4>
            <div class="seg">${[0.5, 0.75, 1, 1.5, 2].map(s => `<button class="${VE.speed === s ? 'on' : ''}" onclick="VE.setSpeed(${s})">${s}×</button>`).join('')}</div></div>
          <div class="v4-card"><h4>Zoom</h4>
            <p>Aproxima a câmera em um ponto do vídeo, com entrada e saída suaves.</p>
            <div class="v4-row"><select class="v4-select" id="ve-z-scale">${[1.5, 2, 3].map(s => `<option value="${s}" ${s === 2 ? 'selected' : ''}>${s}×</option>`).join('')}</select>
              <input class="v4-input" id="ve-z-dur" type="number" min="1" max="30" value="3" style="width:70px;"> <span class="v4-help">s</span></div>
            <div class="v4-row" style="margin-top:8px;">
              <button class="btn btn-secondary btn-sm btn-pill ${VE.pickFocus ? 'btn-primary' : ''}" id="ve-pick" onclick="VE.togglePick()">Escolher ponto no vídeo</button>
              <button class="btn btn-primary btn-sm btn-pill" onclick="VE.addZoom()">Adicionar no tempo atual</button></div>
            <div class="v4-help" style="margin-top:6px;">Ponto atual: ${Math.round(VE.focus.x)}% , ${Math.round(VE.focus.y)}%</div></div>
          <div class="v4-card"><h4>Texto na tela</h4>
            <input class="v4-input" id="ve-t-text" type="text" maxlength="120" placeholder="Ex: Clique em Acordos" style="width:100%;margin-bottom:8px;">
            <div class="v4-row"><select class="v4-select" id="ve-t-pos"><option value="bottom">Embaixo</option><option value="center">Centro</option><option value="top">Em cima</option></select>
              <input class="v4-input" id="ve-t-dur" type="number" min="1" max="30" value="3" style="width:70px;"> <span class="v4-help">s</span>
              <button class="btn btn-primary btn-sm btn-pill" onclick="VE.addText()">Adicionar</button></div></div>
          <div class="v4-card"><h4>Moldura e proporção</h4>
            <div class="eo-grid" style="padding:0;">
              <label class="eo-field"><span>Fundo</span><select onchange="VE.setFrameOpt('frame',this.value)">${frames}</select></label>
              <label class="eo-field"><span>Proporção</span><select onchange="VE.setFrameOpt('aspect',this.value)">${['16:9','4:3','1:1','9:16'].map(a => `<option ${z.aspect === a ? 'selected' : ''}>${a}</option>`).join('')}</select></label>
              <label class="eo-field"><span>Espaçamento ${z.pad}%</span><input type="range" min="0" max="12" value="${z.pad}" oninput="VE.setFrameOpt('pad',this.value)"></label>
            </div></div>
          <div class="v4-card"><h4>Áudio</h4>
            <label class="eo-field" style="margin-bottom:8px;"><span>Volume do vídeo</span><input type="range" min="0" max="1" step="0.05" value="${VE.origVol}" oninput="VE.setOrigVol(this.value)"></label>
            <label class="eo-field" style="margin-bottom:8px;"><span>Faixa extra (narração gravada)</span>
              <select onchange="VE.setExtra(this.value)"><option value="">Nenhuma</option>${audios.map(a => `<option value="${a.id}" ${VE.extraId === a.id ? 'selected' : ''}>${escapeHtml(a.name)} (${fmtClock(a.duration)})</option>`).join('')}</select></label>
            <label class="eo-field"><span>Volume da faixa extra</span><input type="range" min="0" max="1" step="0.05" value="${VE.extraVol}" oninput="VE.setExtraVol(this.value)"></label></div>
          <div class="v4-card"><h4>Quadro atual</h4>
            <p>Use um momento do vídeo como tela de um tutorial.</p>
            <div class="v4-row"><button class="btn btn-primary btn-sm btn-pill" onclick="VE.frameToTutorial()">${ICON.send} Adicionar a um tutorial</button>
              <button class="btn btn-secondary btn-sm btn-pill" onclick="VE.frameDownload()">Baixar PNG</button></div></div>
          <button class="btn btn-secondary btn-sm btn-pill btn-danger-ghost" onclick="VE.unload()">Fechar este vídeo</button>
        </div>
      </div>
      <div class="section-head" style="margin-top:26px;"><h3>Biblioteca de gravações</h3></div><div id="ve-list"></div>
    </div>`;
  }
  root.innerHTML = Studio.header('video', actions) + body;
  MediaList.render('ve-list', ['screen', 'webcam', 'edited'], { edit: true, empty: 'Nenhuma gravação ainda. Grave a tela em Captura de tela.' });
  if(hasMedia) VE.afterRender();
};


/* ===========================================================
   DASHBOARD — guia "onde fica cada coisa"
   =========================================================== */
(function(){
  const base = Views.dashboard;
  Views.dashboard = function(){
    base.call(Views);
    const body = document.querySelector('#view-root .workspace-body'); if(!body) return;
    const groups = [
      ['Tutoriais', [['tutorials','Meus tutoriais','Criar, abrir e excluir os tutoriais'], ['library','Biblioteca','Estilos de destaque e elementos livres (seta, balão, texto, imagem...)']]],
      ['Publicar',  [['exports','Exportar','Formato, qualidade, proporção, moldura e animação'], ['projects','Projetos e backup','Salvar tutoriais em arquivo e abrir em outro computador']]],
      ['Estúdio · mídia', [['capture','Captura de tela','Gravar a tela (com webcam e moldura) ou tirar um print'], ['webcam','Webcam','Formato, canto e tamanho da câmera'], ['video','Editor de vídeo','Cortar, acelerar, zoom, texto e narração'], ['audio','Áudio','Gravar narração'], ['extensions','Extensões','Molduras, predefinições e marca d\'água']]],
      ['Sistema', [['shortcuts','Atalhos','Teclas rápidas que você pode mudar'], ['settings','Configurações','Tema, cor, idioma e armazenamento']]]
    ];
    const card = document.createElement('div');
    card.className = 'v4-card'; card.style.marginTop = '28px';
    card.innerHTML = '<h4>Onde fica cada coisa</h4><p>O menu à esquerda está dividido em grupos. Clique para ir direto:</p>' +
      groups.map(([g, items]) => '<div class="sc-group" style="padding-left:0;">' + g + '</div><div class="v4-grid" style="grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px;">' +
        items.map(([v, t, d]) => '<div class="rec-item" style="cursor:pointer;" onclick="App.switchView(\'' + v + '\')"><div class="rec-meta"><div class="rec-name">' + t + '</div><div class="rec-info" style="white-space:normal;">' + d + '</div></div></div>').join('') + '</div>').join('');
    body.appendChild(card);
  };
})();

// o Dashboard já foi desenhado por app.js antes deste arquivo carregar: redesenha com o guia
if(State.view === 'dashboard') Views.dashboard();
