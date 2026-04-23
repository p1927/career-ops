#!/usr/bin/env node

/**
 * scan.mjs — Zero-token portal scanner
 *
 * Fetches Greenhouse, Ashby, Lever, LinkedIn Jobs (guest API),
 * Remotive, and Wellfound APIs directly, applies title filters
 * from portals.yml, deduplicates against existing history,
 * and appends new offers to pipeline.md + scan-history.tsv.
 *
 * Zero Claude API tokens — pure HTTP + JSON.
 *
 * Usage:
 *   node scan.mjs                  # scan all enabled companies
 *   node scan.mjs --dry-run        # preview without writing files
 *   node scan.mjs --company Cohere # scan a single company
 *
 * Portal types supported:
 *   greenhouse, ashby, lever        — ATS direct APIs (structured)
 *   linkedin                        — LinkedIn jobs guest JSON feed
 *   remotive                        — Remotive remote jobs API
 *   wellfound                       — Wellfound (AngelList) public search
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import yaml from 'js-yaml';
const parseYaml = yaml.load;

// ── Config ──────────────────────────────────────────────────────────

const PORTALS_PATH = 'portals.yml';
const SCAN_HISTORY_PATH = 'data/scan-history.tsv';
const PIPELINE_PATH = 'data/pipeline.md';
const APPLICATIONS_PATH = 'data/applications.md';

// Ensure required directories exist (fresh setup)
mkdirSync('data', { recursive: true });

const CONCURRENCY = 10;
const FETCH_TIMEOUT_MS = 15_000;

// Common browser-like headers to avoid 403s on public feeds
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; career-ops-scanner/1.0)',
  'Accept': 'application/json, text/html, */*',
  'Accept-Language': 'en-US,en;q=0.9',
};

// ── API detection ───────────────────────────────────────────────────

