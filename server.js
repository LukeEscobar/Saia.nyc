const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PASSWORD = process.env.PASSWORD || 'letmein'; // change via env for production
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123'; // admin password

const sessions = new Map(); // sessionId -> {created, admin: bool}

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

function isAdmin(req) {
  const cookies = parseCookies(req);
  const sid = cookies['sid'];
  if (!sid) return false;
  const session = sessions.get(sid);
  return session && session.admin;
}

const server = http.createServer((req, res) => {
  // Add this line at the top of the handler:
  console.log('Incoming request:', req.method, req.url);

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
        let isAdminUser = false;
        if (pass === ADMIN_PASSWORD) {
          isAdminUser = true;
        }
        if (pass === PASSWORD || isAdminUser) {
          const sid = generateSession();
          sessions.set(sid, {created: Date.now(), admin: isAdminUser});
          // set cookie
          res.writeHead(302, {
            'Set-Cookie': `sid=${sid}; HttpOnly; Path=/; Max-Age=86400`,
            'Location': isAdminUser ? '/admin.html' : '/archive'
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

  if (pathname === '/admin.html') {
    if (!isAdmin(req)) {
      res.writeHead(302, {'Location': '/login'});
      res.end();
      return;
    }
    sendFile(res, path.join(__dirname, 'public', 'admin.html'));
    return;
  }

  if (pathname.startsWith('/api/')) {
    // simple API endpoints

    // --- MOVE THIS BLOCK UP ---
    if (pathname === '/api/garments' && req.method === 'POST') {
      console.log('--- POST /api/garments handler reached ---');
      if (!isAdmin(req)) {
        res.writeHead(401, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({error: 'unauthorized'}));
        return;
      }
      let body = '';
      req.on('data', chunk => body += chunk.toString());
      req.on('end', () => {
        try {
          console.log('BODY:', body); // <-- Add this line here
          const garment = JSON.parse(body);
          // Save images as files if they're data URLs
          let imagePath1 = garment.image1;
          let imagePath2 = garment.image2;
          if (garment.imageData1 && garment.imageData1.startsWith('data:image/')) {
            const ext1 = garment.imageData1.substring(11, garment.imageData1.indexOf(';'));
            const base64_1 = garment.imageData1.split(',')[1];
            const filename1 = `uploaded-${Date.now()}-1.${ext1}`;
            const filePath1 = path.join(__dirname, 'public', 'images', filename1);
            fs.writeFileSync(filePath1, Buffer.from(base64_1, 'base64'));
            imagePath1 = `/images/${filename1}`;
          }
          if (garment.imageData2 && garment.imageData2.startsWith('data:image/')) {
            const ext2 = garment.imageData2.substring(11, garment.imageData2.indexOf(';'));
            const base64_2 = garment.imageData2.split(',')[1];
            const filename2 = `uploaded-${Date.now()}-2.${ext2}`;
            const filePath2 = path.join(__dirname, 'public', 'images', filename2);
            fs.writeFileSync(filePath2, Buffer.from(base64_2, 'base64'));
            imagePath2 = `/images/${filename2}`;
          }
          // Load garments.json
          const garmentsFile = path.join(__dirname, 'data', 'garments.json');
          const garments = JSON.parse(fs.readFileSync(garmentsFile, 'utf8'));
          garments.push({
            id: `g${garments.length + 1}`,
            title: garment.title,
            size: garment.size,
            condition: garment.condition,
            description: garment.description,
            image1: imagePath1,
            image2: imagePath2
          });
          fs.writeFileSync(garmentsFile, JSON.stringify(garments, null, 2));
          res.writeHead(200, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({success: true}));
        } catch (err) {
          console.error('Garment add error:', err);
          res.writeHead(400, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({error: err.message || 'invalid data'}));
        }
      });
      return;
    }

    if (pathname === '/api/garments' && req.method === 'DELETE') {
      console.log('--- DELETE /api/garments handler reached ---');
      if (!isAdmin(req)) {
        res.writeHead(401, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({error: 'unauthorized'}));
        return;
      }
      let body = '';
      req.on('data', chunk => body += chunk.toString());
      req.on('end', () => {
        try {
          console.log('DELETE BODY:', body); // <--- Add this
          const { id } = JSON.parse(body);
          console.log('DELETE ID:', id); // <--- Add this
          const garmentsFile = path.join(__dirname, 'data', 'garments.json');
          let garments = JSON.parse(fs.readFileSync(garmentsFile, 'utf8'));
          const idx = garments.findIndex(g => g.id === id);
          if (idx === -1) throw new Error('Garment not found');
          garments.splice(idx, 1);
          fs.writeFileSync(garmentsFile, JSON.stringify(garments, null, 2));
          res.writeHead(200, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({success: true}));
        } catch (err) {
          console.error('Garment delete error:', err);
          res.writeHead(400, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({error: err.message || 'invalid data'}));
        }
      });
      return;
    }

    if (pathname === '/api/garments') {
      if (!isAuthenticated(req)) {
        res.writeHead(401, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({error: 'unauthorized'}));
        return;
      }
      sendFile(res, path.join(__dirname, 'data', 'garments.json'));
      return;
    }

    if (pathname === '/api/garments/order' && req.method === 'POST') {
      if (!isAdmin(req)) {
        res.writeHead(401, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({error: 'unauthorized'}));
        return;
      }
      let body = '';
      req.on('data', chunk => body += chunk.toString());
      req.on('end', () => {
        try {
          const { order } = JSON.parse(body);
          const garmentsFile = path.join(__dirname, 'data', 'garments.json');
          let garments = JSON.parse(fs.readFileSync(garmentsFile, 'utf8'));
          // Reorder garments array to match the new order
          garments = order.map(id => garments.find(g => g.id === id)).filter(Boolean);
          fs.writeFileSync(garmentsFile, JSON.stringify(garments, null, 2));
          res.writeHead(200, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({success: true}));
        } catch (err) {
          console.error('Garment reorder error:', err);
          res.writeHead(400, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({error: err.message || 'invalid data'}));
        }
      });
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
