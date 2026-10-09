const { launch, ok, TMP } = require('./lib');
const fs = require('fs');
module.exports = async (BASE) => {
  const { browser, ctx, page, errors } = await launch();
  const st = JSON.parse(fs.readFileSync(TMP + '/state.json'));
  await page.addInitScript(([s, g]) => { if (!localStorage.getItem('looptour_data_v1')) { localStorage.setItem('looptour_data_v1', s); localStorage.setItem('looptour_settings_v1', g); } }, [st.s, st.g]);
  await page.goto(BASE + '/index.html');
  await page.waitForTimeout(700);
  ok(await page.evaluate(() => State.tutorials.length) === 1, 'tutorial restaurado do localStorage');
  await page.evaluate(() => { document.getElementById('modal-onboarding').classList.remove('on'); Editor.open(State.tutorials[0].id); });
  await page.waitForTimeout(500);

  async function doExport(fmt, timeout = 120000) {
    await page.evaluate(() => { Editor.exportOpen(); document.getElementById('step-duration').value = 2; });
    await page.waitForTimeout(200);
    const dl = page.waitForEvent('download', { timeout });
    await page.evaluate(f => Editor.exportChoose(f), fmt);
    const d = await dl;
    const p = TMP + '/out-' + fmt + '-' + d.suggestedFilename();
    await d.saveAs(p);
    await page.evaluate(() => { document.getElementById('modal-export').classList.remove('on'); });
    return p;
  }

  // PDF
  let p = await doExport('pdf');
  let b = fs.readFileSync(p); ok(b.slice(0, 5).toString() === '%PDF-', 'PDF gerado (' + b.length + ' bytes)');
  const pages = (b.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length; ok(pages === 2, 'PDF com 2 páginas (' + pages + ')');

  // GIF animado
  const t0 = Date.now();
  p = await doExport('gif');
  b = fs.readFileSync(p); ok(b.slice(0, 6).toString() === 'GIF89a', 'GIF gerado (' + b.length + ' bytes, ' + (Date.now() - t0) + 'ms)');
  let frames = 0; for (let i = 0; i < b.length - 1; i++) if (b[i] === 0x21 && b[i + 1] === 0xF9) frames++;
  ok(frames > 10, 'GIF animado tem vários quadros (' + frames + ')');

  // GIF estático
  await page.evaluate(() => { ExportOpts.anim = false; });
  p = await doExport('gif'); b = fs.readFileSync(p);
  frames = 0; for (let i = 0; i < b.length - 1; i++) if (b[i] === 0x21 && b[i + 1] === 0xF9) frames++;
  ok(frames === 2, 'GIF estático tem 1 quadro por passo (' + frames + ')');
  await page.evaluate(() => { ExportOpts.anim = true; });

  // Vídeo (aspect 9:16 + moldura aurora para exercitar)
  await page.evaluate(() => { ExportOpts.aspect = '9:16'; ExportOpts.frame = 'aurora'; ExportOpts.quality = 'low'; });
  p = await doExport('video');
  b = fs.readFileSync(p); ok(b.slice(0, 4).toString('hex') === '1a45dfa3', 'WebM gerado (' + b.length + ' bytes)');
  await page.evaluate(() => { ExportOpts.aspect = '16:9'; ExportOpts.frame = 'default'; ExportOpts.quality = 'med'; });

  // preview da moldura em PNG
  const png = await page.evaluate(() => {
    ExportOpts.frame = 'azul'; ExportOpts.radius = 16; ExportOpts.pad = 6;
    const t = State.tutorials[0], sc = t.screens[0];
    const c = document.createElement('canvas'); const d = exportDims('video'); c.width = d.W; c.height = d.H;
    const steps = collectStepsForExport().steps;
    renderStepToCanvas(steps[1], c, 1, 2, t.brand, null, undefined, buildAnimState(steps, 1, d.W, d.H, 0.7, 1.0));
    return c.toDataURL('image/png');
  });
  fs.writeFileSync(TMP + '/frame-azul-zoom.png', Buffer.from(png.split(',')[1], 'base64'));
  const png2 = await page.evaluate(() => {
    ExportOpts.frame = 'default';
    const c = document.createElement('canvas'); const d = exportDims('pdf'); c.width = d.W; c.height = d.H;
    const steps = collectStepsForExport().steps;
    renderStepToCanvas(steps[0], c, 0, 2, null, null, 'light');
    return c.toDataURL('image/png');
  });
  fs.writeFileSync(TMP + '/pdf-page.png', Buffer.from(png2.split(',')[1], 'base64'));
  await page.evaluate(() => { ExportOpts.frame = 'default'; ExportOpts.radius = 10; ExportOpts.pad = 3; });

  // HTML exportado: abre numa página nova e roda o Tour
  p = await doExport('html');
  b = fs.readFileSync(p, 'utf8');
  ok(b.includes('window.Tour') && b.includes('tour-cursor'), 'HTML contém engine com cursor');
  const html = await ctx.newPage();
  const herrs = []; html.on('pageerror', e => herrs.push(e.message));
  await html.goto('file://' + p);
  await html.waitForTimeout(400);
  await html.evaluate(() => Tour.start());
  await html.waitForTimeout(900);
  ok(await html.locator('.tour-cursor.on').count() === 1, 'HTML exportado: cursor animado aparece');
  await html.evaluate(() => Tour.next());
  await html.waitForTimeout(900);
  const tf = await html.evaluate(() => document.getElementById('tour-img').style.transform);
  ok(/scale\(2\)/.test(tf), 'HTML exportado: zoom do passo 2 aplicado (' + tf + ')');
  ok(await html.locator('.ann-text').count() === 1 && await html.locator('.ann-badge').count() === 1 && await html.locator('.ann-image').count() === 1, 'HTML exportado: elementos texto/número/imagem renderizados');
  await html.screenshot({ path: TMP + '/html-export.png' });
  ok(herrs.length === 0, 'HTML exportado sem erros de JS ' + JSON.stringify(herrs));

  ok(errors.length === 0, 'sem erros de JavaScript na página ' + JSON.stringify(errors));
  await browser.close();
};
