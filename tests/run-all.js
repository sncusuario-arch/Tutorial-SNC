// Roda todos os testes em sequência: node tests/run-all.js  (ou: npm test)
const { serve, summary, TMP } = require('./lib');
(async () => {
  const { srv, base } = await serve();
  const files = ['01-editor.js', '02-export.js', '03-studio.js'];
  for (const f of files) {
    console.log('\n== ' + f);
    try { await require('./' + f)(base); } catch (e) { console.log('  FAIL erro inesperado: ' + e.message); require('./lib').summary().failed++; process.exitCode = 1; break; }
  }
  srv.close();
  const s = summary();
  console.log('\nResultado: ' + s.passed + ' ok, ' + s.failed + ' falhas  (arquivos de saída em ' + TMP + ')');
  process.exit(s.failed ? 1 : 0);
})();
