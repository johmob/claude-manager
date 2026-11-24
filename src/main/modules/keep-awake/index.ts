// keep-awake: keeps the computer awake and unlocked while on, so agents keep working overnight.
// Two layers: Windows' own sleep blocker (as video players use), and a harmless Shift press every two
// minutes, which resets the idle timer so an idle lock or logout never triggers. The key loop runs in a
// hidden PowerShell that ends by itself when the app's process is gone.
import { powerSaveBlocker } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';

const PRESS_EVERY_SECONDS = 120;

export interface KeepAwake {
  set(on: boolean): void;
}

function startKeyLoop(): ChildProcess {
  const script = [
    '$w = New-Object -ComObject wscript.shell',
    `while (Get-Process -Id ${process.pid} -ErrorAction SilentlyContinue) {`,
    "  $w.SendKeys('+')",
    `  Start-Sleep -Seconds ${PRESS_EVERY_SECONDS}`,
    '}',
  ].join('\n');
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    windowsHide: true,
    stdio: 'ignore',
  });
  child.on('error', () => undefined);
  return child;
}

export function createKeepAwake(): KeepAwake {
  let blocker: number | null = null;
  let keys: ChildProcess | null = null;
  return {
    set(on) {
      if (on && blocker === null) {
        blocker = powerSaveBlocker.start('prevent-display-sleep');
        keys = startKeyLoop();
      }
      if (!on && blocker !== null) {
        powerSaveBlocker.stop(blocker);
        blocker = null;
        keys?.kill();
        keys = null;
      }
    },
  };
}
