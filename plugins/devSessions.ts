import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs';
import type { IncomingMessage, ServerResponse } from 'http';
import { dirname } from 'path';
import type { Plugin } from 'vite';

type Options = {
  filePath: string;
};

const ENDPOINT = '/__pxg-dev/sessions';
const SCRIPT_URL = `${ENDPOINT}.js`;
const LINK_QUERY = 'pxg-dev-sessions';
const LINK_STORAGE_KEY = 'pxg-dev-sessions';
const AUTOSAVE_INTERVAL_MS = 3000;
const MAX_BODY_BYTES = 1024 * 1024;
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
// Telegram sessions of every slot and Proxygram sessions, nothing else from `localStorage`
const SESSION_KEY_SOURCE = '^(account\\d+|user_auth|dc|dc\\d+_(auth_key|hash|server_salt)|pxg-session(-\\d+)?)$';
const SESSION_KEY_RE = new RegExp(SESSION_KEY_SOURCE);

// A profile joins only when opened with `?pxg-dev-sessions`: another browser on the same machine stays signed out,
// otherwise two browsers would rotate one-use refresh tokens against each other
const CLIENT_SCRIPT = `(function () {
  if (location.hostname !== 'localhost') return;
  var KEY_RE = new RegExp(${JSON.stringify(SESSION_KEY_SOURCE)});
  var url = new URL(location.href);
  var lastSaved;

  function collect() {
    var data = {};
    Object.keys(localStorage).filter(function (key) { return KEY_RE.test(key); }).sort().forEach(function (key) {
      data[key] = localStorage.getItem(key);
    });
    return data;
  }

  if (url.searchParams.has(${JSON.stringify(LINK_QUERY)})) {
    url.searchParams.delete(${JSON.stringify(LINK_QUERY)});
    history.replaceState(history.state, '', url.toString());
    localStorage.setItem(${JSON.stringify(LINK_STORAGE_KEY)}, '1');
    if (!Object.keys(collect()).length) {
      var request = new XMLHttpRequest();
      request.open('GET', ${JSON.stringify(ENDPOINT)}, false);
      request.send();
      if (request.status === 200) {
        var saved = JSON.parse(request.responseText);
        Object.keys(saved).forEach(function (key) { localStorage.setItem(key, saved[key]); });
        lastSaved = JSON.stringify(collect());
      }
    }
  }

  function save(isLeaving) {
    if (!localStorage.getItem(${JSON.stringify(LINK_STORAGE_KEY)})) return;
    var body = JSON.stringify(collect());
    if (body === lastSaved) return;
    lastSaved = body;
    if (isLeaving) {
      navigator.sendBeacon(${JSON.stringify(ENDPOINT)}, body);
      return;
    }
    fetch(${JSON.stringify(ENDPOINT)}, { method: 'POST', body: body }).catch(function () { lastSaved = undefined; });
  }

  setInterval(save, ${AUTOSAVE_INTERVAL_MS});
  addEventListener('pagehide', function () { save(true); });
})();
`;

/**
 * Development only: keeps sign-ins in a git-ignored file, so a new browser profile does not need a new login.
 * The browser and this plugin exchange the values directly; they never appear in logs or in the page URL.
 */
export default function buildDevSessionsPlugin({ filePath }: Options): Plugin {
  return {
    name: 'pxg-dev-sessions',
    apply: 'serve',
    transformIndexHtml() {
      return [{ tag: 'script', attrs: { src: SCRIPT_URL }, injectTo: 'head-prepend' }];
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0];
        if (path === SCRIPT_URL) {
          res.setHeader('Content-Type', 'text/javascript');
          res.end(CLIENT_SCRIPT);
          return;
        }
        if (path !== ENDPOINT) {
          next();
          return;
        }
        if (!canAccessSessions(req)) {
          res.statusCode = 403;
          res.end();
          return;
        }
        if (req.method === 'GET') {
          respondWithSessions(res, filePath);
          return;
        }
        if (req.method === 'POST') {
          void saveSessions(req, filePath).then(
            () => res.end(),
            () => {
              res.statusCode = 400;
              res.end();
            },
          );
          return;
        }
        res.statusCode = 405;
        res.end();
      });
    },
  };
}

// The dev server listens on every interface and any site can send requests to it
function canAccessSessions(req: IncomingMessage) {
  return LOOPBACK_ADDRESSES.has(req.socket.remoteAddress ?? '')
    && req.headers.host?.split(':')[0] === 'localhost'
    && req.headers['sec-fetch-site'] === 'same-origin';
}

function respondWithSessions(res: ServerResponse, filePath: string) {
  let content = '{}';
  try {
    content = readFileSync(filePath, 'utf8');
  } catch {
    // Nothing is saved yet
  }
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(content);
}

async function saveSessions(req: IncomingMessage, filePath: string) {
  const parsed: unknown = JSON.parse(await readBody(req));
  if (!parsed || typeof parsed !== 'object') throw new Error('Unexpected sessions format');
  const entries = Object.entries(parsed)
    .filter(([key, value]) => SESSION_KEY_RE.test(key) && typeof value === 'string');
  // Signing out of every account also forgets the saved sign-ins
  if (!entries.length) {
    rmSync(filePath, { force: true });
    return;
  }
  mkdirSync(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(Object.fromEntries(entries)));
  renameSync(temporaryPath, filePath);
}

async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error('Sessions are too large');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}
