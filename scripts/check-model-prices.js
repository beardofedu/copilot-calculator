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

// Maps model ids used in index.html to the model name (and, where
// applicable, pricing tier) used in the official docs table. Both the
// `COPILOT_MODELS` id (e.g. "sonnet5") and, for Anthropic models, the
// matching `ANTHROPIC_MODELS` id (e.g. "sonnet-5") are listed together
// since they should always share the same official price.
const MODEL_MAP = [
  { ids: ['gpt5mini'],            docLabel: 'GPT-5 mini',    tier: 'Default' },
  { ids: ['gpt53codex'],          docLabel: 'GPT-5.3-Codex', tier: 'Default' },
  { ids: ['gpt54'],               docLabel: 'GPT-5.4',       tier: 'Default' },
  { ids: ['gpt54lc'],             docLabel: 'GPT-5.4',       tier: 'Long context' },
  { ids: ['gpt54mini'],           docLabel: 'GPT-5.4 mini',  tier: 'Default' },
  { ids: ['gpt54nano'],           docLabel: 'GPT-5.4 nano',  tier: 'Default' },
  { ids: ['gpt55'],               docLabel: 'GPT-5.5',       tier: 'Default' },
  { ids: ['gpt55lc'],             docLabel: 'GPT-5.5',       tier: 'Long context' },
  { ids: ['gpt56luna'],           docLabel: 'GPT-5.6 Luna',  tier: 'Default' },
  { ids: ['gpt56lunalc'],         docLabel: 'GPT-5.6 Luna',  tier: 'Long context' },
  { ids: ['gpt56sol'],            docLabel: 'GPT-5.6 Sol',   tier: 'Default' },
  { ids: ['gpt56sollc'],          docLabel: 'GPT-5.6 Sol',   tier: 'Long context' },
  { ids: ['gpt56terra'],          docLabel: 'GPT-5.6 Terra', tier: 'Default' },
  { ids: ['gpt56terralc'],        docLabel: 'GPT-5.6 Terra', tier: 'Long context' },

  { ids: ['haiku45', 'haiku-4.5'],       docLabel: 'Claude Haiku 4.5' },
  { ids: ['sonnet4', 'sonnet-4'],        docLabel: 'Claude Sonnet 4' },
  { ids: ['sonnet46', 'sonnet-4.6'],     docLabel: 'Claude Sonnet 4.6' },
  { ids: ['opus47', 'opus-4.7'],         docLabel: 'Claude Opus 4.7' },
  { ids: ['opus48', 'opus-4.8'],         docLabel: 'Claude Opus 4.8' },
  { ids: ['opus48fast', 'opus-4.8-fast'],docLabel: 'Claude Opus 4.8 (fast mode)' },
  { ids: ['opus5', 'opus-5'],            docLabel: 'Claude Opus 5' },
  { ids: ['sonnet5', 'sonnet-5'],        docLabel: 'Claude Sonnet 5' },
  { ids: ['fable5', 'fable-5'],          docLabel: 'Claude Fable 5' },

  { ids: ['gemini35flash'],       docLabel: 'Gemini 3.5 Flash', tier: 'Default' },
  { ids: ['gemini36flash'],       docLabel: 'Gemini 3.6 Flash', tier: 'Default' },

  { ids: ['maicodeflash'],        docLabel: 'MAI-Code-1-Flash' },

  { ids: ['grok45'],              docLabel: 'Grok 4.5', tier: 'Default' },
  { ids: ['grok45lc'],            docLabel: 'Grok 4.5', tier: 'Long context' },

  { ids: ['kimi27'],              docLabel: 'Kimi K2.7 Code' },
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

// Matches the id in a `COPILOT_MODELS` entry (`id: 'gpt5mini'`) or the key
// of an `ANTHROPIC_MODELS` entry (`'sonnet-5': { ... }`), ignoring other
// quoted strings on the line such as `label` values.
const LINE_ID_RE = /(?:\bid:\s*'([^']+)'|^\s*'([^']+)':)/;

const FETCH_TIMEOUT_MS = 15000;

async function main() {
  const res = await fetch(DOCS_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${DOCS_URL}: ${res.status} ${res.statusText}`);
  }
  const markdown = await res.text();
  const docPrices = buildDocPriceIndex(markdown);

  const original = fs.readFileSync(INDEX_PATH, 'utf8');
  const lines = original.split('\n');
  const changes = [];

  for (let i = 0; i < lines.length; i++) {
    const idMatch = lines[i].match(LINE_ID_RE);
    if (!idMatch) continue;

    const idOnLine = idMatch[1] || idMatch[2];
    const entry = ID_TO_ENTRY.get(`'${idOnLine}'`);
    if (!entry) continue;

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

  const updated = lines.join('\n');
  const changed = updated !== original;

  if (changed) {
    fs.writeFileSync(INDEX_PATH, updated);
  }

  const summary = changed
    ? `Updated ${changes.length} price value(s):\n` + changes.map(c => `- ${c}`).join('\n')
    : 'All prices already match the official documentation. No changes needed.';

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
