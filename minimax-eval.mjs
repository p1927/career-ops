#!/usr/bin/env node
/**
 * minimax-eval.mjs — MiniMax-powered Job Offer Evaluator for career-ops
 *
 * Routes evaluation through the Executor Gateway (OpenAI-compatible API)
 * using MiniMax M2.7. No external API key needed — the sandbox env vars
 * handle routing automatically.
 *
 * Usage:
 *   node minimax-eval.mjs "Paste full JD text here"
 *   node minimax-eval.mjs --file ./jds/my-job.txt
 *
 * Requires (set in sandbox environment):
 *   OPENAI_BASE_URL=http://host.docker.internal:8765/v1
 *   OPENAI_API_KEY=sk-executor-gateway
 *
 * Model: minimax/MiniMax-M2.7 (via executor-gateway)
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// Bootstrap: load .env before anything else
// ---------------------------------------------------------------------------
try {
  const { config } = await import('dotenv');
  config();
} catch {
  // dotenv is optional — fall back to process.env if not installed
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const ROOT = dirname(fileURLToPath(import.meta.url));

const PATHS = {
  shared:   join(ROOT, 'modes', '_shared.md'),
  oferta:   join(ROOT, 'modes', 'oferta.md'),
  evaluate: join(ROOT, '.claude', 'skills', 'career-ops', 'SKILL.md'),
  cv:       join(ROOT, 'cv.md'),
  reports:  join(ROOT, 'reports'),
  tracker:  join(ROOT, 'data', 'applications.md'),
};

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);

if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║       career-ops — MiniMax Evaluator (via Executor Gateway)      ║
╚══════════════════════════════════════════════════════════════════╝

  Evaluate a job offer using MiniMax M2.7 routed through the
  local executor-gateway (OpenAI-compatible API).

  USAGE
    node minimax-eval.mjs "<JD text>"
    node minimax-eval.mjs --file ./jds/my-job.txt
    node minimax-eval.mjs --model minimax/MiniMax-M2.7 "<JD text>"

  OPTIONS
    --file <path>    Read JD from a file instead of inline text
    --model <name>   Model override (default: minimax/MiniMax-M2.7)
    --no-save        Do not save report to reports/ directory
    --help           Show this help

  SETUP (sandbox — already configured)
    The following env vars must be set (already done in openclaw-sandbox):
      OPENAI_BASE_URL=http://host.docker.internal:8765/v1
      OPENAI_API_KEY=sk-executor-gateway

  EXAMPLES
    node minimax-eval.mjs "We are looking for a Senior AI Engineer..."
    node minimax-eval.mjs --file ./jds/openai-swe.txt
`);
  process.exit(0);
}

// Parse flags
let jdText = '';
let modelName = process.env.MINIMAX_MODEL || 'minimax/MiniMax-M2.7';
let saveReport = true;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--file' && args[i + 1]) {
    const filePath = args[++i];
    if (!existsSync(filePath)) {
      console.error(`Error: File not found: ${filePath}`);
      process.exit(1);
    }
    jdText = readFileSync(filePath, 'utf-8').trim();
  } else if (args[i] === '--model' && args[i + 1]) {
    modelName = args[++i];
  } else if (args[i] === '--no-save') {
    saveReport = false;
  } else if (!args[i].startsWith('--')) {
    jdText += (jdText ? '\n' : '') + args[i];
  }
}

if (!jdText) {
  console.error('Error: No Job Description provided. Run with --help for usage.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Validate environment
// ---------------------------------------------------------------------------
const baseUrl = process.env.OPENAI_BASE_URL || 'http://host.docker.internal:8765/v1';
const apiKey  = process.env.OPENAI_API_KEY  || 'sk-executor-gateway';

if (!baseUrl) {
  console.error(`
Error: OPENAI_BASE_URL not set.

   In the openclaw-sandbox this should already be set:
     OPENAI_BASE_URL=http://host.docker.internal:8765/v1
     OPENAI_API_KEY=sk-executor-gateway
`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------
function readFile(path, label) {
  if (!existsSync(path)) {
    console.warn(`Warning: ${label} not found at: ${path}`);
    return `[${label} not found — skipping]`;
  }
  return readFileSync(path, 'utf-8').trim();
}

function nextReportNumber() {
  if (!existsSync(PATHS.reports)) return '001';
  const files = readdirSync(PATHS.reports)
    .filter(f => /^\d{3}-/.test(f))
    .map(f => parseInt(f.slice(0, 3)))
    .filter(n => !isNaN(n));
  if (files.length === 0) return '001';
  return String(Math.max(...files) + 1).padStart(3, '0');
}

// ---------------------------------------------------------------------------
// Load context files
// ---------------------------------------------------------------------------
console.log('\nLoading context files...');

const sharedContext = readFile(PATHS.shared, 'modes/_shared.md');
const ofertaLogic   = readFile(PATHS.oferta, 'modes/oferta.md');
const cvContent     = readFile(PATHS.cv,     'cv.md');

// ---------------------------------------------------------------------------
// Build the system prompt (mirrors the Claude skill router logic)
// ---------------------------------------------------------------------------
const systemPrompt = `You are career-ops, an AI-powered job search assistant.
You evaluate job offers against the user's CV using a structured A-G scoring system.

Your evaluation methodology is defined below. Follow it exactly.

═══════════════════════════════════════════════════════
SYSTEM CONTEXT (_shared.md)
═══════════════════════════════════════════════════════
${sharedContext}

═══════════════════════════════════════════════════════
EVALUATION MODE (oferta.md)
═══════════════════════════════════════════════════════
${ofertaLogic}

═══════════════════════════════════════════════════════
CANDIDATE RESUME (cv.md)
═══════════════════════════════════════════════════════
${cvContent}

═══════════════════════════════════════════════════════
IMPORTANT OPERATING RULES FOR THIS CLI SESSION
═══════════════════════════════════════════════════════
1. You do NOT have access to WebSearch, Playwright, or file writing tools.
   - For Block D (Comp research): provide salary estimates based on your training data, clearly noted as estimates.
   - For Block G (Legitimacy): analyze the JD text only; skip URL/page freshness checks.
   - Post-evaluation file saving is handled by the script, not by you.
2. Generate Blocks A through G in full, in English, unless the JD is in another language.
3. At the very end, output a machine-readable summary block in this exact format:

---SCORE_SUMMARY---
COMPANY: <company name or "Unknown">
ROLE: <role title>
SCORE: <global score as decimal, e.g. 3.8>
ARCHETYPE: <detected archetype>
LEGITIMACY: <High Confidence | Proceed with Caution | Suspicious>
---END_SUMMARY---
`;

// ---------------------------------------------------------------------------
// Call Executor Gateway (OpenAI-compatible API) via fetch
// ---------------------------------------------------------------------------
console.log(`Calling MiniMax (${modelName}) via executor-gateway... this may take 30-60 seconds.\n`);

const endpoint = `${baseUrl.replace(/\/$/, '')}/chat/completions`;

let evaluationText;
try {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelName,
      temperature: 0.4,
      max_tokens: 8192,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: `JOB DESCRIPTION TO EVALUATE:\n\n${jdText}` },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HTTP ${response.status}: ${body}`);
  }

  const data = await response.json();
  evaluationText = data.choices?.[0]?.message?.content;
  if (!evaluationText) {
    throw new Error('Empty response from model — check executor-gateway logs.');
  }
} catch (err) {
  console.error('Executor Gateway error:', err.message);
  if (err.message?.includes('ECONNREFUSED') || err.message?.includes('fetch')) {
    console.error('  Is executor-gateway running at', baseUrl, '?');
    console.error('  On the host: check port 8765.');
  }
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Display evaluation
// ---------------------------------------------------------------------------
console.log('\n' + '═'.repeat(66));
console.log('  CAREER-OPS EVALUATION — powered by MiniMax M2.7');
console.log('═'.repeat(66) + '\n');
console.log(evaluationText);

// ---------------------------------------------------------------------------
// Parse score summary
// ---------------------------------------------------------------------------
const summaryMatch = evaluationText.match(
  /---SCORE_SUMMARY---\s*([\s\S]*?)---END_SUMMARY---/
);

let company    = 'unknown';
let role       = 'unknown';
let score      = '?';
let archetype  = 'unknown';
let legitimacy = 'unknown';

if (summaryMatch) {
  const block = summaryMatch[1];
  const extract = (key) => {
    const m = block.match(new RegExp(`${key}:\\s*(.+)`));
    return m ? m[1].trim() : 'unknown';
  };
  company    = extract('COMPANY');
  role       = extract('ROLE');
  score      = extract('SCORE');
  archetype  = extract('ARCHETYPE');
  legitimacy = extract('LEGITIMACY');
}

// ---------------------------------------------------------------------------
// Save report
// ---------------------------------------------------------------------------
if (saveReport) {
  try {
    if (!existsSync(PATHS.reports)) {
      mkdirSync(PATHS.reports, { recursive: true });
    }

    const num         = nextReportNumber();
    const today       = new Date().toISOString().split('T')[0];
    const companySlug = company.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const filename    = `${num}-${companySlug}-${today}.md`;
    const reportPath  = join(PATHS.reports, filename);

    const reportContent = `# Evaluation: ${company} — ${role}

**Date:** ${today}
**Archetype:** ${archetype}
**Score:** ${score}/5
**Legitimacy:** ${legitimacy}
**PDF:** pending
**Tool:** MiniMax (${modelName}) via executor-gateway

---

${evaluationText.replace(/---SCORE_SUMMARY---[\s\S]*?---END_SUMMARY---/, '').trim()}
`;

    writeFileSync(reportPath, reportContent, 'utf-8');
    console.log(`\nReport saved: reports/${filename}`);

    // Append tracker entry reminder
    console.log(`\nTracker entry (add to data/applications.md):`);
    console.log(`    | ${num} | ${today} | ${company} | ${role} | ${score} | Evaluada | No | [${num}](reports/${filename}) |`);
  } catch (err) {
    console.warn(`Warning: Could not save report: ${err.message}`);
  }
}

console.log('\n' + '─'.repeat(66));
console.log(`  Score: ${score}/5  |  Archetype: ${archetype}  |  Legitimacy: ${legitimacy}`);
console.log('─'.repeat(66) + '\n');
