#!/usr/bin/env node
/**
 * Checks the model prices hard-coded in index.html against the official
 * GitHub Copilot "Models and pricing" documentation and updates any values
 * that have drifted out of sync.
 *
 * Usage: node scripts/check-model-prices.js
 *
 * Exits with code 0 whether or not changes were made. Writes a summary of
 * any changes to stdout, and (when running in GitHub Actions) to
 * $GITHUB_OUTPUT as `changed` (true/false) and `summary` (multi-line).
 */

const fs = require('fs');
const path = require('path');

const DOCS_URL = 'https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing.md';
const INDEX_PATH = path.join(__dirname, '..', 'index.html');

// Maps model ids used in COPILOT_MODELS to the model name and pricing tier
// used in the official GitHub Copilot docs table.
const MODEL_MAP = [
  { ids: ['gpt53codex'],          docLabel: 'GPT-5.3-Codex', tier: 'Default' },
  { ids: ['gpt54nano'],           docLabel: 'GPT-5.4 nano',  tier: 'Default' },
  { ids: ['gpt56luna'],           docLabel: 'GPT-5.6 Luna',  tier: 'Default' },
  { ids: ['gpt56lunalc'],         docLabel: 'GPT-5.6 Luna',  tier: 'Long context' },
  { ids: ['gpt56sol'],            docLabel: 'GPT-5.6 Sol',   tier: 'Default' },
  { ids: ['gpt56sollc'],          docLabel: 'GPT-5.6 Sol',   tier: 'Long context' },
  { ids: ['gpt56terra'],          docLabel: 'GPT-5.6 Terra', tier: 'Default' },
  { ids: ['gpt56terralc'],        docLabel: 'GPT-5.6 Terra', tier: 'Long context' },
  { ids: ['gpt6astra'],           docLabel: 'GPT-6 Astra',   tier: 'Default' },
  { ids: ['gpt6astralc'],         docLabel: 'GPT-6 Astra',   tier: 'Long context' },
  { ids: ['gpt6luna'],            docLabel: 'GPT-6 Luna',    tier: 'Default' },
  { ids: ['gpt6lunalc'],          docLabel: 'GPT-6 Luna',    tier: 'Long context' },
  { ids: ['gpt6sol'],             docLabel: 'GPT-6 Sol',     tier: 'Default' },
  { ids: ['gpt6sollc'],           docLabel: 'GPT-6 Sol',     tier: 'Long context' },
  { ids: ['gpt61sol'],            docLabel: 'GPT-6.1 Sol',   tier: 'Default' },
  { ids: ['gpt61sollc'],          docLabel: 'GPT-6.1 Sol',   tier: 'Long context' },

  { ids: ['haiku45'],                    docLabel: 'Claude Haiku 4.5', tier: 'Default' },
  { ids: ['haiku55'],                    docLabel: 'Claude Haiku 5.5', tier: 'Default' },
  { ids: ['haiku55lc'],                  docLabel: 'Claude Haiku 5.5', tier: 'Long context' },
  { ids: ['sonnet4'],                    docLabel: 'Claude Sonnet 4', tier: 'Default' },
  { ids: ['sonnet46'],                  docLabel: 'Claude Sonnet 4.6', tier: 'Default' },
  { ids: ['opus48'],                    docLabel: 'Claude Opus 4.8', tier: 'Default' },
  { ids: ['opus48fast'],                docLabel: 'Claude Opus 4.8 (fast mode) (preview)', tier: 'Default' },
  { ids: ['opus5'],                     docLabel: 'Claude Opus 5', tier: 'Default' },
  { ids: ['opus55'],                    docLabel: 'Claude Opus 5.5', tier: 'Default' },
  { ids: ['sonnet5'],                   docLabel: 'Claude Sonnet 5', tier: 'Default' },
  { ids: ['sonnet55'],                  docLabel: 'Claude Sonnet 5.5', tier: 'Default' },
  { ids: ['fable5'],                    docLabel: 'Claude Fable 5', tier: 'Default' },
  { ids: ['fable51'],                   docLabel: 'Claude Fable 5.1', tier: 'Default' },

  { ids: ['gemini38flash'],      docLabel: 'Gemini 3.8 Flash', tier: 'Default' },
  { ids: ['gemini4argon'],       docLabel: 'Gemini 4 Argon', tier: 'Default' },

  { ids: ['maicode11flash'],     docLabel: 'MAI-Code-1.1-Flash' },

  { ids: ['grok45'],              docLabel: 'Grok 4.5', tier: 'Default' },
  { ids: ['grok45lc'],            docLabel: 'Grok 4.5', tier: 'Long context' },
  { ids: ['grok46'],              docLabel: 'Grok 4.6', tier: 'Default' },
  { ids: ['grok46lc'],            docLabel: 'Grok 4.6', tier: 'Long context' },
  { ids: ['grok47'],              docLabel: 'Grok 4.7', tier: 'Default' },
  { ids: ['grok47lc'],            docLabel: 'Grok 4.7', tier: 'Long context' },

  { ids: ['kimi3'],               docLabel: 'Kimi K3' },
];

