// Makes 08-page.js believe it's still running inside 16-summary.swift's
// WKWebView — see hasNativeBridge()/dispatchAction() there. The page only
// ever checks for window.webkit.messageHandlers.classdash; it has no idea
// (and doesn't need to know) that the other end is now main.js instead of
// Swift. Reproducing that exact shape means 08-page.js and
// 21-notifier-actions.js need zero changes to run under Electron.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('webkit', {
  messageHandlers: {
    classdash: {
      postMessage(body) {
        ipcRenderer.send('classdash-action', body);
      },
    },
  },
});

// No reply-side code here — the result comes back the same way Swift's
// deliver() sends it, via the main process calling
// webContents.executeJavaScript("window.classdashBridgeResult(...)")
// directly (see main.js). That runs in the page's own main world
// regardless of context isolation; a listener in THIS file couldn't reach
// window.classdashBridgeResult itself, since contextBridge (required for
// exposeInMainWorld above) means this script's `window` is the isolated
// world, not the page's.
