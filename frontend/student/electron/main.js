// electron/main.js
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const { execFile } = require('node:child_process');

const isDev = !app.isPackaged;

const DEV_SERVER_URL = 'http://localhost:5173';
const PROD_INDEX_HTML = path.join(__dirname, '..', 'dist', 'index.html');

let mainWindow = null;

let focusQueryWarned = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    title: 'TrueWatch',
    webPreferences: {
     
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

// app switch detection: the renderer can't ask the OS directly, so it asks the main process via IPC. The main process runs the platform-specific query and returns the result, or null if the query fails or the focused window is still our own app.

function execFileAsync(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 3000, ...options }, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout.toString().trim());
    });
  });
}

// macOS
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

// Windows — PowerShell calling the same User32 GetForegroundWindow 
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
 // windows
  return { appName: raw || 'Unknown application', windowTitle: raw || '' };
}

// Linux 
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


function isSelfAppName(name) {
  if (!name) return false;
  const lower = name.toLowerCase();
  return lower === 'electron' || lower === app.getName().toLowerCase();
}


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