// Build a single id -> MODEL_MAP entry lookup for O(1) access per line.
const ID_TO_ENTRY = new Map();
for (const entry of MODEL_MAP) {
  for (const id of entry.ids) {
    ID_TO_ENTRY.set(`'${id}'`, entry);
  }
}

function parseDollar(cell) {
  const trimmed = (cell || '').trim();
  if (!trimmed || /not applicable/i.test(trimmed)) return undefined;
  const n = parseFloat(trimmed.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

// Parses every markdown table in the docs into a flat list of row objects
// keyed by column header (e.g. "Model", "Tier", "Input", ...).
function parseTables(markdown) {
  const lines = markdown.split('\n');
  const rows = [];
  let headers = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) {
      headers = null;
      continue;
    }
    const cells = trimmed.slice(1, trimmed.endsWith('|') ? -1 : undefined).split('|').map(c => c.trim());

    // Separator row, e.g. "| --- | ---: |"
    if (cells.every(c => /^:?-+:?$/.test(c))) continue;

    if (!headers) {
      headers = cells;
      continue;
    }

    // Blank spacer rows used throughout the docs tables.
    if (cells.every(c => c === '')) continue;

    const row = {};
    headers.forEach((h, i) => { row[h] = cells[i] || ''; });
    rows.push(row);
  }

  return rows;
}

function buildDocPriceIndex(markdown) {
  const rows = parseTables(markdown);
  const index = new Map();
  for (const row of rows) {
    const model = (row['Model'] || '').replace(/\[\^[^\]]*\]/g, '').trim();
    if (!model) continue;
    const tier = row['Tier'] || null;
    const key = model + '|' + (tier || '');
    index.set(key, {
      input: parseDollar(row['Input']),
      cachedInput: parseDollar(row['Cached input']),
      cacheWrite: parseDollar(row['Cache write']),
      output: parseDollar(row['Output']),
    });
  }
  return index;
}

function fmtNum(n) {
  // Use 3 decimal places only when needed to represent the value exactly
  // (e.g. 0.025, 0.075); otherwise use the conventional 2 decimal places.
  const rounded1000 = Math.round(n * 1000);
  const needsThreeDecimals = rounded1000 % 10 !== 0;
  return n.toFixed(needsThreeDecimals ? 3 : 2);
}

const PRICE_FIELDS = ['input', 'cachedInput', 'cacheWrite', 'output'];

// Precompute one regex per field since the set of keys is fixed.
const FIELD_REGEXES = new Map(
  PRICE_FIELDS.map(key => [key, new RegExp('(\\b' + key + ':\\s*)([0-9.]+)')])
);

function updateField(line, key, newVal) {
  if (newVal === undefined) return { line, changed: false };
  const re = FIELD_REGEXES.get(key);
  const match = line.match(re);
  if (!match) return { line, changed: false };
  const oldVal = parseFloat(match[2]);
  if (Math.abs(oldVal - newVal) < 1e-9) return { line, changed: false };
  return { line: line.replace(re, `$1${fmtNum(newVal)}`), changed: true, oldVal };
}

