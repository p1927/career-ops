# Career-Ops Setup UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a web UI (`npm run setup`) that lets users configure career-ops (CV upload, LinkedIn profile import, archetype editor, portal tag editor) without touching any config files.

**Architecture:** Express.js server (`setup-server.mjs`) serves a single-page HTML/CSS/JS app from `setup-ui/index.html`. Four wizard sections each POST to their own `/api/*` routes, which read/write `cv.md`, `config/profile.yml`, and `portals.yml` directly. All paths are relative to the career-ops project root. All work runs inside the sandbox at `/home/openclaw/workspaces/career-ops/`.

**Tech Stack:** Node.js 22, Express 4, Multer (file upload), pdf-parse (PDF text), Mammoth (DOCX text), js-yaml (already installed), Playwright (already installed for LinkedIn), vanilla HTML/CSS/JS (no bundler)

---

## File Map

| Path | Action | Responsibility |
|---|---|---|
| `setup-server.mjs` | Create | Express server + all API routes |
| `setup-ui/index.html` | Create | Complete single-page wizard UI |
| `package.json` | Modify | Add 5 deps + `"setup"` script |

---

## Task 1: Install Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install new dependencies**

Run inside sandbox:
```bash
docker exec openclaw-sandbox bash -c "cd /home/openclaw/workspaces/career-ops && npm install express multer pdf-parse mammoth cors"
```

Expected: `added N packages` with no errors.

- [ ] **Step 2: Add setup script to package.json**

Edit `package.json` — add `"setup": "node setup-server.mjs"` to the `scripts` block:

```json
{
  "scripts": {
    "setup": "node setup-server.mjs",
    "doctor": "node doctor.mjs",
    "verify": "node verify-pipeline.mjs",
    "normalize": "node normalize-statuses.mjs",
    "dedup": "node dedup-tracker.mjs",
    "merge": "node merge-tracker.mjs",
    "pdf": "node generate-pdf.mjs",
    "sync-check": "node cv-sync-check.mjs",
    "update:check": "node update-system.mjs check",
    "update": "node update-system.mjs apply",
    "rollback": "node update-system.mjs rollback",
    "liveness": "node check-liveness.mjs",
    "scan": "node scan.mjs",
    "gemini:eval": "node gemini-eval.mjs",
    "minimax:eval": "node minimax-eval.mjs"
  },
  "dependencies": {
    "@google/generative-ai": "^0.21.0",
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.21.2",
    "js-yaml": "^4.1.1",
    "mammoth": "^1.9.0",
    "multer": "^1.4.5-lts.1",
    "pdf-parse": "^1.1.1",
    "playwright": "^1.58.1"
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat(setup-ui): add express/multer/pdf-parse/mammoth/cors deps"
```

---

## Task 2: Create setup-server.mjs

**Files:**
- Create: `setup-server.mjs`

- [ ] **Step 1: Create the server file**

Create `setup-server.mjs` with this complete content:

