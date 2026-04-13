/**
 * Dev environment startup script.
 * Called automatically by the SessionStart hook in .claude/settings.local.json.
 *
 * What it does (skips each step if already running / done):
 *   1. Start Firebase emulators in the background (if not on :4000)
 *   2. Start Vite frontend dev server in the background (if not on :3000)
 *   3. Wait for emulators to accept connections (up to 60 s)
 *   4. Run seed-all.js (idempotent — safe every session)
 *
 * Exits with code 2 so the asyncRewake hook notifies Claude when done.
 *
 * Run manually: "C:\Program Files\nodejs\node.exe" scripts\startup.js
 */

const { spawnSync, spawn } = require('child_process');
const net  = require('net');
const path = require('path');

const ROOT     = path.join(__dirname, '..');
const NODE     = 'C:/Program Files/nodejs/node.exe';
const FIREBASE = 'C:/Users/Richard Klima/AppData/Roaming/npm/node_modules/firebase-tools/lib/bin/firebase.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Resolve as true if the TCP port accepts a connection within 1 s. */
function isPortOpen(host, port) {
  return new Promise(resolve => {
    const sock = net.connect(port, host);
    sock.setTimeout(1000);
    sock.on('connect', () => { sock.destroy(); resolve(true); });
    sock.on('error',   () => resolve(false));
    sock.on('timeout', () => { sock.destroy(); resolve(false); });
  });
}

/** Poll a port until it opens (or timeout ms elapses). */
async function waitForPort(host, port, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortOpen(host, port)) return true;
    await new Promise(r => setTimeout(r, 2000));
  }
  return false;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const lines = [];

  // 1. Firebase emulators (:4000 = emulator UI, confirms full stack is up)
  if (await isPortOpen('127.0.0.1', 4000)) {
    lines.push('Emulators: already running (:4000)');
  } else {
    spawn(NODE, [FIREBASE, 'emulators:start'], {
      cwd: ROOT,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }).unref();

    const ready = await waitForPort('127.0.0.1', 4000, 60000);
    lines.push(ready
      ? 'Emulators: started (:4000)'
      : 'Emulators: timeout — may still be starting'
    );
  }

  // 2. Vite frontend dev server (:3000)
  if (await isPortOpen('127.0.0.1', 3000)) {
    lines.push('Frontend: already running (:3000)');
  } else {
    // Use cmd /c so npm.cmd resolves on Windows without shell:true quirks
    spawn('cmd', ['/c', 'npm.cmd', 'run', 'dev'], {
      cwd: path.join(ROOT, 'frontend'),
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }).unref();
    lines.push('Frontend: started (:3000)');
  }

  // 3. Seed all collections (idempotent)
  const seed = spawnSync(NODE, [path.join(__dirname, 'seed-all.js')], {
    cwd: ROOT,
    stdio: 'pipe',
    encoding: 'utf8',
    timeout: 120000,
  });

  if (seed.status === 0) {
    lines.push('Seeds: applied');
  } else {
    const errLine = (seed.stderr || seed.stdout || '')
      .split('\n')
      .find(l => /error|fail/i.test(l)) || 'unknown error';
    lines.push('Seeds: failed — ' + errLine.trim());
  }

  // Output the summary — asyncRewake injects this into Claude's context
  console.log(lines.join(' | '));

  // Exit code 2 triggers the asyncRewake notification to Claude
  process.exit(2);
}

main().catch(e => {
  console.error('Startup error:', e.message);
  process.exit(2);
});