// Matches the id in a `COPILOT_MODELS` entry, ignoring quoted strings such
// as `label` values.
const LINE_ID_RE = /(?:\bid:\s*'([^']+)'|^\s*'([^']+)':)/;
const MODEL_BLOCK_START_RE = /^const COPILOT_MODELS = \{/;
const MODEL_BLOCK_END_RE = /^\};/;
const NON_COPILOT_MODEL_IDS = new Set(['auto', 'composer25', 'cursorgrok46']);

const FETCH_TIMEOUT_MS = 15000;

async function main() {
  const res = await fetch(DOCS_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${DOCS_URL}: ${res.status} ${res.statusText}`);
  }
  const markdown = await res.text();
  const docPrices = buildDocPriceIndex(markdown);

  for (const entry of MODEL_MAP) {
    const key = entry.docLabel + '|' + (entry.tier || '');
    if (!docPrices.has(key)) {
      console.warn(`Warning: no match found in official docs for "${entry.docLabel}"${entry.tier ? ` (${entry.tier})` : ''} (ids: ${entry.ids.join(', ')}). This entry was not checked.`);
    }
  }

  const original = fs.readFileSync(INDEX_PATH, 'utf8');
  const lines = original.split('\n');
  const changes = [];
  const warnings = [];
  const appModelIds = new Set();
  let inModelBlock = false;

  for (let i = 0; i < lines.length; i++) {
    if (MODEL_BLOCK_START_RE.test(lines[i])) {
      inModelBlock = true;
      continue;
    }
    if (!inModelBlock) continue;
    if (MODEL_BLOCK_END_RE.test(lines[i])) {
      inModelBlock = false;
      continue;
    }

    const idMatch = lines[i].match(LINE_ID_RE);
    if (!idMatch) continue;

    const idOnLine = idMatch[1] || idMatch[2];
    if (NON_COPILOT_MODEL_IDS.has(idOnLine)) continue;
    appModelIds.add(idOnLine);
    const entry = ID_TO_ENTRY.get(`'${idOnLine}'`);
    if (!entry) {
      warnings.push(`${idOnLine}: no official Copilot price mapping is configured.`);
      continue;
    }

    const key = entry.docLabel + '|' + (entry.tier || '');
    const official = docPrices.get(key);
    if (!official) continue;

    let line = lines[i];
    for (const field of PRICE_FIELDS) {
      const result = updateField(line, field, official[field]);
      line = result.line;
      if (result.changed) {
        changes.push(`${idOnLine}: ${field} ${fmtNum(result.oldVal)} -> ${fmtNum(official[field])}`);
      }
    }
    lines[i] = line;
  }

  for (const entry of MODEL_MAP) {
    if (!docPrices.has(entry.docLabel + '|' + (entry.tier || ''))) {
      warnings.push(`No match found in official docs for "${entry.docLabel}"${entry.tier ? ` (${entry.tier})` : ''} (ids: ${entry.ids.join(', ')}).`);
    }
    for (const id of entry.ids) {
      if (!appModelIds.has(id)) {
        warnings.push(`${id}: configured for price checks but missing from the app's model data.`);
      }
    }
  }

  const updated = lines.join('\n');
  const changed = updated !== original;

  if (changed) {
    fs.writeFileSync(INDEX_PATH, updated);
  }

  const summary = [
    changed
      ? `Updated ${changes.length} price value(s):\n` + changes.map(c => `- ${c}`).join('\n')
      : warnings.length
        ? 'Price check incomplete; no changes were made.'
        : 'All mapped model prices match the official documentation. No changes needed.',
    warnings.length ? `Warnings:\n${warnings.map(w => `- ${w}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');

  console.log(summary);

  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
    const delimiter = 'EOF_SUMMARY';
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `summary<<${delimiter}\n${summary}\n${delimiter}\n`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
