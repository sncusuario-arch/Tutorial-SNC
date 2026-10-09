const { launch, ok, TMP } = require('./lib');
const fs = require('fs');
module.exports = async (BASE) => {
  const { browser, ctx, page, errors } = await launch();
  const st = JSON.parse(fs.readFileSync(TMP + '/state.json'));
  await page.addInitScript(([s, g]) => { if (!localStorage.getItem('looptour_data_v1')) { localStorage.setItem('looptour_data_v1', s); localStorage.setItem('looptour_settings_v1', g); } }, [st.s, st.g]);
  // "tela" sintética para o teste (getDisplayMedia não existe em headless)
  await page.addInitScript(() => {
    navigator.mediaDevices.getDisplayMedia = async () => {
      const c = document.createElement('canvas'); c.width = 1280; c.height = 720;
      const x = c.getContext('2d'); let n = 0;
      setInterval(() => { n++; x.fillStyle = '#fff'; x.fillRect(0, 0, 1280, 720); x.fillStyle = '#007aff'; x.fillRect((n * 8) % 1100, 300, 160, 80); x.fillStyle = '#1d1d1f'; x.font = '40px sans-serif'; x.fillText('Tela simulada ' + n, 60, 90); }, 40);
      return c.captureStream(25);
    };
  });
  await page.goto(BASE + '/index.html');
  await page.waitForTimeout(700);
  const view = async v => { await page.evaluate(v => App.switchView(v), v); await page.waitForTimeout(300); };

  /* ---- Extensões ---- */
  await view('extensions');
  ok(await page.locator('.ext-card').count() === 3, '3 extensões embutidas');
  ok(await page.evaluate(() => !!FRAME_PRESETS.oceano && !!FRAME_PRESETS.noite), 'molduras extras registradas');
  await page.evaluate(() => { ExtUI.toggle('snc.molduras-extra', false); });
  ok(await page.evaluate(() => !FRAME_PRESETS.oceano), 'desligar extensão remove as molduras');
  await page.evaluate(() => { ExtUI.toggle('snc.molduras-extra', true); });
  await page.evaluate(() => { ExtUI.set('snc.marca-dagua', 'on', true); ExtUI.set('snc.marca-dagua', 'text', 'SNC Teste'); });
  const diff = await page.evaluate(() => {
    const mk = () => { const c = document.createElement('canvas'); c.width = 800; c.height = 450; const x = c.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, 800, 450); return [c, x]; };
    const [c1, x1] = mk(); Extensions.st.settings['snc.marca-dagua'].on = false; Extensions.postRender(x1, 800, 450);
    const [c2, x2] = mk(); Extensions.st.settings['snc.marca-dagua'].on = true; Extensions.postRender(x2, 800, 450);
    return c1.toDataURL() !== c2.toDataURL();
  });
  ok(diff, "marca d'água é desenhada quando ligada");
  // instalar exemplo + manifesto inválido
  await page.evaluate(() => ExtUI.showExample());
  await page.evaluate(() => ExtUI.installFromText());
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => !!FRAME_PRESETS['meu.exemplo:instituicao']), 'extensão de exemplo instalada (moldura registrada)');
  ok(await page.locator('.ext-card').count() === 4, '4 cartões após instalar');
  await page.evaluate(() => { document.getElementById('ext-install-area').style.display = 'block'; document.getElementById('ext-code').value = JSON.stringify({ id: 'x', name: '', contributes: { script: 'alert(1)' } }); ExtUI.installFromText(); });
  const errs = await page.evaluate(() => document.getElementById('ext-errors').textContent);
  ok(/id.*inválido|name.*obrigat|não é suportado/.test(errs), 'manifesto inválido é recusado: ' + errs.slice(0, 90));
  // preset da extensão na tela Exportar
  await view('exports');
  await page.click('button[data-preset="meu.exemplo/oficial"]');
  ok(await page.evaluate(() => ExportOpts.frame === 'meu.exemplo:instituicao'), 'preset da extensão aplica a moldura da extensão');
  await page.click('button[data-preset="__default"]');
  ok(await page.evaluate(() => ExportOpts.frame === 'default'), 'preset Padrão restaura');
  await page.selectOption('[data-eo="frame"]', 'aurora');
  ok(await page.evaluate(() => ExportOpts.frame === 'aurora'), 'seletor de moldura da tela Exportar altera ExportOpts');
  await page.evaluate(() => { ExportOpts.frame = 'default'; Persist.saveSettings(); });

  /* ---- Projetos ---- */
  await view('projects');
  const dl = page.waitForEvent('download');
  await page.evaluate(() => Projects.exportAll());
  const d = await dl; const pp = TMP + '/proj.tutor.json'; await d.saveAs(pp);
  const pj = JSON.parse(fs.readFileSync(pp, 'utf8'));
  ok(pj.format === 'tutor-snc-project' && pj.tutorials[0].screens[0].annotations.length === 3 && pj.tutorials[0].screens[0].steps[1].zoom === 2, 'projeto salvo com anotações e zoom');
  await page.evaluate(() => { State.tutorials = []; Persist.saveData(); });
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.evaluate(() => Projects.pickFile())]);
  await chooser.setFiles(pp);
  await page.waitForTimeout(800);
  ok(await page.evaluate(() => State.tutorials.length) === 1 && await page.evaluate(() => State.tutorials[0].screens[0].annotations.length) === 3, 'projeto importado (tutorial + 3 anotações)');
  ok(await page.evaluate(() => State.tutorials[0].screens[0].imgEl.complete), 'imagem reidratada após importar');
  // arquivo inválido
  fs.writeFileSync(TMP + '/bad.json', '{"hello":1}');
  const [ch2] = await Promise.all([page.waitForEvent('filechooser'), page.evaluate(() => Projects.pickFile())]);
  await ch2.setFiles(TMP + '/bad.json'); await page.waitForTimeout(400);
  ok(await page.evaluate(() => /inválido/.test(document.getElementById('toast').textContent)), 'arquivo inválido é recusado com aviso');
  ok(await page.evaluate(() => State.tutorials.length) === 1, 'nada foi adicionado pelo arquivo inválido');

  /* ---- Atalhos ---- */
  await view('shortcuts');
  ok(await page.locator('.sc-table tr').count() >= 9, 'tela de atalhos lista as ações');
  await page.evaluate(() => Shortcuts.startRecord('newStep'));
  await page.keyboard.press('m');
  ok(await page.evaluate(() => State.shortcuts.newStep) === 'M', 'atalho Novo passo reatribuído para M');
  await page.evaluate(() => Shortcuts.startRecord('preview'));
  await page.keyboard.press('m');
  ok(await page.evaluate(() => State.shortcuts.preview) === undefined, 'conflito de tecla é recusado');
  await page.keyboard.press('Escape');
  await page.evaluate(() => { document.getElementById('modal-onboarding').classList.remove('on'); Editor.open(State.tutorials[0].id); });
  await page.waitForTimeout(400);
  await page.keyboard.press('m');
  ok(await page.evaluate(() => State.editor.drawMode), 'atalho M inicia desenho no editor');
  await page.evaluate(() => { Editor.stopDraw(); Editor.close(); });
  await page.evaluate(() => Shortcuts.resetAll());

  /* ---- Idioma ---- */
  await page.evaluate(() => Settings.setLang('en'));
  ok(await page.locator('[data-i18n="n.capture"]').textContent() === 'Screen capture', 'idioma EN no menu');
  await page.evaluate(() => Settings.setLang('es'));
  ok(await page.locator('[data-i18n="n.extensions"]').textContent() === 'Extensiones', 'idioma ES no menu');
  await page.evaluate(() => Settings.setLang('pt'));

  /* ---- Webcam ---- */
  await view('webcam');
  await page.evaluate(() => WebcamView.startPreview());
  await page.waitForTimeout(1200);
  ok(await page.evaluate(() => { const v = document.querySelector('#wc-bubble video'); return !!(v && v.videoWidth > 0); }), 'webcam (simulada) ligada com imagem');
  await page.evaluate(() => WebcamView.set('shape', 'rounded'));
  ok(await page.evaluate(() => document.getElementById('wc-bubble').style.borderRadius) === '20%', 'formato da webcam muda no preview');
  await page.evaluate(() => WebcamView.record());
  await page.waitForTimeout(2200);
  await page.evaluate(() => WebcamView.stopRecord());
  await page.waitForTimeout(1500);
  ok(await page.evaluate(async () => (await MediaStore.all()).filter(r => r.kind === 'webcam').length) === 1, 'gravação da webcam salva no IndexedDB');
  await page.evaluate(() => WebcamView.stopPreview());

  /* ---- Áudio ---- */
  await view('audio');
  await page.evaluate(() => AudioView.record());
  await page.waitForTimeout(1500);
  await page.evaluate(() => AudioView.stop());
  await page.waitForTimeout(1200);
  const aud = await page.evaluate(async () => (await MediaStore.all()).filter(r => r.kind === 'audio').map(r => r.size));
  ok(aud.length === 1 && aud[0] > 1000, 'narração gravada e salva (' + aud + ' bytes)');
  ok(await page.locator('#au-list audio').count() === 1, 'player de áudio na lista');

  /* ---- Captura de tela (com webcam + moldura) ---- */
  await page.evaluate(() => { StudioCfg.data.capture.countdown = 0; StudioCfg.data.capture.useCam = true; StudioCfg.data.capture.compose = true; StudioCfg.data.capture.mic = true; StudioCfg.data.capture.sysAudio = false; ExportOpts.frame = 'azul'; });
  await view('capture');
  await page.evaluate(() => Capture.start());
  await page.waitForTimeout(3500);
  ok(await page.evaluate(() => Capture.state) === 'recording', 'gravando a tela (estado=recording)');
  await page.screenshot({ path: TMP + '/shot-capture-rec.png' });
  await page.evaluate(() => Capture.stop());
  await page.waitForTimeout(2000);
  const scr = await page.evaluate(async () => (await MediaStore.all()).filter(r => r.kind === 'screen').map(r => ({ id: r.id, size: r.size, dur: r.duration, thumb: !!r.thumb })));
  ok(scr.length === 1 && scr[0].size > 5000, 'gravação de tela salva ' + JSON.stringify(scr));
  const printOk = await page.evaluate(async () => { await Capture.screenshot(); return !!Capture.shot; });
  ok(printOk, 'print de tela capturado');
  await page.evaluate(() => { ExportOpts.frame = 'default'; StudioCfg.data.capture.useCam = false; StudioCfg.data.capture.compose = false; });

  /* ---- Editor de vídeo ---- */
  await page.evaluate(id => VE.openMedia(id), scr[0].id);
  await page.waitForTimeout(1800);
  ok(await page.evaluate(() => VE.duration) > 2, 'vídeo carregado no editor, duração=' + await page.evaluate(() => VE.duration));
  await page.evaluate(() => { VE.seek(1); });
  await page.waitForTimeout(400);
  await page.evaluate(() => { document.getElementById('ve-t-text').value = 'Clique aqui'; VE.addText(); });
  await page.waitForTimeout(300);
  await page.evaluate(() => { VE.seek(0.5); });
  await page.waitForTimeout(300);
  await page.evaluate(() => { VE.addZoom(); });
  await page.waitForTimeout(300);
  await page.evaluate(() => VE.setSpeed(2));
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => VE.zooms.length === 1 && VE.texts.length === 1 && VE.speed === 2), 'zoom, texto e velocidade adicionados');
  await page.evaluate(id => VE.setExtra(id), (await page.evaluate(async () => (await MediaStore.all()).find(r => r.kind === 'audio').id)));
  await page.screenshot({ path: TMP + '/shot-ve.png' });
  const vdl = page.waitForEvent('download', { timeout: 120000 });
  await page.evaluate(() => VE.export());
  const vd = await vdl; const vp = TMP + '/ve-out.webm'; await vd.saveAs(vp);
  await page.waitForTimeout(1500);
  
  ok(fs.statSync(vp).size > 5000, 'vídeo editado exportado: ' + fs.statSync(vp).size + ' bytes');
  ok(await page.evaluate(async () => (await MediaStore.all()).filter(r => r.kind === 'edited').length) === 1, 'vídeo editado salvo na biblioteca');
  ok(await page.evaluate(() => { VE.frameToTutorial; const c = VE.grabFrame(); return c && c.width > 100; }), 'quadro do vídeo capturável para tutorial');

  ok(errors.length === 0, 'sem erros de JavaScript na página ' + JSON.stringify(errors));
  await browser.close();
};
