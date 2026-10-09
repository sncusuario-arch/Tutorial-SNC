// Tutor SNC — casca de desktop (Electron). Abre o mesmo index.html do navegador.
// Vantagem: a captura de tela funciona sem tela de permissão extra e o app roda sem internet
// (as bibliotecas jsPDF e gif.js continuam vindo da CDN; para uso 100% offline, baixe-as para js/).
const { app, BrowserWindow, desktopCapturer, session, shell } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1100, minHeight: 700,
    title: 'Tutor SNC', backgroundColor: '#ffffff',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, '..', 'index.html'));
  // links externos abrem no navegador padrão
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

app.whenReady().then(() => {
  // getDisplayMedia no Electron precisa de um "escolhedor": aqui usamos a primeira tela
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen', 'window'] }).then(sources => {
      callback({ video: sources[0], audio: 'loopback' });
    }).catch(() => callback({}));
  });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