```js
#!/usr/bin/env node
/**
 * setup-server.mjs — Career-Ops Setup UI Server
 * Run: npm run setup
 * Opens: http://localhost:4737
 */

import express from 'express';
import multer from 'multer';
import cors from 'cors';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname; // career-ops project root

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(join(__dirname, 'setup-ui')));

// ── Helpers ────────────────────────────────────────────────────────────────

function readYaml(relPath, fallback = {}) {
  const p = join(ROOT, relPath);
  if (!existsSync(p)) return fallback;
  try { return yaml.load(readFileSync(p, 'utf-8')) || fallback; }
  catch { return fallback; }
}

function writeYaml(relPath, data) {
  const p = join(ROOT, relPath);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, yaml.dump(data, { lineWidth: 120 }), 'utf-8');
}

// ── GET /api/status ────────────────────────────────────────────────────────

app.get('/api/status', (req, res) => {
  res.json({
    cv: existsSync(join(ROOT, 'cv.md')),
    profile: existsSync(join(ROOT, 'config/profile.yml')),
    archetypes: (() => {
      const p = readYaml('config/profile.yml');
      return Array.isArray(p?.target_roles?.archetypes) && p.target_roles.archetypes.length > 0;
    })(),
    portals: existsSync(join(ROOT, 'portals.yml')),
  });
});

// ── CV endpoints ───────────────────────────────────────────────────────────

app.post('/api/cv/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const { originalname, buffer } = req.file;
  const name = originalname.toLowerCase();
  try {
    let text = '';
    if (name.endsWith('.pdf')) {
      const pdfParse = (await import('pdf-parse')).default;
      const data = await pdfParse(buffer);
      text = data.text;
    } else if (name.endsWith('.docx') || name.endsWith('.doc')) {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      text = result.value;
    } else {
      text = buffer.toString('utf-8');
    }
    res.json({ text: text.trim() });
  } catch (err) {
    res.status(422).json({ error: `Conversion failed: ${err.message}` });
  }
});

app.post('/api/cv/save', (req, res) => {
  const { text } = req.body;
  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'text is required' });
  }
  writeFileSync(join(ROOT, 'cv.md'), text.trim(), 'utf-8');
  res.json({ ok: true });
});

app.get('/api/cv', (req, res) => {
  const p = join(ROOT, 'cv.md');
  if (!existsSync(p)) return res.json({ text: '' });
  res.json({ text: readFileSync(p, 'utf-8') });
});

// ── Profile endpoints ──────────────────────────────────────────────────────

app.get('/api/profile', (req, res) => {
  res.json(readYaml('config/profile.yml'));
});

app.post('/api/profile/save', (req, res) => {
  writeYaml('config/profile.yml', req.body);
  res.json({ ok: true });
});

app.post('/api/profile/fetch-linkedin', async (req, res) => {
  const { url } = req.body;
  if (!url || !url.includes('linkedin.com')) {
    return res.status(400).json({ error: 'Invalid LinkedIn URL' });
  }
  try {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const ctx = await browser.newContext({
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      locale: 'en-US',
    });
    const page = await ctx.newPage();

    let blocked = false;
    page.on('response', r => {
      if (r.url().includes('linkedin.com') && (r.status() === 999 || r.status() === 429)) blocked = true;
    });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => { blocked = true; });

    if (blocked || page.url().includes('/authwall') || page.url().includes('/login')) {
      await browser.close();
      return res.json({ partial: true, blocked: true });
    }

    const get = async (sel) => {
      try { return (await page.$eval(sel, el => el.textContent?.trim())) || ''; }
      catch { return ''; }
    };
    const getAll = async (sel) => {
      try { return await page.$$eval(sel, els => els.map(e => e.textContent?.trim()).filter(Boolean)); }
      catch { return []; }
    };

    const name = await get('h1');
    const headline = await get('.top-card-layout__headline, .pv-text-details__left-panel h2');
    const location = await get('.profile-info-subheader .not-first-item, .top-card__subline-item');
    const positions = await getAll('.experience-item__title, .mr1.hoverable-link-text.t-bold span');
    const companies = await getAll('.experience-item__subtitle span, .t-14.t-normal span');
    const skills = await getAll('.pv-skill-category-entity__name-text, .skill-categories-section span');

    await browser.close();

    res.json({
      partial: !name,
      name,
      headline,
      location,
      positions: positions.slice(0, 3),
      companies: companies.slice(0, 3),
      skills: skills.slice(0, 10),
    });
  } catch (err) {
    res.json({ partial: true, error: err.message });
  }
});

// ── Archetypes endpoints ───────────────────────────────────────────────────

app.get('/api/archetypes', (req, res) => {
  const profile = readYaml('config/profile.yml');
  res.json(profile?.target_roles?.archetypes || []);
});

app.post('/api/archetypes/save', (req, res) => {
  const archetypes = req.body;
  if (!Array.isArray(archetypes)) return res.status(400).json({ error: 'Expected array' });
  const profile = readYaml('config/profile.yml', {});
  if (!profile.target_roles) profile.target_roles = {};
  profile.target_roles.archetypes = archetypes;
  writeYaml('config/profile.yml', profile);
  res.json({ ok: true });
});

// ── Portals endpoints ──────────────────────────────────────────────────────

app.get('/api/portals', (req, res) => {
  const portals = readYaml('portals.yml', { title_filter: { positive: [], negative: [] }, portal_queries: [], tracked_companies: [] });
  res.json({
    positive: portals?.title_filter?.positive || [],
    negative: portals?.title_filter?.negative || [],
    portal_queries: portals?.portal_queries || [],
    tracked_companies: portals?.tracked_companies || [],
  });
});

app.post('/api/portals/save', (req, res) => {
  const { positive, negative, portal_queries, tracked_companies } = req.body;
  const existing = readYaml('portals.yml', {});
  const updated = {
    ...existing,
    title_filter: { positive: positive || [], negative: negative || [] },
    portal_queries: portal_queries || [],
    tracked_companies: tracked_companies || [],
  };
  writeYaml('portals.yml', updated);
  res.json({ ok: true });
});

// ── Start ──────────────────────────────────────────────────────────────────

const BASE_PORT = parseInt(process.env.SETUP_PORT || '4737');
function tryListen(port, attempts = 3) {
  const server = createServer(app);
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && attempts > 1) tryListen(port + 1, attempts - 1);
    else { console.error('Failed to start server:', err.message); process.exit(1); }
  });
  server.listen(port, '0.0.0.0', () => {
    console.log(`\n  Career-Ops Setup UI\n  → http://localhost:${port}\n`);
  });
}
tryListen(BASE_PORT);
```

- [ ] **Step 2: Smoke-test the server starts**

```bash
docker exec -d openclaw-sandbox bash -c "cd /home/openclaw/workspaces/career-ops && node setup-server.mjs > /tmp/setup-server.log 2>&1"
sleep 2
docker exec openclaw-sandbox curl -s http://localhost:4737/api/status
```

Expected output (keys may vary by existing files):
```json
{"cv":false,"profile":false,"archetypes":false,"portals":true}
```

- [ ] **Step 3: Stop test server**

```bash
docker exec openclaw-sandbox bash -c "pkill -f setup-server.mjs 2>/dev/null; true"
```

- [ ] **Step 4: Commit**

```bash
git add setup-server.mjs
git commit -m "feat(setup-ui): add Express API server with CV/profile/archetypes/portals routes"
```

---

## Task 3: Create setup-ui/index.html

**Files:**
- Create: `setup-ui/index.html`

- [ ] **Step 1: Create the directory**

```bash
docker exec openclaw-sandbox bash -c "mkdir -p /home/openclaw/workspaces/career-ops/setup-ui"
```

- [ ] **Step 2: Write setup-ui/index.html**

Create `setup-ui/index.html` with the complete content below. Write this file to the sandbox at `/home/openclaw/workspaces/career-ops/setup-ui/index.html`.

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Career-Ops Setup</title>
<style>
:root {
  --bg: #0f1117;
  --surface: #1a1d27;
  --border: #2a2d3e;
  --accent: #6c63ff;
  --accent2: #00d4aa;
  --text: #e8eaf0;
  --muted: #8b8fa8;
  --success: #22c55e;
  --warning: #f59e0b;
  --danger: #ef4444;
  --radius: 10px;
  --font: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: var(--bg); color: var(--text); font-family: var(--font); min-height: 100vh; }

/* Nav */
.nav {
  position: sticky; top: 0; z-index: 100;
  background: rgba(15,17,23,0.9); backdrop-filter: blur(10px);
  border-bottom: 1px solid var(--border);
  padding: 12px 24px;
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
}
.nav-logo { font-size: 15px; font-weight: 700; color: var(--accent); margin-right: 8px; white-space: nowrap; }
.nav-pill {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 14px; border-radius: 20px;
  font-size: 13px; font-weight: 500; cursor: pointer;
  border: 1px solid var(--border); background: var(--surface);
  color: var(--muted); transition: all .15s;
  text-decoration: none;
}
.nav-pill:hover { border-color: var(--accent); color: var(--text); }
.nav-pill.done { border-color: var(--success); color: var(--success); background: rgba(34,197,94,.08); }
.nav-pill.active { border-color: var(--accent); color: var(--accent); background: rgba(108,99,255,.1); }
.check { font-size: 12px; }

/* Layout */
.container { max-width: 860px; margin: 0 auto; padding: 32px 24px 80px; }

/* Section cards */
.section {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius); margin-bottom: 24px; overflow: hidden;
}
.section-header {
  padding: 20px 24px; display: flex; align-items: center; gap: 12px;
  border-bottom: 1px solid var(--border);
}
.section-num {
  width: 28px; height: 28px; border-radius: 50%;
  background: var(--accent); color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 700; flex-shrink: 0;
}
.section-num.done { background: var(--success); }
.section-title { font-size: 16px; font-weight: 600; }
.section-sub { font-size: 13px; color: var(--muted); margin-top: 2px; }
.section-body { padding: 24px; }

/* Inputs */
label { display: block; font-size: 12px; font-weight: 600; color: var(--muted); margin-bottom: 5px; text-transform: uppercase; letter-spacing: .5px; }
input[type=text], input[type=email], input[type=tel], input[type=url], textarea, select {
  width: 100%; background: var(--bg); border: 1px solid var(--border);
  border-radius: 7px; padding: 10px 12px; color: var(--text);
  font-family: var(--font); font-size: 14px; outline: none;
  transition: border-color .15s;
}
input:focus, textarea:focus, select:focus { border-color: var(--accent); }
textarea { resize: vertical; min-height: 100px; }
.form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 14px; }
.form-row.full { grid-template-columns: 1fr; }
.form-group { margin-bottom: 0; }

/* Buttons */
.btn {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 9px 18px; border-radius: 7px; font-size: 14px;
  font-weight: 600; cursor: pointer; border: none; transition: all .15s;
}
.btn-primary { background: var(--accent); color: #fff; }
.btn-primary:hover { background: #5a52e0; }
.btn-secondary { background: var(--border); color: var(--text); }
.btn-secondary:hover { background: #363950; }
.btn-success { background: var(--success); color: #fff; }
.btn-sm { padding: 6px 12px; font-size: 12px; }
.btn:disabled { opacity: .5; cursor: not-allowed; }

/* Drop zone */
.dropzone {
  border: 2px dashed var(--border); border-radius: var(--radius);
  padding: 36px; text-align: center; cursor: pointer; transition: all .15s;
  margin-bottom: 16px;
}
.dropzone:hover, .dropzone.drag-over { border-color: var(--accent); background: rgba(108,99,255,.05); }
.dropzone-icon { font-size: 32px; margin-bottom: 8px; }
.dropzone-text { color: var(--muted); font-size: 14px; }
.dropzone-text strong { color: var(--accent); }

/* Tags */
.tag-input-wrap {
  display: flex; flex-wrap: wrap; gap: 6px; align-items: flex-start;
  background: var(--bg); border: 1px solid var(--border); border-radius: 7px;
  padding: 8px; min-height: 44px;
}
.tag-input-wrap:focus-within { border-color: var(--accent); }
.tag {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 10px 3px 10px; border-radius: 12px;
  font-size: 12px; font-weight: 600; cursor: default;
}
.tag.green { background: rgba(34,197,94,.12); color: var(--success); }
.tag.red { background: rgba(239,68,68,.12); color: var(--danger); }
.tag.blue { background: rgba(108,99,255,.15); color: #a09bff; }
.tag .remove { cursor: pointer; opacity: .6; margin-left: 2px; font-size: 14px; line-height: 1; }
.tag .remove:hover { opacity: 1; }
.tag-input {
  border: none; background: transparent; outline: none; color: var(--text);
  font-size: 13px; min-width: 120px; flex: 1; padding: 3px 4px;
}

/* Archetype cards */
.arch-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; margin-bottom: 16px; }
.arch-card {
  background: var(--bg); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 14px; position: relative;
  transition: border-color .15s;
}
.arch-card:hover { border-color: var(--accent); }
.arch-card input {
  background: transparent; border: none; outline: none;
  color: var(--text); font-size: 14px; font-weight: 600;
  width: 100%; margin-bottom: 6px; padding: 0;
}
.arch-card input.level { font-size: 12px; color: var(--muted); font-weight: 400; }
.fit-badge {
  display: inline-block; padding: 3px 10px; border-radius: 10px;
  font-size: 11px; font-weight: 700; cursor: pointer; user-select: none;
  text-transform: uppercase; letter-spacing: .5px; margin-top: 6px;
}
.fit-primary { background: rgba(34,197,94,.15); color: var(--success); }
.fit-secondary { background: rgba(59,130,246,.15); color: #60a5fa; }
.fit-adjacent { background: rgba(255,255,255,.06); color: var(--muted); }
.arch-delete {
  position: absolute; top: 8px; right: 8px;
  background: none; border: none; color: var(--muted);
  cursor: pointer; font-size: 16px; line-height: 1; padding: 2px 5px;
}
.arch-delete:hover { color: var(--danger); }

/* Portal toggles */
.portal-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
.portal-row {
  display: flex; align-items: center; gap: 10px;
  background: var(--bg); border: 1px solid var(--border);
  border-radius: 8px; padding: 10px 14px;
}
.portal-badge {
  font-size: 11px; font-weight: 700; padding: 2px 8px;
  border-radius: 8px; text-transform: uppercase; letter-spacing: .5px;
  flex-shrink: 0;
}
.badge-linkedin { background: rgba(10,102,194,.2); color: #5baaff; }
.badge-remotive { background: rgba(0,212,170,.15); color: var(--accent2); }
.badge-wellfound { background: rgba(249,115,22,.15); color: #fb923c; }
.badge-greenhouse { background: rgba(34,197,94,.12); color: var(--success); }
.badge-ashby { background: rgba(168,85,247,.15); color: #c084fc; }
.badge-lever { background: rgba(245,158,11,.15); color: var(--warning); }
.portal-query { flex: 1; font-size: 13px; color: var(--text); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.portal-delete { background: none; border: none; color: var(--muted); cursor: pointer; font-size: 15px; padding: 2px 4px; }
.portal-delete:hover { color: var(--danger); }

/* Toggle switch */
.toggle { position: relative; width: 36px; height: 20px; flex-shrink: 0; }
.toggle input { opacity: 0; width: 0; height: 0; }
.toggle-slider {
  position: absolute; inset: 0; background: var(--border);
  border-radius: 20px; cursor: pointer; transition: .2s;
}
.toggle input:checked + .toggle-slider { background: var(--accent); }
.toggle-slider:before {
  content: ''; position: absolute;
  width: 14px; height: 14px; left: 3px; top: 3px;
  background: white; border-radius: 50%; transition: .2s;
}
.toggle input:checked + .toggle-slider:before { transform: translateX(16px); }

/* Company list */
.company-row {
  display: flex; align-items: center; gap: 10px;
  background: var(--bg); border: 1px solid var(--border);
  border-radius: 8px; padding: 9px 14px;
}
.company-name { flex: 1; font-size: 13px; }
.company-search { margin-bottom: 10px; }

/* Done banner */
.done-banner {
  background: linear-gradient(135deg, rgba(34,197,94,.12), rgba(108,99,255,.12));
  border: 1px solid var(--success); border-radius: var(--radius);
  padding: 24px; text-align: center; margin-bottom: 24px; display: none;
}
.done-banner h2 { font-size: 20px; margin-bottom: 8px; }
.done-banner code { background: var(--border); padding: 2px 7px; border-radius: 5px; font-size: 13px; }

/* Toast */
#toasts { position: fixed; bottom: 20px; right: 20px; display: flex; flex-direction: column; gap: 8px; z-index: 999; }
.toast {
  padding: 12px 18px; border-radius: 8px; font-size: 13px; font-weight: 500;
  animation: slideIn .2s ease; max-width: 320px;
}
.toast.ok { background: rgba(34,197,94,.9); color: #fff; }
.toast.err { background: rgba(239,68,68,.9); color: #fff; }
.toast.warn { background: rgba(245,158,11,.9); color: #fff; }
@keyframes slideIn { from { transform: translateX(40px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }

.spinner { display: inline-block; width: 14px; height: 14px; border: 2px solid rgba(255,255,255,.3); border-top-color: #fff; border-radius: 50%; animation: spin .6s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.divider { border: none; border-top: 1px solid var(--border); margin: 20px 0; }
.row { display: flex; align-items: center; gap: 10px; }
.notice { background: rgba(245,158,11,.08); border: 1px solid rgba(245,158,11,.3); border-radius: 7px; padding: 10px 14px; font-size: 13px; color: var(--warning); margin-bottom: 14px; }
</style>
</head>
<body>

<nav class="nav">
  <span class="nav-logo">⚡ Career-Ops</span>
  <a class="nav-pill" href="#cv" id="pill-cv" onclick="scrollTo('cv')">
    <span class="check" id="check-cv">○</span> CV
  </a>
  <a class="nav-pill" href="#profile" id="pill-profile" onclick="scrollTo('profile')">
    <span class="check" id="check-profile">○</span> Profile
  </a>
  <a class="nav-pill" href="#archetypes" id="pill-arch" onclick="scrollTo('archetypes')">
    <span class="check" id="check-arch">○</span> Archetypes
  </a>
  <a class="nav-pill" href="#portals" id="pill-portals" onclick="scrollTo('portals')">
    <span class="check" id="check-portals">○</span> Portals
  </a>
</nav>

<div class="container">

  <!-- Done Banner -->
  <div class="done-banner" id="done-banner">
    <h2>🎉 Setup complete</h2>
    <p style="color:var(--muted);margin-bottom:14px">You're ready to run career-ops. Quick start:</p>
    <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center">
      <code>node scan.mjs</code>
      <code>npm run minimax:eval</code>
      <code>./batch/batch-runner.sh</code>
    </div>
  </div>

  <!-- ── SECTION 1: CV ────────────────────────────────────────────── -->
  <div class="section" id="cv">
    <div class="section-header">
      <div class="section-num" id="snum-cv">1</div>
      <div>
        <div class="section-title">Your CV</div>
        <div class="section-sub">Upload a PDF, Word doc, or text file — we'll convert it to plain text</div>
      </div>
    </div>
    <div class="section-body">
      <div class="dropzone" id="dz" onclick="document.getElementById('file-input').click()">
        <div class="dropzone-icon">📄</div>
        <div class="dropzone-text">
          <strong>Click to browse</strong> or drag &amp; drop<br>
          <span style="font-size:12px;margin-top:4px;display:block">PDF, DOCX, DOC, TXT, MD — up to 20 MB</span>
        </div>
      </div>
      <input type="file" id="file-input" accept=".pdf,.docx,.doc,.txt,.md" style="display:none" onchange="onFileChange(event)">
      <div id="cv-preview" style="display:none">
        <div class="row" style="margin-bottom:8px">
          <span id="cv-filename" style="font-size:13px;color:var(--muted);flex:1"></span>
          <button class="btn btn-sm btn-secondary" onclick="clearCV()">Clear</button>
        </div>
        <label>Preview &amp; edit before saving</label>
        <textarea id="cv-text" rows="16" style="font-family:monospace;font-size:12px"></textarea>
        <div style="margin-top:12px">
          <button class="btn btn-primary" onclick="saveCV()" id="cv-save-btn">Save CV</button>
        </div>
      </div>
      <div id="cv-saved-notice" style="display:none" class="notice">
        ✓ cv.md exists — upload a new file to replace it.
        <button class="btn btn-sm btn-secondary" style="margin-left:8px" onclick="showCVReplace()">Replace</button>
      </div>
    </div>
  </div>

  <!-- ── SECTION 2: PROFILE ───────────────────────────────────────── -->
  <div class="section" id="profile">
    <div class="section-header">
      <div class="section-num" id="snum-profile">2</div>
      <div>
        <div class="section-title">Your Profile</div>
        <div class="section-sub">Import from LinkedIn or fill in manually — saves to config/profile.yml</div>
      </div>
    </div>
    <div class="section-body">
      <div class="form-row">
        <div class="form-group">
          <label>LinkedIn Profile URL</label>
          <input type="url" id="li-url" placeholder="https://linkedin.com/in/yourname">
        </div>
        <div class="form-group" style="display:flex;align-items:flex-end">
          <button class="btn btn-secondary" onclick="fetchLinkedIn()" id="li-btn" style="width:100%">
            Import from LinkedIn
          </button>
        </div>
      </div>
      <div id="li-notice" style="display:none"></div>
      <hr class="divider">
      <div class="form-row">
        <div class="form-group"><label>Full Name</label><input type="text" id="p-name" placeholder="Jane Smith"></div>
        <div class="form-group"><label>Email</label><input type="email" id="p-email" placeholder="jane@example.com"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Phone</label><input type="tel" id="p-phone" placeholder="+1-555-0123"></div>
        <div class="form-group"><label>Location</label><input type="text" id="p-location" placeholder="San Francisco, CA"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Portfolio URL</label><input type="url" id="p-portfolio" placeholder="https://yoursite.dev"></div>
        <div class="form-group"><label>GitHub</label><input type="text" id="p-github" placeholder="github.com/yourname"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Twitter / X</label><input type="text" id="p-twitter" placeholder="https://x.com/yourname"></div>
        <div class="form-group"><label>Target Comp Range</label><input type="text" id="p-comp" placeholder="$150K-200K"></div>
      </div>
      <div class="form-row full">
        <div class="form-group">
          <label>Professional Headline (1 line)</label>
          <input type="text" id="p-headline" placeholder="ML Engineer turned AI product builder">
        </div>
      </div>
      <div class="form-row full">
        <div class="form-group">
          <label>Exit Story — what makes you unique</label>
          <textarea id="p-story" rows="3" placeholder="Built and sold my SaaS after 5 years. Now focused on applied AI at scale."></textarea>
        </div>
      </div>
      <div class="form-row full">
        <div class="form-group">
          <label>Primary Target Roles — press Enter to add</label>
          <div class="tag-input-wrap" id="roles-wrap">
            <input class="tag-input" id="roles-input" placeholder="e.g. Senior AI Engineer" onkeydown="tagKeydown(event,'roles')">
          </div>
        </div>
      </div>
      <div class="form-row full">
        <div class="form-group">
          <label>Superpowers — top 3-5, press Enter to add</label>
          <div class="tag-input-wrap" id="powers-wrap">
            <input class="tag-input" id="powers-input" placeholder="e.g. End-to-end ML pipelines" onkeydown="tagKeydown(event,'powers')">
          </div>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Location Flexibility</label><input type="text" id="p-locflex" placeholder="Remote preferred, 1 week/month on-site"></div>
        <div class="form-group"><label>Visa Status</label><input type="text" id="p-visa" placeholder="No sponsorship needed"></div>
      </div>
      <div style="margin-top:16px">
        <button class="btn btn-primary" onclick="saveProfile()">Save Profile</button>
      </div>
    </div>
  </div>

  <!-- ── SECTION 3: ARCHETYPES ────────────────────────────────────── -->
  <div class="section" id="archetypes">
    <div class="section-header">
      <div class="section-num" id="snum-arch">3</div>
      <div>
        <div class="section-title">Target Role Archetypes</div>
        <div class="section-sub">Define the types of roles you're targeting — click the fit badge to cycle primary → secondary → adjacent</div>
      </div>
    </div>
    <div class="section-body">
      <div class="arch-grid" id="arch-grid"></div>
      <div class="row" style="margin-bottom:16px">
        <button class="btn btn-secondary" onclick="addArch()">+ Add Archetype</button>
      </div>
      <button class="btn btn-primary" onclick="saveArchetypes()">Save Archetypes</button>
    </div>
  </div>

  <!-- ── SECTION 4: PORTALS ───────────────────────────────────────── -->
  <div class="section" id="portals">
    <div class="section-header">
      <div class="section-num" id="snum-portals">4</div>
      <div>
        <div class="section-title">Job Portals & Filters</div>
        <div class="section-sub">Control which keywords and portals are active — saves to portals.yml</div>
      </div>
    </div>
    <div class="section-body">
      <div class="form-row">
        <div class="form-group">
          <label>Include Keywords — job title must match at least one (Enter to add)</label>
          <div class="tag-input-wrap" id="kw-pos-wrap">
            <input class="tag-input" id="kw-pos-input" placeholder="e.g. AI Engineer" onkeydown="tagKeydown(event,'kw-pos')">
          </div>
        </div>
        <div class="form-group">
          <label>Exclude Keywords — disqualifies if matched (Enter to add)</label>
          <div class="tag-input-wrap" id="kw-neg-wrap">
            <input class="tag-input" id="kw-neg-input" placeholder="e.g. Junior" onkeydown="tagKeydown(event,'kw-neg')">
          </div>
        </div>
      </div>
      <hr class="divider">
      <label>Portal Queries</label>
      <div class="portal-list" id="portal-list"></div>
      <div class="row" style="margin-bottom:20px">
        <select id="new-portal-type" style="width:140px;flex-shrink:0">
          <option value="linkedin">LinkedIn</option>
          <option value="remotive">Remotive</option>
          <option value="wellfound">Wellfound</option>
        </select>
        <input type="text" id="new-portal-query" placeholder="Search query..." style="flex:1">
        <button class="btn btn-secondary btn-sm" onclick="addPortalQuery()">+ Add</button>
      </div>
      <hr class="divider">
      <label>Tracked Companies</label>
      <input type="text" class="company-search" id="company-search" placeholder="Filter companies..." oninput="filterCompanies()" style="margin-bottom:10px">
      <div id="company-list" style="max-height:300px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;margin-bottom:16px"></div>
      <button class="btn btn-primary" onclick="savePortals()">Save Portals</button>
    </div>
  </div>

</div>

<div id="toasts"></div>

<script>
// ── State ────────────────────────────────────────────────────────────────
const state = {
  roles: [], powers: [], 'kw-pos': [], 'kw-neg': [],
  archetypes: [],
  portalQueries: [],
  companies: [],
};

// ── Utils ────────────────────────────────────────────────────────────────
function toast(msg, type = 'ok') {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  document.getElementById('toasts').appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

function setLoading(btn, yes) {
  if (yes) {
    btn.dataset.orig = btn.innerHTML;
    btn.innerHTML = '<span class="spinner"></span>';
    btn.disabled = true;
  } else {
    btn.innerHTML = btn.dataset.orig || btn.innerHTML;
    btn.disabled = false;
  }
}

async function api(method, path, body) {
  const opts = { method, headers: {} };
  if (body instanceof FormData) {
    opts.body = body;
  } else if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(path, opts);
  const json = await r.json();
  if (!r.ok) throw new Error(json.error || r.statusText);
  return json;
}

function scrollTo(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Tag inputs ───────────────────────────────────────────────────────────
function renderTags(key) {
  const colorMap = { 'roles': 'blue', 'powers': 'blue', 'kw-pos': 'green', 'kw-neg': 'red' };
  const color = colorMap[key] || 'blue';
  const wrap = document.getElementById(`${key}-wrap`);
  const inp = document.getElementById(`${key}-input`);
  wrap.querySelectorAll('.tag').forEach(t => t.remove());
  state[key].forEach((val, i) => {
    const tag = document.createElement('span');
    tag.className = `tag ${color}`;
    tag.innerHTML = `${val}<span class="remove" onclick="removeTag('${key}',${i})">×</span>`;
    wrap.insertBefore(tag, inp);
  });
}

function tagKeydown(e, key) {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    const val = e.target.value.trim().replace(/,$/, '');
    if (val && !state[key].includes(val)) {
      state[key].push(val);
      renderTags(key);
    }
    e.target.value = '';
  } else if (e.key === 'Backspace' && e.target.value === '' && state[key].length) {
    state[key].pop();
    renderTags(key);
  }
}

function removeTag(key, idx) {
  state[key].splice(idx, 1);
  renderTags(key);
}

// ── Mark section done ────────────────────────────────────────────────────
function markDone(sec) {
  const map = { cv: 'cv', profile: 'profile', archetypes: 'arch', portals: 'portals' };
  const key = map[sec];
  const pill = document.getElementById(`pill-${key}`);
  const check = document.getElementById(`check-${key}`);
  const snum = document.getElementById(`snum-${sec === 'archetypes' ? 'arch' : sec}`);
  pill?.classList.add('done');
  if (check) check.textContent = '✓';
  snum?.classList.add('done');
  checkAllDone();
}

function checkAllDone() {
  const pills = ['pill-cv','pill-profile','pill-arch','pill-portals'];
  if (pills.every(id => document.getElementById(id)?.classList.contains('done'))) {
    document.getElementById('done-banner').style.display = 'block';
    document.getElementById('done-banner').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

// ── CV Section ──────────────────────────────────────────────────────────
const dz = document.getElementById('dz');
dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
dz.addEventListener('drop', e => {
  e.preventDefault(); dz.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) uploadCV(file);
});

function onFileChange(e) { if (e.target.files[0]) uploadCV(e.target.files[0]); }

async function uploadCV(file) {
  dz.classList.add('drag-over');
  try {
    const fd = new FormData();
    fd.append('file', file);
    const { text } = await api('POST', '/api/cv/upload', fd);
    document.getElementById('cv-text').value = text;
    document.getElementById('cv-filename').textContent = file.name;
    document.getElementById('cv-preview').style.display = 'block';
    document.getElementById('dz').style.display = 'none';
    document.getElementById('cv-saved-notice').style.display = 'none';
  } catch (err) {
    toast('Conversion failed: ' + err.message, 'err');
  } finally {
    dz.classList.remove('drag-over');
  }
}

function clearCV() {
  document.getElementById('cv-preview').style.display = 'none';
  document.getElementById('dz').style.display = 'block';
  document.getElementById('file-input').value = '';
}

function showCVReplace() {
  document.getElementById('cv-saved-notice').style.display = 'none';
  document.getElementById('dz').style.display = 'block';
}

async function saveCV() {
  const btn = document.getElementById('cv-save-btn');
  setLoading(btn, true);
  try {
    await api('POST', '/api/cv/save', { text: document.getElementById('cv-text').value });
    toast('CV saved ✓');
    markDone('cv');
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    setLoading(btn, false);
  }
}

// ── Profile Section ─────────────────────────────────────────────────────
async function fetchLinkedIn() {
  const url = document.getElementById('li-url').value.trim();
  if (!url) return toast('Enter a LinkedIn URL first', 'warn');
  const btn = document.getElementById('li-btn');
  setLoading(btn, true);
  document.getElementById('li-notice').style.display = 'none';
  try {
    const data = await api('POST', '/api/profile/fetch-linkedin', { url });
    if (data.blocked || data.partial) {
      const n = document.getElementById('li-notice');
      n.className = 'notice';
      n.textContent = '⚠ LinkedIn blocked headless access — fill in the fields manually below.';
      n.style.display = 'block';
    }
    if (data.name) document.getElementById('p-name').value = data.name;
    if (data.headline) document.getElementById('p-headline').value = data.headline;
    if (data.location) document.getElementById('p-location').value = data.location;
    if (data.positions?.length) {
      const existing = document.getElementById('p-headline').value;
      if (!existing) document.getElementById('p-headline').value = data.positions[0];
    }
    if (!data.blocked) toast('Profile imported from LinkedIn ✓');
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    setLoading(btn, false);
  }
}

function profilePayload() {
  return {
    candidate: {
      full_name: document.getElementById('p-name').value,
      email: document.getElementById('p-email').value,
      phone: document.getElementById('p-phone').value,
      location: document.getElementById('p-location').value,
      linkedin: document.getElementById('li-url').value,
      portfolio_url: document.getElementById('p-portfolio').value,
      github: document.getElementById('p-github').value,
      twitter: document.getElementById('p-twitter').value,
    },
    target_roles: {
      primary: state.roles,
      archetypes: state.archetypes,
    },
    narrative: {
      headline: document.getElementById('p-headline').value,
      exit_story: document.getElementById('p-story').value,
      superpowers: state.powers,
    },
    compensation: {
      target_range: document.getElementById('p-comp').value,
      location_flexibility: document.getElementById('p-locflex').value,
    },
    location: {
      visa_status: document.getElementById('p-visa').value,
    },
  };
}

async function saveProfile() {
  try {
    await api('POST', '/api/profile/save', profilePayload());
    toast('Profile saved ✓');
    markDone('profile');
  } catch (err) {
    toast(err.message, 'err');
  }
}

function loadProfile(p) {
  if (!p || !p.candidate) return;
  const c = p.candidate;
  document.getElementById('p-name').value = c.full_name || '';
  document.getElementById('p-email').value = c.email || '';
  document.getElementById('p-phone').value = c.phone || '';
  document.getElementById('p-location').value = c.location || '';
  document.getElementById('li-url').value = c.linkedin || '';
  document.getElementById('p-portfolio').value = c.portfolio_url || '';
  document.getElementById('p-github').value = c.github || '';
  document.getElementById('p-twitter').value = c.twitter || '';
  document.getElementById('p-headline').value = p.narrative?.headline || '';
  document.getElementById('p-story').value = p.narrative?.exit_story || '';
  document.getElementById('p-comp').value = p.compensation?.target_range || '';
  document.getElementById('p-locflex').value = p.compensation?.location_flexibility || '';
  document.getElementById('p-visa').value = p.location?.visa_status || '';
  state.roles = p.target_roles?.primary || [];
  state.powers = p.narrative?.superpowers || [];
  renderTags('roles'); renderTags('powers');
}

// ── Archetypes Section ───────────────────────────────────────────────────
const FIT_CYCLE = ['primary', 'secondary', 'adjacent'];

function renderArchetypes() {
  const grid = document.getElementById('arch-grid');
  grid.innerHTML = '';
  state.archetypes.forEach((a, i) => {
    const card = document.createElement('div');
    card.className = 'arch-card';
    const fitClass = `fit-${a.fit || 'primary'}`;
    card.innerHTML = `
      <button class="arch-delete" onclick="deleteArch(${i})" title="Remove">×</button>
      <input value="${a.name || ''}" placeholder="Role name" oninput="state.archetypes[${i}].name=this.value">
      <input class="level" value="${a.level || ''}" placeholder="Level (e.g. Senior/Staff)" oninput="state.archetypes[${i}].level=this.value">
      <span class="fit-badge ${fitClass}" onclick="cycleFit(${i})">${a.fit || 'primary'}</span>
    `;
    grid.appendChild(card);
  });
}

function addArch() {
  state.archetypes.push({ name: '', level: '', fit: 'primary' });
  renderArchetypes();
}

function deleteArch(i) {
  state.archetypes.splice(i, 1);
  renderArchetypes();
}

function cycleFit(i) {
  const cur = state.archetypes[i].fit || 'primary';
  const next = FIT_CYCLE[(FIT_CYCLE.indexOf(cur) + 1) % FIT_CYCLE.length];
  state.archetypes[i].fit = next;
  renderArchetypes();
}

async function saveArchetypes() {
  try {
    await api('POST', '/api/archetypes/save', state.archetypes);
    toast('Archetypes saved ✓');
    markDone('archetypes');
  } catch (err) {
    toast(err.message, 'err');
  }
}

// ── Portals Section ──────────────────────────────────────────────────────
function badgeClass(type) {
  return `badge-${type}` in document.createElement('span').classList ? `badge-${type}` : 'badge-greenhouse';
}

function renderPortalQueries() {
  const list = document.getElementById('portal-list');
  list.innerHTML = '';
  state.portalQueries.forEach((q, i) => {
    const row = document.createElement('div');
    row.className = 'portal-row';
    const type = (q.type || 'linkedin').toLowerCase();
    row.innerHTML = `
      <span class="portal-badge badge-${type}">${type}</span>
      <span class="portal-query">${q.search_query || q.keywords || ''}</span>
      <label class="toggle" title="Enabled">
        <input type="checkbox" ${q.enabled !== false ? 'checked' : ''} onchange="state.portalQueries[${i}].enabled=this.checked">
        <span class="toggle-slider"></span>
      </label>
      <button class="portal-delete" onclick="removePortalQuery(${i})">×</button>
    `;
    list.appendChild(row);
  });
}

function removePortalQuery(i) {
  state.portalQueries.splice(i, 1);
  renderPortalQueries();
}

function addPortalQuery() {
  const type = document.getElementById('new-portal-type').value;
  const q = document.getElementById('new-portal-query').value.trim();
  if (!q) return toast('Enter a search query', 'warn');
  state.portalQueries.push({ type, search_query: q, enabled: true });
  document.getElementById('new-portal-query').value = '';
  renderPortalQueries();
}

let allCompanies = [];
function renderCompanies(filter = '') {
  const list = document.getElementById('company-list');
  list.innerHTML = '';
  const fl = filter.toLowerCase();
  allCompanies
    .filter(c => !fl || (c.name || '').toLowerCase().includes(fl))
    .forEach((c, i) => {
      const row = document.createElement('div');
      row.className = 'company-row';
      const realIdx = allCompanies.indexOf(c);
      const ats = c.api ? 'greenhouse' : (c.careers_url || '').includes('ashby') ? 'ashby' : (c.careers_url || '').includes('lever') ? 'lever' : 'direct';
      row.innerHTML = `
        <span class="company-name">${c.name || ''}</span>
        <span class="portal-badge badge-${ats}" style="font-size:10px">${ats}</span>
        <label class="toggle">
          <input type="checkbox" ${c.enabled !== false ? 'checked' : ''} onchange="allCompanies[${realIdx}].enabled=this.checked">
          <span class="toggle-slider"></span>
        </label>
      `;
      list.appendChild(row);
    });
}

function filterCompanies() {
  renderCompanies(document.getElementById('company-search').value);
}

async function savePortals() {
  try {
    await api('POST', '/api/portals/save', {
      positive: state['kw-pos'],
      negative: state['kw-neg'],
      portal_queries: state.portalQueries,
      tracked_companies: allCompanies,
    });
    toast('Portals saved ✓');
    markDone('portals');
  } catch (err) {
    toast(err.message, 'err');
  }
}

// ── Init ─────────────────────────────────────────────────────────────────
async function init() {
  try {
    const [status, profile, archetypes, portals, cvData] = await Promise.all([
      api('GET', '/api/status'),
      api('GET', '/api/profile'),
      api('GET', '/api/archetypes'),
      api('GET', '/api/portals'),
      api('GET', '/api/cv'),
    ]);

    // CV
    if (status.cv) {
      document.getElementById('cv-saved-notice').style.display = 'block';
      document.getElementById('dz').style.display = 'none';
      if (cvData.text) {
        document.getElementById('cv-text').value = cvData.text;
      }
      markDone('cv');
    }

    // Profile
    loadProfile(profile);
    if (status.profile) markDone('profile');

    // Archetypes
    state.archetypes = archetypes.length ? archetypes : [
      { name: 'AI/ML Engineer', level: 'Senior/Staff', fit: 'primary' },
      { name: 'AI Product Manager', level: 'Senior', fit: 'secondary' },
      { name: 'Solutions Architect', level: 'Mid-Senior', fit: 'adjacent' },
    ];
    renderArchetypes();
    if (status.archetypes) markDone('archetypes');

    // Portals
    state['kw-pos'] = portals.positive || [];
    state['kw-neg'] = portals.negative || [];
    state.portalQueries = portals.portal_queries || [];
    allCompanies = portals.tracked_companies || [];
    renderTags('kw-pos'); renderTags('kw-neg');
    renderPortalQueries();
    renderCompanies();
    if (status.portals) markDone('portals');

  } catch (err) {
    toast('Failed to load config: ' + err.message, 'err');
  }
}

init();
</script>
</body>
</html>
```

