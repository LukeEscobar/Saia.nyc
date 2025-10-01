const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PASSWORD = process.env.PASSWORD || 'letmein'; // change via env for production

const sessions = new Map(); // sessionId -> {created}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const parts = header.split(';').map(p => p.trim()).filter(Boolean);
  const out = {};
  parts.forEach(p => {
    const idx = p.indexOf('=');
    if (idx > -1) {
      const k = p.slice(0, idx);
      const v = p.slice(idx + 1);
      out[k] = decodeURIComponent(v);
    }
  });
  return out;
}

function sendFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, {'Content-Type': 'text/plain'});
      res.end('Not found');
      return;
    }
    const ct = contentType || getContentType(filePath);
    res.writeHead(200, {'Content-Type': ct});
    res.end(data);
  });
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html': return 'text/html; charset=utf-8';
    case '.js': return 'application/javascript; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.png': return 'image/png';
    case '.jpg': return 'image/jpeg';
    case '.svg': return 'image/svg+xml';
    default: return 'application/octet-stream';
  }
}

function generateSession() {
  return crypto.randomBytes(24).toString('hex');
}

function isAuthenticated(req) {
  const cookies = parseCookies(req);
  const sid = cookies['sid'];
  if (!sid) return false;
  return sessions.has(sid);
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  // static files under /public
  if (pathname === '/' || pathname === '/index.html') {
    sendFile(res, path.join(__dirname, 'public', 'index.html'));
    return;
  }

  if (pathname === '/login') {
    if (req.method === 'GET') {
      sendFile(res, path.join(__dirname, 'public', 'login.html'));
      return;
    }
    if (req.method === 'POST') {
      // collect body
      let body = '';
      req.on('data', chunk => body += chunk.toString());
      req.on('end', () => {
        const params = new URLSearchParams(body);
        const pass = params.get('password') || '';
        if (pass === PASSWORD) {
          const sid = generateSession();
          sessions.set(sid, {created: Date.now()});
          // set cookie
          res.writeHead(302, {
            'Set-Cookie': `sid=${sid}; HttpOnly; Path=/; Max-Age=86400`,
            'Location': '/archive'
          });
          res.end();
        } else {
          // redirect back to login with failure
          res.writeHead(302, {'Location': '/login?failed=1'});
          res.end();
        }
      });
      return;
    }
  }

  if (pathname === '/logout') {
    const cookies = parseCookies(req);
    const sid = cookies['sid'];
    if (sid) sessions.delete(sid);
    res.writeHead(302, {
      'Set-Cookie': 'sid=; Path=/; Max-Age=0',
      'Location': '/'
    });
    res.end();
    return;
  }

  if (pathname === '/archive' || pathname === '/archive.html') {
    if (!isAuthenticated(req)) {
      res.writeHead(302, {'Location': '/login'});
      res.end();
      return;
    }
    sendFile(res, path.join(__dirname, 'public', 'archive.html'));
    return;
  }

  if (pathname.startsWith('/api/')) {
    // simple API endpoints
    if (pathname === '/api/garments') {
      if (!isAuthenticated(req)) {
        res.writeHead(401, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({error: 'unauthorized'}));
        return;
      }
      sendFile(res, path.join(__dirname, 'data', 'garments.json'));
      return;
    }
  }

  // serve other static files from public
  const tryPath = path.join(__dirname, 'public', pathname.replace(/^\//, ''));
  if (fs.existsSync(tryPath) && fs.statSync(tryPath).isFile()) {
    sendFile(res, tryPath);
    return;
  }

  // not found
  res.writeHead(404, {'Content-Type': 'text/plain'});
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}/`);
  console.log('Default password can be set with the PASSWORD environment variable.');
});
