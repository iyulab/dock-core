import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A browser the tests can drive with real input, and nothing else: Chrome (or Edge) started headless, spoken to over the
 * DevTools protocol with Node's own WebSocket, pages served from a local directory. No test dependency is installed.
 */

const repo = fileURLToPath(new URL('../..', import.meta.url));

export function findBrowser(): string | null {
  const fromEnv = process.env['DOCK_BROWSER'];
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const candidates =
    process.platform === 'win32'
      ? [
          'C:/Program Files/Google/Chrome/Application/chrome.exe',
          'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
          'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
          'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
        ]
      : process.platform === 'darwin'
        ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
        : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'];
  return candidates.find((c) => existsSync(c)) ?? null;
}

const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

/** Serves `/dist/*` from a build output directory, `/page/*` from the test pages and `/docs/*` from the repository's docs (the runnable examples). */
function serve(distDir: string): Promise<{ server: Server; origin: string }> {
  const pages = join(repo, 'test', 'pages');
  const docs = join(repo, 'docs');
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const [, area, ...rest] = url.pathname.split('/');
    const base = area === 'dist' ? distDir : area === 'page' ? pages : area === 'docs' ? docs : null;
    const file = base ? normalize(join(base, ...rest)) : null;
    if (!base || !file || !file.startsWith(base + sep) || !existsSync(file)) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, origin: `http://127.0.0.1:${(server.address() as { port: number }).port}` })));
}

export interface Point {
  x: number;
  y: number;
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

export class Page {
  readonly #ws: WebSocket;
  readonly #sessionId: string;
  readonly #browser: Browser;
  readonly #targetId: string;
  readonly errors: string[] = [];

  constructor(browser: Browser, ws: WebSocket, sessionId: string, targetId: string) {
    this.#browser = browser;
    this.#ws = ws;
    this.#sessionId = sessionId;
    this.#targetId = targetId;
  }

  async send<T = unknown>(method: string, params: object = {}): Promise<T> {
    return this.#browser.send<T>(method, params, this.#sessionId);
  }

  /** Evaluates an expression in the page and returns its value (promises are awaited). */
  async eval<T = unknown>(expression: string): Promise<T> {
    const r = await this.send<{ result: { value?: T }; exceptionDetails?: { text: string; exception?: { description?: string } } }>('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(`page error: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}\n${expression}`);
    return r.result.value as T;
  }

  /** Navigates and waits for the document to load and `ready` (a page expression; the test pages set `window.dockReady`) to hold. */
  async goto(url: string, ready = 'window.dockReady === true'): Promise<void> {
    await this.send('Page.navigate', { url });
    for (let i = 0; i < 200; i++) {
      if ((await this.eval<string>('document.readyState').catch(() => '')) === 'complete' && (await this.eval<boolean>(ready).catch(() => false))) return;
      await sleep(25);
    }
    throw new Error(`page did not become ready: ${url}`);
  }

  #pressed = false;

  async move(p: Point): Promise<void> {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: this.#pressed ? 'left' : 'none', buttons: this.#pressed ? 1 : 0 });
  }
  async down(p: Point): Promise<void> {
    this.#pressed = true;
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 });
  }
  async up(p: Point): Promise<void> {
    this.#pressed = false;
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1 });
  }
  async click(p: Point): Promise<void> {
    await this.move(p);
    await this.down(p);
    await this.up(p);
  }
  async wheel(p: Point, deltaY: number): Promise<void> {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: p.x, y: p.y, deltaX: 0, deltaY });
  }
  /** Presses and holds, moving through `via` points, and returns without releasing. */
  async dragTo(from: Point, via: Point[]): Promise<void> {
    await this.move(from);
    await this.down(from);
    for (const p of via) await this.move(p);
  }
  async drag(from: Point, to: Point, steps = 6): Promise<void> {
    const via: Point[] = [];
    for (let i = 1; i <= steps; i++) via.push({ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps });
    await this.dragTo(from, via);
    await this.up(to);
  }
  async press(key: string): Promise<void> {
    const codes: Record<string, number> = { ArrowLeft: 37, ArrowRight: 39, Home: 36, End: 35, Delete: 46, Escape: 27 };
    const base = { key, code: key, windowsVirtualKeyCode: codes[key] ?? 0, nativeVirtualKeyCode: codes[key] ?? 0 };
    await this.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  }

  async screenshot(): Promise<Buffer> {
    const r = await this.send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
    return Buffer.from(r.data, 'base64');
  }

  async close(): Promise<void> {
    await this.#browser.send('Target.closeTarget', { targetId: this.#targetId }).catch(() => undefined);
  }

  get socket(): WebSocket {
    return this.#ws;
  }
}

