const { launch, makeShot, ok, TMP, summary } = require('./lib');
const fs = require('fs');
module.exports = async (BASE) => {
  const { browser, page, errors } = await launch();
  await page.goto(BASE + '/index.html');
  await page.waitForTimeout(600);
  await makeShot(page, TMP + '/shot.png');

  // criar tutorial
  await page.evaluate(() => Modal.open('new'));
  await page.fill('#new-tutorial-name', 'Teste v4');
  await page.click('text=Criar tutorial');
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => document.getElementById('editor').classList.contains('open')), 'editor abriu');
  await page.waitForTimeout(600);
  await page.click('text=Entendi, vamos lá');
  await page.setInputFiles('#file-input', TMP + '/shot.png');
  await page.waitForTimeout(600);
  ok(await page.evaluate(() => Editor.activeScreen() && Editor.activeScreen().steps.length === 0), 'tela enviada');

  // desenhar passo 1 por arrasto
  await page.evaluate(() => Editor.startDraw());
  const box = await page.locator('#stage').boundingBox();
  await page.mouse.move(box.x + box.width * 0.78, box.y + box.height * 0.03);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.08, { steps: 5 });
  await page.mouse.up();
  await page.fill('#insp-title', 'Clique no botão azul');
  await page.fill('#insp-text', 'Este é o botão principal.');
  await page.click('text=Salvar passo');
  await page.waitForTimeout(200);
  // passo 2 com zoom
  await page.evaluate(() => Editor.startDraw());
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.3, { steps: 5 });
  await page.mouse.up();
  await page.fill('#insp-title', 'Veja a lista');
  await page.fill('#insp-text', 'A lista mostra os itens.');
  await page.click('text=Salvar passo');
  await page.waitForTimeout(200);
  await page.click('.inspector-tab[data-tab=style]');
  await page.click('.zoom-pill:has-text("2×")');
  const z = await page.evaluate(() => Editor.activeStep().zoom);
  ok(z === 2, 'zoom 2× aplicado ao passo 2 (zoom=' + z + ')');
  ok(await page.evaluate(() => State.tutorials[0].screens[0].steps.length) === 2, '2 passos');

  // novos elementos livres
  await page.evaluate(() => {
    const sc = Editor.activeScreen();
    sc.annotations.push({ id: 'a1', type: 'text', xPct: 30, yPct: 60, text: 'Texto livre' });
    sc.annotations.push({ id: 'a2', type: 'badge', xPct: 60, yPct: 60, text: '1' });
    const c = document.createElement('canvas'); c.width = 40; c.height = 40; const x = c.getContext('2d'); x.fillStyle = '#30d158'; x.fillRect(0, 0, 40, 40);
    sc.annotations.push({ id: 'a3', type: 'image', xPct: 80, yPct: 60, dataUrl: c.toDataURL() });
    Editor.renderCanvas(); Editor.scheduleSave();
  });
  ok(await page.locator('.ann-text').count() === 1 && await page.locator('.ann-badge').count() === 1 && await page.locator('.ann-image').count() === 1, 'elementos texto/número/imagem aparecem no editor');

  // Player: zoom + cursor
  await page.evaluate(() => Editor.play());
  await page.waitForTimeout(900);
  ok(await page.locator('.player-cursor.on').count() === 1, 'cursor animado visível no passo 1');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(900);
  const tf = await page.evaluate(() => document.getElementById('player-img').style.transform);
  ok(/scale\(2\)/.test(tf), 'zoom aplicado ao passo 2 no Player: ' + tf);
  const hs = await page.evaluate(() => { const r = document.getElementById('player-hotspot').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: innerWidth, h: innerHeight }; });
  ok(Math.abs(hs.x - hs.w / 2) < 60, 'destaque centralizado horizontalmente após zoom (x=' + Math.round(hs.x) + ' de ' + hs.w + ')');
  await page.screenshot({ path: TMP + '/shot-player-zoom.png' });
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(900);
  ok(await page.evaluate(() => document.getElementById('player-img').style.transform) === 'none', 'volta ao passo 1 sem zoom');
  await page.keyboard.press('Escape');

  // atalhos: N desenha, depois reatribuir
  await page.evaluate(() => { State.editor.activeStepId = null; });
  await page.keyboard.press('n');
  ok(await page.evaluate(() => State.editor.drawMode), 'atalho N inicia desenho');
  await page.evaluate(() => Editor.stopDraw());

  ok(errors.length === 0, 'sem erros de JavaScript na página ' + JSON.stringify(errors));
  fs.writeFileSync(TMP + '/state.json', JSON.stringify(await page.evaluate(() => ({ s: localStorage.getItem('looptour_data_v1'), g: localStorage.getItem('looptour_settings_v1') }))));
  await browser.close();
};
