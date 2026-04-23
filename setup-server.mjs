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