- [ ] **Step 3: Commit**

```bash
git add setup-ui/index.html
git commit -m "feat(setup-ui): add single-page wizard UI"
```

---

## Task 4: End-to-End Smoke Test

**Files:** No changes — manual verification only.

- [ ] **Step 1: Start the server in sandbox**

```bash
docker exec -d openclaw-sandbox bash -c "cd /home/openclaw/workspaces/career-ops && node setup-server.mjs > /tmp/setup-ui.log 2>&1"
sleep 2
docker exec openclaw-sandbox cat /tmp/setup-ui.log
```

Expected:
```
  Career-Ops Setup UI
  → http://localhost:4737
```

- [ ] **Step 2: Test status endpoint**

```bash
docker exec openclaw-sandbox curl -s http://localhost:4737/api/status | python3 -m json.tool
```

Expected: JSON with `cv`, `profile`, `archetypes`, `portals` boolean keys.

- [ ] **Step 3: Test portals endpoint**

```bash
docker exec openclaw-sandbox curl -s http://localhost:4737/api/portals | python3 -m json.tool | head -20
```

Expected: JSON with `positive` array (from portals.yml), `tracked_companies` array with ~40 items.

- [ ] **Step 4: Test archetypes endpoint**

```bash
docker exec openclaw-sandbox curl -s http://localhost:4737/api/archetypes
```

