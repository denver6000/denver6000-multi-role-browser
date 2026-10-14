// A dummy multi-role website to test the browser scripts against.
//
// Run:  npm run site            (or: node dummy-site/server.ts)
//       PORT=4000 npm run site  (different port; default 3000)
//
// Accounts (fake, for testing only):
//   admin@test.local / admin123   -> role "admin", can open /admin
//   user@test.local  / user123    -> role "user",  gets 403 on /admin
//
// Pages:
//   GET  /login     login form
//   POST /login     checks the form, sets an HttpOnly "sid" session cookie, redirects to /
//   GET  /          dashboard (redirects to /login if not logged in); writes localStorage/sessionStorage
//   GET  /admin     admin only (403 for other roles)
//   GET  /api/me    the logged-in user as JSON (401 if not logged in); ?delay=ms answers late
//   GET  /profile   profile page; the dashboard's "Open profile" button also renders it in-app
//                   (fetch + history.pushState, no page load), like a single-page app
//   POST /logout    ends the session

import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import crypto from 'node:crypto';

const PORT = Number(process.env.PORT ?? 3000);

type Role = 'admin' | 'user';

type User = {
  email: string;
  password: string;
  name: string;
  role: Role;
};

const USERS: User[] = [
  { email: 'admin@test.local', password: 'admin123', name: 'Ada Admin', role: 'admin' },
  { email: 'user@test.local', password: 'user123', name: 'Uma User', role: 'user' },
];

// Logged-in sessions, kept in memory: session id -> user. Restarting the server logs everyone out.
const sessions = new Map<string, User>();

// ---------------------------------------------------------------- helpers

function html(res: ServerResponse, status: number, title: string, body: string): void {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 640px; margin: 40px auto; padding: 0 16px; }
    label { display: block; margin: 8px 0; }
    input { margin-left: 8px; }
    .hint { color: #666; font-size: 14px; }
  </style>
</head>
<body>
${body}
</body>
</html>`);
}

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function redirect(res: ServerResponse, location: string, headers: Record<string, string> = {}): void {
  res.writeHead(302, { Location: location, ...headers });
  res.end();
}

/** Reads a submitted form body ("email=a%40b&password=x") into URLSearchParams. */
function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  return new Promise(resolve => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk));
    req.on('end', () => resolve(new URLSearchParams(body)));
  });
}

/** Finds the logged-in user from the "sid" cookie. Both are undefined when not logged in. */
function currentUser(req: IncomingMessage): { sid: string | undefined; user: User | undefined } {
  const sid = /(?:^|;\s*)sid=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
  return { sid, user: sid ? sessions.get(sid) : undefined };
}

// ---------------------------------------------------------------- routes

const server = http.createServer(async (req, res) => {
  const method = req.method ?? 'GET';
  const { pathname, searchParams } = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const { sid, user } = currentUser(req);
  console.log(`${new Date().toLocaleTimeString()}  ${method.padEnd(4)} ${req.url}  (${user ? user.email : 'not logged in'})`);

  if (method === 'GET' && pathname === '/login') {
    return html(res, 200, 'Sign in', `
      <h1>Sign in</h1>
      ${searchParams.has('error') ? '<p role="alert" style="color:#c00">Wrong email or password</p>' : ''}
      <form method="post" action="/login">
        <label>Email <input id="email" name="email" type="email" autocomplete="off"></label>
        <label>Password <input id="password" name="password" type="password"></label>
        <button type="submit">Sign in</button>
      </form>
      <p class="hint">Test accounts: admin@test.local / admin123, user@test.local / user123</p>`);
  }

  if (method === 'POST' && pathname === '/login') {
    const form = await readForm(req);
    const found = USERS.find(u => u.email === form.get('email') && u.password === form.get('password'));
    if (!found) return redirect(res, '/login?error=1');
    const newSid = crypto.randomBytes(16).toString('hex');
    sessions.set(newSid, found);
    // HttpOnly: the page's JavaScript can't read this cookie, but Playwright's context.cookies() can.
    return redirect(res, '/', { 'Set-Cookie': `sid=${newSid}; Path=/; HttpOnly; SameSite=Lax` });
  }

  if (method === 'POST' && pathname === '/logout') {
    if (sid) sessions.delete(sid);
    return redirect(res, '/login', { 'Set-Cookie': 'sid=; Path=/; Max-Age=0' });
  }

  if (pathname === '/api/me') {
    // A slow API, so in-app navigation takes long enough for a test to catch a stale snapshot.
    const delay = Math.min(Number(new URL(req.url ?? '/', 'http://x').searchParams.get('delay')) || 0, 5000);
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    return user ? json(res, 200, { name: user.name, email: user.email, role: user.role }) : json(res, 401, { error: 'not logged in' });
  }

  // Everything below needs a logged-in user.
  if (!user) return redirect(res, '/login');

  if (method === 'GET' && pathname === '/') {
    return html(res, 200, 'Dashboard', `
      <h1>Welcome, ${user.name}</h1>
      <p>Role: <strong id="role">${user.role}</strong></p>
      <nav>
        ${user.role === 'admin' ? '<a href="/admin">Admin panel</a>' : '<span class="hint">No admin access</span>'}
      </nav>
      <button type="button" id="open-profile">Open profile</button>
      <form method="post" action="/logout"><button type="submit">Log out</button></form>
      <script>
        // In-app navigation, as single-page apps (React Router, Inertia, ...) do it: fetch data,
        // then swap the content and the URL without loading a new page.
        document.getElementById('open-profile').addEventListener('click', async () => {
          const me = await (await fetch('/api/me?delay=600')).json();
          history.pushState({}, '', '/profile');
          document.title = 'Profile';
          document.body.innerHTML = '<h1>Profile of ' + me.name + '</h1><p>Email: ' + me.email + '</p><a href="/">Back to dashboard</a>';
        });

        // Values for your scripts to read back with page.evaluate().
        localStorage.setItem('lastUser', ${JSON.stringify(user.email)});
        localStorage.setItem('theme', 'dark');
        sessionStorage.setItem('loginTime', new Date().toISOString());
      </script>`);
  }

  if (method === 'GET' && pathname === '/profile') {
    return html(res, 200, 'Profile', `
      <h1>Profile of ${user.name}</h1>
      <p>Email: ${user.email}</p>
      <a href="/">Back to dashboard</a>`);
  }

  if (method === 'GET' && pathname === '/admin') {
    if (user.role !== 'admin') return html(res, 403, 'Forbidden', '<h1>403 Forbidden</h1><p>Admins only.</p><a href="/">Back</a>');
    return html(res, 200, 'Admin panel', `
      <h1>Admin panel</h1>
      <p>Active sessions: ${sessions.size}</p>
      <a href="/">Back to dashboard</a>`);
  }

  html(res, 404, 'Not found', '<h1>404 Not found</h1><a href="/">Home</a>');
});

server.listen(PORT, () => {
  console.log(`Dummy site running at http://localhost:${PORT}`);
  console.log('  admin@test.local / admin123   (admin)');
  console.log('  user@test.local  / user123    (user)');
  console.log('Press Ctrl+C to stop.\n');
});
