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

app.use(cors({ origin: 'http://localhost:4737' }));
app.use(express.json({ limit: '5mb' }));
app.use(express.static(join(__dirname, 'setup-ui')));

// ── Helpers ────────────────────────────────────────────────────────────────

function readYaml(relPath, fallback = {}) {
  const p = join(ROOT, relPath);
  if (!existsSync(p)) return fallback;
  try { return yaml.load(readFileSync(p, 'utf-8')) || fallback; }
  catch (err) { console.error('[readYaml] parse error in', relPath, err.message); return fallback; }
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
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ error: 'Expected a plain object' });
  }
  writeYaml('config/profile.yml', req.body);
  res.json({ ok: true });
});

app.post('/api/profile/fetch-linkedin', async (req, res) => {
  const { url } = req.body;
  if (!url || !url.includes('linkedin.com')) {
    return res.status(400).json({ error: 'Invalid LinkedIn URL' });
  }
  let browser;
  try {
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
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
      return res.json({ partial: true, blocked: true, linkedinUrl: url });
    }

    const get = async (sel) => {
      try { return (await page.$eval(sel, el => el.textContent?.trim())) || ''; }
      catch { return ''; }
    };
    const getAll = async (sel) => {
      try { return await page.$$eval(sel, els => els.map(e => e.textContent?.trim()).filter(Boolean)); }
      catch { return []; }
    };

    // Selectors verified against live LinkedIn public profile HTML (Apr 2026)
    const name = await get('h1.top-card-layout__title, h1');
    const headline = await get('.top-card-layout__headline');
    // Location: first span inside profile-info-subheader
    const location = await get('.profile-info-subheader span:first-child');
    // Experience: experience-item__title / experience-item__subtitle still valid on public pages
    const positions = await getAll('.experience-item__title');
    const companies = await getAll('.experience-item__subtitle');
    // Skills are behind auth on public pages — return empty array gracefully
    const skills = await getAll('.pv-skill-category-entity__name-text, .base-aside-card__title');

    res.json({
      partial: !name,
      linkedinUrl: url,
      name,
      headline,
      location,
      positions: positions.slice(0, 3).map(s => s.trim()),
      companies: companies.slice(0, 3).map(s => s.trim()),
      skills: skills.slice(0, 10).map(s => s.trim()),
    });
  } catch (err) {
    res.json({ partial: true, linkedinUrl: url, error: err.message });
  } finally {
    await browser?.close();
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


// ── Dashboard static ───────────────────────────────────────────────────────
app.use('/dashboard-ui', express.static(join(ROOT, 'dashboard-ui')));

app.get('/dashboard', (req, res) => {
  res.sendFile(join(ROOT, 'dashboard-ui', 'index.html'));
});

// ── Dashboard helpers ──────────────────────────────────────────────────────

function parseApplicationsMd() {
  const p = join(ROOT, 'data', 'applications.md');
  if (!existsSync(p)) return [];
  const lines = readFileSync(p, 'utf-8').split('\n');
  const rows = lines.filter(l => l.trim().startsWith('|') && !/^[\s|:-]+$/.test(l));
  const results = [];
  for (const row of rows) {
    const cells = row.split('|').map(c => c.trim()).filter((_, i, a) => i > 0 && i < a.length - 1);
    if (cells.length < 9) continue;
    const num = parseInt(cells[0], 10);
    if (isNaN(num)) continue;
    const scoreRaw = cells[5] || '';
    const scoreMatch = scoreRaw.match(/([\d.]+)\s*\/\s*5/);
    const score = scoreMatch ? parseFloat(scoreMatch[1]) : null;
    const hasPDF = cells[6].includes('✅');
    const reportCell = cells[7] || '';
    const reportMatch = reportCell.match(/\[.*?\]\((.*?)\)/);
    const reportPath = reportMatch ? reportMatch[1] : (reportCell.startsWith('reports/') ? reportCell : '');
    results.push({ num, date: cells[1], company: cells[2], role: cells[3], status: cells[4], score, scoreRaw, hasPDF, reportPath, notes: cells[8] || '' });
  }
  return results;
}

function enrichEntry(entry) {
  if (!entry.reportPath) return entry;
  const p = join(ROOT, entry.reportPath);
  if (!existsSync(p)) return entry;
  try {
    const text = readFileSync(p, 'utf-8').split('\n').slice(0, 60).join('\n');
    // Match bold field: **Archetype** value or table cell | **Archetype** | value |
    const getField = (keys) => {
      for (const k of keys) {
        const m1 = text.match(new RegExp('\\*\\*' + k + '\\*\\*[:\\s]+([^\\n|*]+)', 'i'));
        if (m1) return m1[1].trim();
        const m2 = text.match(new RegExp('\\|\\s*\\*\\*' + k + '\\*\\*\\s*\\|\\s*([^|]+)\\|', 'i'));
        if (m2) return m2[1].trim();
      }
      return null;
    };
    entry.archetype = getField(['Archetype', 'Arquetipo']);
    entry.tldr = getField(['TL;DR']);
    entry.remote = getField(['Remote']);
    entry.comp = getField(['Comp', 'Compensaci\\u00f3n']);
  } catch (_) {}
  return entry;
}

// ── GET /api/dashboard/applications ───────────────────────────────────────

app.get('/api/dashboard/applications', (req, res) => {
  try { res.json(parseApplicationsMd().map(enrichEntry)); }
  catch (err) { console.error('[dashboard/applications]', err.message); res.json([]); }
});

// ── GET /api/dashboard/report/:num ────────────────────────────────────────

app.get('/api/dashboard/report/:num', (req, res) => {
  const num = parseInt(req.params.num, 10);
  if (isNaN(num)) return res.status(400).json({ error: 'Invalid num' });
  const apps = parseApplicationsMd();
  const entry = apps.find(a => a.num === num);
  if (!entry || !entry.reportPath) return res.status(404).json({ error: 'Report not found' });
  const p = join(ROOT, entry.reportPath);
  if (!existsSync(p)) return res.status(404).json({ error: 'Report file not found' });
  const markdown = readFileSync(p, 'utf-8');
  const titleMatch = markdown.match(/^#\s+(.+)/m);
  res.json({ markdown, title: titleMatch ? titleMatch[1] : entry.company + ' — ' + entry.role });
});

// ── PATCH /api/dashboard/applications/:num/status ─────────────────────────

app.patch('/api/dashboard/applications/:num/status', (req, res) => {
  const num = parseInt(req.params.num, 10);
  const { status } = req.body;
  if (isNaN(num) || !status) return res.status(400).json({ error: 'Invalid request' });
  const p = join(ROOT, 'data', 'applications.md');
  if (!existsSync(p)) return res.status(404).json({ error: 'applications.md not found' });
  const lines = readFileSync(p, 'utf-8').split('\n');
  let found = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').map(c => c.trim()).filter((_, idx, a) => idx > 0 && idx < a.length - 1);
    if (cells.length >= 5 && parseInt(cells[0], 10) === num) {
      cells[4] = status;
      lines[i] = '| ' + cells.join(' | ') + ' |';
      found = true;
      break;
    }
  }
  if (!found) return res.status(404).json({ error: 'Entry not found' });
  writeFileSync(p, lines.join('\n'), 'utf-8');
  res.json({ ok: true });
});

// ── GET /api/dashboard/metrics ────────────────────────────────────────────

app.get('/api/dashboard/metrics', (req, res) => {
  try {
    const apps = parseApplicationsMd();
    const total = apps.length;
    const byStatus = {};
    let scoreSum = 0, scoreCount = 0, topScore = 0;
    const weekCounts = {};
    for (const a of apps) {
      byStatus[a.status] = (byStatus[a.status] || 0) + 1;
      if (a.score !== null) { scoreSum += a.score; scoreCount++; if (a.score > topScore) topScore = a.score; }
      if (a.date) {
        const d = new Date(a.date);
        if (!isNaN(d)) {
          const jan4 = new Date(d.getFullYear(), 0, 4);
          const sow = new Date(jan4); sow.setDate(jan4.getDate() - (jan4.getDay() || 7) + 1);
          const wn = Math.ceil(((d - sow) / 86400000 + 1) / 7);
          const key = d.getFullYear() + '-W' + String(wn).padStart(2, '0');
          weekCounts[key] = (weekCounts[key] || 0) + 1;
        }
      }
    }
    const skipStatuses = ['Evaluated', 'SKIP', 'Skip', 'Discarded'];
    const applied = Object.entries(byStatus).filter(([k]) => !skipStatuses.includes(k)).reduce((s, [, v]) => s + v, 0);
    const responded = byStatus['Responded'] || 0;
    const interview = byStatus['Interview'] || 0;
    const offer = byStatus['Offer'] || 0;
    const actionable = apps.filter(a => a.score !== null && a.score >= 3.5 && a.status === 'Evaluated').length;
    const scoreBuckets = [
      { label: '≥4.5', count: apps.filter(a => a.score !== null && a.score >= 4.5).length },
      { label: '4.0–4.4', count: apps.filter(a => a.score !== null && a.score >= 4.0 && a.score < 4.5).length },
      { label: '3.5–3.9', count: apps.filter(a => a.score !== null && a.score >= 3.5 && a.score < 4.0).length },
      { label: '3.0–3.4', count: apps.filter(a => a.score !== null && a.score >= 3.0 && a.score < 3.5).length },
      { label: '<3.0', count: apps.filter(a => a.score !== null && a.score < 3.0).length },
    ];
    const now = new Date();
    const weeklyActivity = [];
    for (let w = 7; w >= 0; w--) {
      const d = new Date(now); d.setDate(d.getDate() - w * 7);
      const jan4 = new Date(d.getFullYear(), 0, 4);
      const sow = new Date(jan4); sow.setDate(jan4.getDate() - (jan4.getDay() || 7) + 1);
      const wn = Math.ceil(((d - sow) / 86400000 + 1) / 7);
      const key = d.getFullYear() + '-W' + String(wn).padStart(2, '0');
      weeklyActivity.push({ week: key, count: weekCounts[key] || 0 });
    }
    res.json({ total, byStatus, avgScore: scoreCount ? Math.round(scoreSum / scoreCount * 10) / 10 : 0, topScore, actionable,
      funnel: [
        { label: 'Total', count: total },
        { label: 'Applied', count: applied },
        { label: 'Responded', count: responded },
        { label: 'Interview', count: interview },
        { label: 'Offer', count: offer },
      ],
      scoreBuckets, weeklyActivity,
      responseRate: applied ? Math.round(responded / applied * 100) : 0,
      interviewRate: applied ? Math.round(interview / applied * 100) : 0,
      offerRate: applied ? Math.round(offer / applied * 100) : 0,
    });
  } catch (err) { console.error('[dashboard/metrics]', err.message); res.status(500).json({ error: err.message }); }
});

// ── Start ──────────────────────────────────────────────────────────────────

const BASE_PORT = parseInt(process.env.SETUP_PORT || '4737', 10);
function tryListen(port, attempts = 3) {
  const server = createServer(app);
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && attempts > 1) tryListen(port + 1, attempts - 1);
    else { console.error('Failed to start server:', err.message); process.exit(1); }
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`\n  Career-Ops Setup UI\n  → http://localhost:${port}\n`);
  });
}
tryListen(BASE_PORT);