function detectApi(company) {
  // Greenhouse: explicit api field
  if (company.api && company.api.includes('greenhouse')) {
    return { type: 'greenhouse', url: company.api };
  }

  const url = company.careers_url || '';

  // Ashby
  const ashbyMatch = url.match(/jobs\.ashbyhq\.com\/([^/?#]+)/);
  if (ashbyMatch) {
    return {
      type: 'ashby',
      url: `https://api.ashbyhq.com/posting-api/job-board/${ashbyMatch[1]}?includeCompensation=true`,
    };
  }

  // Lever
  const leverMatch = url.match(/jobs\.lever\.co\/([^/?#]+)/);
  if (leverMatch) {
    return {
      type: 'lever',
      url: `https://api.lever.co/v0/postings/${leverMatch[1]}`,
    };
  }

  // Greenhouse EU boards
  const ghEuMatch = url.match(/job-boards(?:\.eu)?\.greenhouse\.io\/([^/?#]+)/);
  if (ghEuMatch && !company.api) {
    return {
      type: 'greenhouse',
      url: `https://boards-api.greenhouse.io/v1/boards/${ghEuMatch[1]}/jobs`,
    };
  }

  // LinkedIn company jobs page → guest JSON feed
  // careers_url: https://www.linkedin.com/company/openai/jobs
  const linkedinMatch = url.match(/linkedin\.com\/company\/([^/?#]+)/);
  if (linkedinMatch) {
    const keywords = encodeURIComponent(company.search_query || company.name);
    const location = encodeURIComponent(company.location || '');
    return {
      type: 'linkedin',
      url: `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${keywords}&location=${location}&f_C=${company.linkedin_company_id || ''}&start=0`,
      companyName: company.name,
    };
  }

  // Wellfound / AngelList
  // careers_url: https://wellfound.com/company/openai/jobs
  const wellfoundMatch = url.match(/wellfound\.com\/company\/([^/?#]+)/);
  if (wellfoundMatch) {
    const role = encodeURIComponent(company.search_query || '');
    return {
      type: 'wellfound',
      url: `https://wellfound.com/jobs/search?jobType=full-time&role=${role}`,
      companySlug: wellfoundMatch[1],
      companyName: company.name,
    };
  }

  // Remotive — used for portal-level entries (search_query required)
  if (url.includes('remotive.com') || company.type === 'remotive') {
    const query = encodeURIComponent(company.search_query || '');
    return {
      type: 'remotive',
      url: `https://remotive.com/api/remote-jobs?search=${query}&limit=50`,
    };
  }

  return null;
}

// ── API parsers ─────────────────────────────────────────────────────

function parseGreenhouse(json, companyName) {
  const jobs = json.jobs || [];
  return jobs.map(j => ({
    title: j.title || '',
    url: j.absolute_url || '',
    company: companyName,
    location: j.location?.name || '',
  }));
}

function parseAshby(json, companyName) {
  const jobs = json.jobs || [];
  return jobs.map(j => ({
    title: j.title || '',
    url: j.jobUrl || '',
    company: companyName,
    location: j.location || '',
  }));
}

function parseLever(json, companyName) {
  if (!Array.isArray(json)) return [];
  return json.map(j => ({
    title: j.text || '',
    url: j.hostedUrl || '',
    company: companyName,
    location: j.categories?.location || '',
  }));
}

/**
 * LinkedIn guest API returns HTML fragments (list items), not JSON.
 * We extract job cards via regex on the HTML response.
 * Note: LinkedIn may return 429/999 on aggressive polling — keep
 * scan intervals reasonable (hourly or less frequent).
 */
function parseLinkedin(html, companyName) {
  if (!html || typeof html !== 'string') return [];
  const jobs = [];
  // Each job card: <a ... href="https://www.linkedin.com/jobs/view/..." ...>title text</a>
  const linkRe = /href="(https:\/\/www\.linkedin\.com\/jobs\/view\/[^"]+)"/g;
  const titleRe = /<h3[^>]*class="[^"]*base-search-card__title[^"]*"[^>]*>\s*([\s\S]*?)\s*<\/h3>/g;
  const locationRe = /<span[^>]*class="[^"]*job-search-card__location[^"]*"[^>]*>\s*([\s\S]*?)\s*<\/span>/g;

  const links = [...html.matchAll(linkRe)].map(m => m[1].split('?')[0]);
  const titles = [...html.matchAll(titleRe)].map(m => m[1].replace(/<[^>]+>/g, '').trim());
  const locations = [...html.matchAll(locationRe)].map(m => m[1].replace(/<[^>]+>/g, '').trim());

  for (let i = 0; i < Math.min(links.length, titles.length); i++) {
    jobs.push({
      title: titles[i] || '',
      url: links[i] || '',
      company: companyName,
      location: locations[i] || '',
    });
  }
  return jobs;
}

/**
 * Wellfound returns HTML — we extract job listings from the page.
 * This is best-effort; their SPA rendering may limit results.
 * Authenticated API would yield better results but requires login.
 */
function parseWellfound(html, companyName) {
  if (!html || typeof html !== 'string') return [];
  const jobs = [];
  // Job links pattern: /jobs/{id}-{slug}
  const re = /href="(\/jobs\/\d+-[^"?]+)"/g;
  const titleRe = /<div[^>]*data-test="StartupResult"[^>]*>[\s\S]*?<a[^>]*href="\/jobs\/[^"]*"[^>]*>([\s\S]*?)<\/a>/g;

  // Simple fallback: extract job URLs and use slug as title
  const seen = new Set();
  for (const m of html.matchAll(re)) {
    const path = m[1];
    if (seen.has(path)) continue;
    seen.add(path);
    const slug = path.replace(/\/jobs\/\d+-/, '').replace(/-/g, ' ');
    jobs.push({
      title: slug,
      url: `https://wellfound.com${path}`,
      company: companyName,
      location: 'Remote',
    });
  }
  return jobs;
}

/**
 * Remotive API returns clean JSON.
 */
function parseRemotive(json, companyName) {
  const jobs = json.jobs || [];
  return jobs.map(j => ({
    title: j.title || '',
    url: j.url || '',
    company: j.company_name || companyName,
    location: j.candidate_required_location || 'Remote',
  }));
}

const PARSERS = {
  greenhouse: parseGreenhouse,
  ashby: parseAshby,
  lever: parseLever,
  linkedin: parseLinkedin,
  wellfound: parseWellfound,
  remotive: parseRemotive,
};

// ── Fetch with timeout ──────────────────────────────────────────────

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: BROWSER_HEADERS,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// ── Title filter ────────────────────────────────────────────────────

function buildTitleFilter(titleFilter) {
  const positive = (titleFilter?.positive || []).map(k => k.toLowerCase());
  const negative = (titleFilter?.negative || []).map(k => k.toLowerCase());

  return (title) => {
    const lower = title.toLowerCase();
    const hasPositive = positive.length === 0 || positive.some(k => lower.includes(k));
    const hasNegative = negative.some(k => lower.includes(k));
    return hasPositive && !hasNegative;
  };
}

// ── Dedup ───────────────────────────────────────────────────────────

function loadSeenUrls() {
  const seen = new Set();

  // scan-history.tsv
  if (existsSync(SCAN_HISTORY_PATH)) {
    const lines = readFileSync(SCAN_HISTORY_PATH, 'utf-8').split('\n');
    for (const line of lines.slice(1)) { // skip header
      const url = line.split('\t')[0];
      if (url) seen.add(url);
    }
  }

  // pipeline.md — extract URLs from checkbox lines
  if (existsSync(PIPELINE_PATH)) {
    const text = readFileSync(PIPELINE_PATH, 'utf-8');
    for (const match of text.matchAll(/- \[[ x]\] (https?:\/\/\S+)/g)) {
      seen.add(match[1]);
    }
  }

  // applications.md — extract URLs from report links and any inline URLs
  if (existsSync(APPLICATIONS_PATH)) {
    const text = readFileSync(APPLICATIONS_PATH, 'utf-8');
    for (const match of text.matchAll(/https?:\/\/[^\s|)]+/g)) {
      seen.add(match[0]);
    }
  }

  return seen;
}

function loadSeenCompanyRoles() {
  const seen = new Set();
  if (existsSync(APPLICATIONS_PATH)) {
    const text = readFileSync(APPLICATIONS_PATH, 'utf-8');
    // Parse markdown table rows: | # | Date | Company | Role | ...
    for (const match of text.matchAll(/\|[^|]+\|[^|]+\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|/g)) {
      const company = match[1].trim().toLowerCase();
      const role = match[2].trim().toLowerCase();
      if (company && role && company !== 'company') {
        seen.add(`${company}::${role}`);
      }
    }
  }
  return seen;
}

// ── Pipeline writer ─────────────────────────────────────────────────

function appendToPipeline(offers) {
  if (offers.length === 0) return;

  let text = readFileSync(PIPELINE_PATH, 'utf-8');

  // Find "## Pendientes" section and append after it
  const marker = '## Pendientes';
  const idx = text.indexOf(marker);
  if (idx === -1) {
    // No Pendientes section — append at end before Procesadas
    const procIdx = text.indexOf('## Procesadas');
    const insertAt = procIdx === -1 ? text.length : procIdx;
    const block = `\n${marker}\n\n` + offers.map(o =>
      `- [ ] ${o.url} | ${o.company} | ${o.title}`
    ).join('\n') + '\n\n';
    text = text.slice(0, insertAt) + block + text.slice(insertAt);
  } else {
    // Find the end of existing Pendientes content (next ## or end)
    const afterMarker = idx + marker.length;
    const nextSection = text.indexOf('\n## ', afterMarker);
    const insertAt = nextSection === -1 ? text.length : nextSection;

    const block = '\n' + offers.map(o =>
      `- [ ] ${o.url} | ${o.company} | ${o.title}`
    ).join('\n') + '\n';
    text = text.slice(0, insertAt) + block + text.slice(insertAt);
  }

  writeFileSync(PIPELINE_PATH, text, 'utf-8');
}

function appendToScanHistory(offers, date) {
  // Ensure file + header exist
  if (!existsSync(SCAN_HISTORY_PATH)) {
    writeFileSync(SCAN_HISTORY_PATH, 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\n', 'utf-8');
  }

  const lines = offers.map(o =>
    `${o.url}\t${date}\t${o.source}\t${o.title}\t${o.company}\tadded`
  ).join('\n') + '\n';

  appendFileSync(SCAN_HISTORY_PATH, lines, 'utf-8');
}

// ── Parallel fetch with concurrency limit ───────────────────────────

async function parallelFetch(tasks, limit) {
  const results = [];
  let i = 0;

  async function next() {
    while (i < tasks.length) {
      const task = tasks[i++];
      results.push(await task());
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => next());
  await Promise.all(workers);
  return results;
}

// ── Portal-level scanning (LinkedIn search queries, Remotive, etc.) ──

async function scanPortalQueries(config, titleFilter, seenUrls, seenCompanyRoles, date, newOffers, errors) {
  const queries = config.portal_queries || [];
  if (queries.length === 0) return;

  console.log(`\nScanning ${queries.length} portal queries (LinkedIn, Remotive, Wellfound)...`);

  for (const q of queries) {
    if (q.enabled === false) continue;

    try {
      let jobs = [];

      if (q.type === 'remotive') {
        const search = encodeURIComponent(q.search_query || '');
        const url = `https://remotive.com/api/remote-jobs?search=${search}&limit=${q.limit || 50}`;
        const json = await fetchJson(url);
        jobs = parseRemotive(json, 'Remotive');
      } else if (q.type === 'linkedin') {
        const keywords = encodeURIComponent(q.search_query || '');
        const location = encodeURIComponent(q.location || '');
        const url = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${keywords}&location=${location}&f_TPR=r86400&start=0`;
        const html = await fetchHtml(url);
        jobs = parseLinkedin(html, 'LinkedIn');
      } else if (q.type === 'wellfound') {
        const role = encodeURIComponent(q.search_query || '');
        const url = `https://wellfound.com/jobs/search?jobType=full-time&role=${role}`;
        const html = await fetchHtml(url);
        jobs = parseWellfound(html, 'Wellfound');
      }

      for (const job of jobs) {
        if (!job.url) continue;
        if (!titleFilter(job.title)) continue;
        if (seenUrls.has(job.url)) continue;
        const key = `${job.company.toLowerCase()}::${job.title.toLowerCase()}`;
        if (seenCompanyRoles.has(key)) continue;

        seenUrls.add(job.url);
        seenCompanyRoles.add(key);
        newOffers.push({ ...job, source: `${q.type}-query` });
      }

      console.log(`  [${q.type}] "${q.search_query}" → ${jobs.length} found`);
    } catch (err) {
      errors.push({ company: `${q.type}:${q.search_query}`, error: err.message });
    }
  }
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const companyFlag = args.indexOf('--company');
  const filterCompany = companyFlag !== -1 ? args[companyFlag + 1]?.toLowerCase() : null;

  // 1. Read portals.yml
  if (!existsSync(PORTALS_PATH)) {
    console.error('Error: portals.yml not found. Run onboarding first.');
    process.exit(1);
  }

  const config = parseYaml(readFileSync(PORTALS_PATH, 'utf-8'));
  const companies = config.tracked_companies || [];
  const titleFilter = buildTitleFilter(config.title_filter);

  // 2. Filter to enabled companies with detectable APIs
  const targets = companies
    .filter(c => c.enabled !== false)
    .filter(c => !filterCompany || c.name.toLowerCase().includes(filterCompany))
    .map(c => ({ ...c, _api: detectApi(c) }))
    .filter(c => c._api !== null);

  const skippedCount = companies.filter(c => c.enabled !== false).length - targets.length;

  console.log(`Scanning ${targets.length} companies via API (${skippedCount} skipped — no API detected)`);
  if (dryRun) console.log('(dry run — no files will be written)\n');

  // 3. Load dedup sets
  const seenUrls = loadSeenUrls();
  const seenCompanyRoles = loadSeenCompanyRoles();

  // 4. Fetch all APIs
  const date = new Date().toISOString().slice(0, 10);
  let totalFound = 0;
  let totalFiltered = 0;
  let totalDupes = 0;
  const newOffers = [];
  const errors = [];

  const tasks = targets.map(company => async () => {
    const { type, url } = company._api;
    try {
      let json;
      // LinkedIn and Wellfound return HTML, not JSON
      if (type === 'linkedin') {
        const html = await fetchHtml(url);
        const jobs = parseLinkedin(html, company.name);
        totalFound += jobs.length;
        for (const job of jobs) {
          if (!titleFilter(job.title)) { totalFiltered++; continue; }
          if (seenUrls.has(job.url)) { totalDupes++; continue; }
          const key = `${job.company.toLowerCase()}::${job.title.toLowerCase()}`;
          if (seenCompanyRoles.has(key)) { totalDupes++; continue; }
          seenUrls.add(job.url);
          seenCompanyRoles.add(key);
          newOffers.push({ ...job, source: 'linkedin-api' });
        }
        return;
      }

      if (type === 'wellfound') {
        const html = await fetchHtml(url);
        const jobs = parseWellfound(html, company.name);
        totalFound += jobs.length;
        for (const job of jobs) {
          if (!titleFilter(job.title)) { totalFiltered++; continue; }
          if (seenUrls.has(job.url)) { totalDupes++; continue; }
          const key = `${job.company.toLowerCase()}::${job.title.toLowerCase()}`;
          if (seenCompanyRoles.has(key)) { totalDupes++; continue; }
          seenUrls.add(job.url);
          seenCompanyRoles.add(key);
          newOffers.push({ ...job, source: 'wellfound-api' });
        }
        return;
      }

      json = await fetchJson(url);
      const jobs = PARSERS[type](json, company.name);
      totalFound += jobs.length;

      for (const job of jobs) {
        if (!titleFilter(job.title)) {
          totalFiltered++;
          continue;
        }
        if (seenUrls.has(job.url)) {
          totalDupes++;
          continue;
        }
        const key = `${job.company.toLowerCase()}::${job.title.toLowerCase()}`;
        if (seenCompanyRoles.has(key)) {
          totalDupes++;
          continue;
        }
        // Mark as seen to avoid intra-scan dupes
        seenUrls.add(job.url);
        seenCompanyRoles.add(key);
        newOffers.push({ ...job, source: `${type}-api` });
      }
    } catch (err) {
      errors.push({ company: company.name, error: err.message });
    }
  });

  await parallelFetch(tasks, CONCURRENCY);

  // 5. Scan portal-level queries (LinkedIn search, Remotive, Wellfound search)
  if (!filterCompany) {
    await scanPortalQueries(config, titleFilter, seenUrls, seenCompanyRoles, date, newOffers, errors);
  }

  // 6. Write results
  if (!dryRun && newOffers.length > 0) {
    appendToPipeline(newOffers);
    appendToScanHistory(newOffers, date);
  }

  // 7. Print summary
  console.log(`\n${'━'.repeat(45)}`);
  console.log(`Portal Scan — ${date}`);
  console.log(`${'━'.repeat(45)}`);
  console.log(`Companies scanned:     ${targets.length}`);
  console.log(`Total jobs found:      ${totalFound}`);
  console.log(`Filtered by title:     ${totalFiltered} removed`);
  console.log(`Duplicates:            ${totalDupes} skipped`);
  console.log(`New offers added:      ${newOffers.length}`);

  if (errors.length > 0) {
    console.log(`\nErrors (${errors.length}):`);
    for (const e of errors) {
      console.log(`  x ${e.company}: ${e.error}`);
    }
  }

  if (newOffers.length > 0) {
    console.log('\nNew offers:');
    for (const o of newOffers) {
      console.log(`  + ${o.company} | ${o.title} | ${o.location || 'N/A'}`);
    }
    if (dryRun) {
      console.log('\n(dry run — run without --dry-run to save results)');
    } else {
      console.log(`\nResults saved to ${PIPELINE_PATH} and ${SCAN_HISTORY_PATH}`);
    }
  }

  console.log(`\n-> Run /career-ops pipeline to evaluate new offers.`);
  console.log('-> Share results and get help: https://discord.gg/8pRpHETxa4');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
