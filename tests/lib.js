// Utilitários dos testes de ponta a ponta (Playwright). Rode: npm test
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), http = require('http'), os = require('os');

const ROOT = path.resolve(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tutor-snc-test-'));

const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png' };
function serve() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const u = decodeURIComponent(req.url.split('?')[0]);
      const f = path.join(ROOT, u === '/' ? 'index.html' : u);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    }).listen(0, '127.0.0.1', () => resolve({ srv, base: 'http://127.0.0.1:' + srv.address().port }));
  });
}

async function launch(opts = {}) {
  const launchOpts = { args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] };
  if (process.env.CHROMIUM_PATH) launchOpts.executablePath = process.env.CHROMIUM_PATH;
  const browser = await chromium.launch(launchOpts);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, permissions: ['camera', 'microphone'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_|404|Failed to load resource|Error: formato/.test(m.text())) errors.push('console.error ' + m.text()); });
  // bibliotecas de CDN servidas do node_modules (os testes não dependem de internet)
  const nm = p => path.join(ROOT, 'node_modules', p);
  const cdn = { 'jspdf.umd.min.js': nm('jspdf/dist/jspdf.umd.min.js'), 'gif.worker.js': nm('gif.js/dist/gif.worker.js'), 'gif.js': nm('gif.js/dist/gif.js') };
  await page.route(/cdnjs\.cloudflare\.com/, route => {
    const u = route.request().url(); const k = Object.keys(cdn).find(k => u.endsWith(k));
    if (k && fs.existsSync(cdn[k])) return route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(cdn[k]), headers: { 'access-control-allow-origin': '*' } });
    return route.abort();
  });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  return { browser, ctx, page, errors };
}

async function makeShot(page, file) {
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 1280; c.height = 800;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, 1280, 800);
    x.fillStyle = '#f5f5f7'; x.fillRect(0, 0, 1280, 64); x.fillRect(0, 64, 230, 736);
    x.fillStyle = '#d2d2d7'; for (let i = 0; i < 6; i++) x.fillRect(24, 96 + i * 44, 160, 14);
    x.fillStyle = '#e5e5ea'; for (let i = 0; i < 5; i++) x.fillRect(270, 110 + i * 90, 900, 58);
    x.fillStyle = '#007aff'; x.fillRect(1020, 20, 120, 28);
    x.fillStyle = '#1d1d1f'; x.font = '24px sans-serif'; x.fillText('Sistema de teste', 280, 150);
    return c.toDataURL('image/png');
  });
  fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
}

let failed = 0, passed = 0;
const ok = (c, m) => { console.log((c ? '  PASS ' : '  FAIL ') + m); c ? passed++ : failed++; };
const summary = () => ({ passed, failed });
module.exports = { launch, makeShot, serve, ok, TMP, summary };