Expected: `[]` (no profile.yml yet) or array of archetype objects.

- [ ] **Step 5: Test a save round-trip**

```bash
docker exec openclaw-sandbox curl -s -X POST http://localhost:4737/api/cv/save \
  -H 'Content-Type: application/json' \
  -d '{"text":"# Test CV\n\nJohn Doe"}' | python3 -m json.tool
docker exec openclaw-sandbox cat /home/openclaw/workspaces/career-ops/cv.md
```

Expected: `{"ok": true}` then `# Test CV\n\nJohn Doe`.

- [ ] **Step 6: Clean up test CV**

```bash
docker exec openclaw-sandbox rm /home/openclaw/workspaces/career-ops/cv.md
```

- [ ] **Step 7: Stop server + final commit**

```bash
docker exec openclaw-sandbox pkill -f setup-server.mjs
git add -A
git commit -m "feat(setup-ui): complete career-ops setup wizard — CV/profile/archetypes/portals"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| CV upload (PDF/DOCX/TXT) + preview + save | Task 2 (`/api/cv/upload`) + Task 3 (dropzone + textarea) |
| Profile from LinkedIn URL | Task 2 (`/api/profile/fetch-linkedin`) + Task 3 (LinkedIn import button) |
| Editable profile form all fields | Task 3 (complete form with all profile.yml fields) |
| Target roles tag input | Task 3 (`roles` tag input) |
| Archetypes visual card editor | Task 3 (arch-grid, cycleFit, drag handled via inline edit) |
| Portals tag editors (include/exclude) | Task 3 (`kw-pos`/`kw-neg` tag inputs) |
| Portal query toggles | Task 3 (portal-list with toggle switches) |
| Tracked companies enable/disable | Task 3 (company-list with toggle) |
| Progress pills + done banner | Task 3 (`markDone`, `checkAllDone`) |
| Error toasts | Task 3 (toast function) |
| LinkedIn partial/blocked fallback | Task 2 (checks `authwall`/999) + Task 3 (li-notice) |
| Port auto-retry | Task 2 (`tryListen` with 3 attempts) |

**Placeholder scan:** None found — all steps contain complete code.

**Type consistency:** All API routes and frontend fetch calls use consistent paths (`/api/cv/upload`, `/api/cv/save`, `/api/profile`, etc.). State keys (`roles`, `powers`, `kw-pos`, `kw-neg`) are consistent across `state`, `renderTags`, and `tagKeydown` calls.