export class Browser {
  readonly #ws: WebSocket;
  #next = 0;
  readonly #pending = new Map<number, Pending>();
  readonly #listeners: ((method: string, params: Record<string, unknown>, sessionId?: string) => void)[] = [];
  readonly #proc: ChildProcess;
  readonly #profile: string;
  readonly #server: Server;
  readonly origin: string;

  private constructor(ws: WebSocket, proc: ChildProcess, profile: string, server: Server, origin: string) {
    this.#ws = ws;
    this.#proc = proc;
    this.#profile = profile;
    this.#server = server;
    this.origin = origin;
    ws.addEventListener('message', (m) => {
      const msg = JSON.parse(String(m.data)) as { id?: number; result?: unknown; error?: { message: string }; method?: string; params?: Record<string, unknown>; sessionId?: string };
      if (msg.id !== undefined) {
        const p = this.#pending.get(msg.id);
        this.#pending.delete(msg.id);
        if (p) msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
      } else if (msg.method) for (const l of this.#listeners) l(msg.method, msg.params ?? {}, msg.sessionId);
    });
  }

  static async launch(distDir: string): Promise<Browser> {
    const exe = findBrowser();
    if (!exe) throw new Error('no browser found (set DOCK_BROWSER)');
    const profile = mkdtempSync(join(tmpdir(), 'dock-core-browser-'));
    const { server, origin } = await serve(distDir);
    const proc = spawn(exe, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars', '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' });
    const portFile = join(profile, 'DevToolsActivePort');
    let info: string[] | null = null;
    for (let i = 0; i < 200 && !info; i++) {
      if (existsSync(portFile)) {
        const lines = readFileSync(portFile, 'utf8').trim().split('\n');
        if (lines.length >= 2) info = lines;
      }
      if (!info) await sleep(50);
    }
    if (!info) {
      proc.kill();
      throw new Error('the browser did not report its debugging port');
    }
    const ws = new WebSocket(`ws://127.0.0.1:${info[0]}${info[1]}`);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve());
      ws.addEventListener('error', () => reject(new Error('could not connect to the browser')));
    });
    return new Browser(ws, proc, profile, server, origin);
  }

  send<T = unknown>(method: string, params: object = {}, sessionId?: string): Promise<T> {
    const id = ++this.#next;
    return new Promise<T>((resolve, reject) => {
      this.#pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.#ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  async newPage(width = 1400, height = 900): Promise<Page> {
    const { targetId } = await this.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await this.send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true });
    const page = new Page(this, this.#ws, sessionId, targetId);
    this.#listeners.push((method, params, sid) => {
      if (sid !== sessionId) return;
      if (method === 'Runtime.exceptionThrown') page.errors.push(JSON.stringify(params['exceptionDetails']).slice(0, 400));
      if (method === 'Runtime.consoleAPICalled' && params['type'] === 'error') page.errors.push(JSON.stringify(params['args']).slice(0, 400));
    });
    await page.send('Runtime.enable');
    await page.send('Page.enable');
    await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    return page;
  }

  async close(): Promise<void> {
    this.#ws.close();
    this.#proc.kill();
    await new Promise<void>((resolve) => this.#server.close(() => resolve()));
    await sleep(200);
    try {
      rmSync(this.#profile, { recursive: true, force: true });
    } catch {
      /* the profile may still be locked for a moment; the temp directory is cleaned by the OS */
    }
  }
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Emits the library into `outDir` (JavaScript only) so page tests never race the packaging test over `dist/`. */
export function buildInto(outDir: string): void {
  const tsc = join(repo, 'node_modules', 'typescript', 'bin', 'tsc');
  execFileSync(process.execPath, [tsc, '-p', join(repo, 'tsconfig.build.json'), '--outDir', outDir, '--declaration', 'false'], { cwd: repo, stdio: 'pipe' });
}
