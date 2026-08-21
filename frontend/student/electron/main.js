// electron/main.js
//
// Electron main process for the TrueWatch student desktop app.
//
// WHY THIS FILE EXISTS AT ALL: the student portal is architecturally
// different from the lecturer/admin portals (see Chapter 5, Section 5.1).
// It runs as a single-role client with no RBAC switching, and — the whole
// reason for this Electron conversion — it needs OS-level access that a
// browser tab can never have: knowing WHICH application the student
// switched to, not just that they switched away. A website is deliberately
// and permanently blocked from seeing this by every browser's security
// model; only a desktop process with real OS permissions can ask "what
// window currently has focus" and get a real answer.
//
// IMPLEMENTATION NOTE: an earlier version of this file used the npm
// package `active-win`, which wraps a compiled native binary per platform
// (a Swift helper on macOS, a C# helper on Windows). That binary proved
// unreliable in practice. This version instead directly ports the
// approach already proven to work in the project's original Python
// desktop prototype (modules/utils/tab_monitor.py): AppleScript via
// `osascript` on macOS, a PowerShell/User32 call on Windows, and
// xdotool/xprop on Linux — invoked directly via Node's child_process,
// with no native compilation step at all.

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const { execFile } = require('node:child_process');

const isDev = !app.isPackaged;

// The Vite dev server URL during development, vs. the built static files
// once packaged. Keeping this as one constant makes the swap between the
// two completely explicit rather than buried in conditional logic below.
const DEV_SERVER_URL = 'http://localhost:5173';
const PROD_INDEX_HTML = path.join(__dirname, '..', 'dist', 'index.html');

let mainWindow = null;
// Ensures the troubleshooting hint below prints once per app run, not on
// every query, so it doesn't flood the console.
let focusQueryWarned = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    title: 'TrueWatch',
    webPreferences: {
      // contextIsolation + a preload script is the only safe way to expose
      // main-process capabilities to the renderer. Never set
      // nodeIntegration: true here — that would give the React app (which
      // ultimately renders content driven by exam data) full Node.js
      // access, a real security hole for no benefit.
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (isDev) {
    mainWindow.loadURL(DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(PROD_INDEX_HTML);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─── Focus / app-switch detection (OS-native, no compiled deps) ───────

function execFileAsync(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 3000, ...options }, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout.toString().trim());
    });
  });
}

// macOS — AppleScript via System Events, identical query to the Python
// prototype's tab_monitor.py. Returns "AppName - WindowTitle", or just
// "AppName" when the frontmost process has no accessible window title
// (the AppleScript's own `on error` branch already handles that case).
async function getFocusedWindowMac() {
  const script = `
    tell application "System Events"
      set frontApp to name of first application process whose frontmost is true
      try
        tell process frontApp
          set winTitle to name of window 1
          return frontApp & " - " & winTitle
        end tell
      on error
        return frontApp
      end try
    end tell
  `;
  const raw = await execFileAsync('osascript', ['-e', script]);
  const [appName, ...rest] = raw.split(' - ');
  return { appName: appName || raw, windowTitle: rest.join(' - ') || '' };
}

// Windows — PowerShell calling the same User32 GetForegroundWindow /
// GetWindowText pair the Python prototype used via ctypes, just invoked
// through PowerShell's Add-Type instead of Python's ctypes binding.
async function getFocusedWindowWin() {
  const script = `
    Add-Type @"
      using System;
      using System.Runtime.InteropServices;
      using System.Text;
      public class Win32 {
        [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
      }
"@
    $hwnd = [Win32]::GetForegroundWindow()
    $sb = New-Object System.Text.StringBuilder 256
    [Win32]::GetWindowText($hwnd, $sb, 256) | Out-Null
    Write-Output $sb.ToString()
  `;
  const raw = await execFileAsync('powershell', ['-NoProfile', '-Command', script]);
  // Windows window titles are typically "Document - AppName" or just
  // "AppName" — there's no clean OS-level separation like macOS's
  // process-name-vs-window-title, so the whole string is used as the
  // effective app name here, same as the Python prototype did.
  return { appName: raw || 'Unknown application', windowTitle: raw || '' };
}

// Linux — xdotool first, xprop as a fallback, identical to the Python
// prototype's two-step approach.
async function getFocusedWindowLinux() {
  try {
    const raw = await execFileAsync('xdotool', ['getactivewindow', 'getwindowname']);
    return { appName: raw || 'Unknown application', windowTitle: raw || '' };
  } catch {
    const idRaw = await execFileAsync('sh', ['-c', "xprop -root _NET_ACTIVE_WINDOW | cut -d' ' -f5"]);
    const out = await execFileAsync('xprop', ['-id', idRaw, 'WM_NAME']);
    const match = out.match(/="([^"]*)"/);
    const name = match ? match[1] : 'Unknown application';
    return { appName: name, windowTitle: name };
  }
}

async function getFocusedWindowInfo() {
  try {
    if (process.platform === 'darwin') return await getFocusedWindowMac();
    if (process.platform === 'win32')   return await getFocusedWindowWin();
    return await getFocusedWindowLinux();
  } catch (err) {
    if (!focusQueryWarned) {
      focusQueryWarned = true;
      const hint = process.platform === 'darwin'
        ? 'On macOS this is an Automation permission prompt: the first time this runs, ' +
          'macOS should ask to let this app control "System Events" — click OK. If you ' +
          'missed it or clicked Don\'t Allow, go to System Settings -> Privacy & Security -> ' +
          'Automation -> enable Electron\'s permission to control System Events, then fully ' +
          'restart `npm run electron:dev`.'
        : 'Check that the platform tool this relies on (PowerShell on Windows, ' +
          'xdotool/xprop on Linux) is available on this machine.';
      console.error(
        '[main] Focused-window query failed — the real app-name feature is disabled, ' +
        'everything else still works normally.\n' +
        '  Reason: ' + err.message + '\n  ' + hint
      );
    }
    return null;
  }
}

// Names that mean "still our own app" and should NOT be reported as a
// switch. 'electron' covers the unpackaged dev-mode process name; the
// second entry adapts automatically to whatever productName the app is
// built with (e.g. "TrueWatch" once packaged via electron-builder), so
// this stays correct after packaging without needing a code change.
function isSelfAppName(name) {
  if (!name) return false;
  const lower = name.toLowerCase();
  return lower === 'electron' || lower === app.getName().toLowerCase();
}

// Invoked (request/response, not fire-and-forget) by the renderer at the
// exact moment a blur/visibilitychange fires. Returns null when the OS
// query fails AND when the freshly-focused window turns out to still be
// our own app — either way, the renderer falls back to its generic
// message rather than naming an app that isn't a real switch.
ipcMain.handle('truewatch:get-focused-app', async () => {
  const info = await getFocusedWindowInfo();
  if (!info) return null;
  if (isSelfAppName(info.appName)) return null;
  return info;
});

// ─── App lifecycle ────────────────────────────────────────────────────

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});