#!/usr/bin/env node
/**
 * Checks the third-party competitor seat prices hard-coded in index.html
 * (`THIRD_PARTY_COMPETITORS`) against each vendor's public pricing page and
 * updates any values that have drifted out of sync.
 *
 * This complements scripts/check-model-prices.js, which only checks the
 * GitHub Copilot / Anthropic per-token model prices against GitHub's docs.
 *
 * Usage: node scripts/check-competitor-prices.js
 *
 * Exits with code 0 whether or not changes were made. Writes a summary of
 * any changes to stdout, and (when running in GitHub Actions) to
 * $GITHUB_OUTPUT as `changed` (true/false) and `summary` (multi-line).
 *
 * Each vendor's pricing page is free-form marketing HTML rather than a
 * structured table, so prices are matched heuristically: for each plan we
 * look for the plan's name on the page and then look for a single `$amount`
 * shortly after it. If that isn't found (page layout changed, price isn't
 * a flat per-seat figure, content is client-rendered, etc.) the plan is
 * skipped with a warning rather than guessing, so this script only ever
 * updates values it is reasonably confident about.
 */

const fs = require('fs');
const path = require('path');

const INDEX_PATH = path.join(__dirname, '..', 'index.html');
const FETCH_TIMEOUT_MS = 15000;
const FETCH_RETRIES = 2;
const FETCH_RETRY_DELAY_MS = 2000;
// How far past a plan name's position to look for its price, in characters
// of extracted plain text.
const SEARCH_WINDOW = 300;

const START_RE = /^const THIRD_PARTY_COMPETITORS = \{/;
const END_RE = /^\};/;
const VENDOR_KEY_RE = /^  (\w+): \{/;
const PLAN_LINE_RE = /^(\s*\{\s*value: ')([^']+)(',\s*name: ')([^']+)(',\s*label: ')([^']+)(')/;
const SOURCE_URL_RE = /source: \{ text: '[^']*', url: '([^']+)' \}/;

// Parses the THIRD_PARTY_COMPETITORS block out of index.html into
// { [vendorKey]: { url, plans: [{ lineIndex, value, name, label }] } }.
function parseCompetitors(lines) {
  const vendors = {};
  let inBlock = false;
  let vendorKey = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!inBlock) {
      if (START_RE.test(line)) inBlock = true;
      continue;
    }
    if (END_RE.test(line)) break;

    const vendorMatch = line.match(VENDOR_KEY_RE);
    if (vendorMatch) {
      vendorKey = vendorMatch[1];
      vendors[vendorKey] = { url: null, plans: [] };
      continue;
    }
    if (!vendorKey) continue;

    const planMatch = line.match(PLAN_LINE_RE);
    if (planMatch) {
      vendors[vendorKey].plans.push({
        lineIndex: i,
        value: planMatch[2],
        name: planMatch[4],
        label: planMatch[6],
      });
      continue;
    }

    const sourceMatch = line.match(SOURCE_URL_RE);
    if (sourceMatch) {
      vendors[vendorKey].url = sourceMatch[1];
    }
  }

  return vendors;
}

// Strips a page down to plain, whitespace-collapsed text so plan names and
// nearby prices can be matched with simple string/regex search.
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script\b[^>]*>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style\b[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Finds the single dollar amount that appears shortly after an occurrence of
// the plan name in `text`, e.g. "Teams Standard $40 per user / month" -> "40".
// A plan name can legitimately appear multiple times on a page (nav, table
// of contents, comparison table, pricing card, ...), so every occurrence is
// checked and the first one with a price nearby wins. The search window is
// also cut short at the next occurrence of any of the vendor's *other* plan
// names, so a price that actually belongs to a neighbouring plan can't be
// picked up by mistake. Returns undefined if the name isn't found anywhere,
// or no price appears near any occurrence.
function findPriceNear(text, planName, otherPlanNames) {
  const nameRe = new RegExp(`\\b${escapeRegExp(planName)}\\b`, 'gi');
  const otherNameRe = otherPlanNames.length
    ? new RegExp(`\\b(?:${otherPlanNames.map(escapeRegExp).join('|')})\\b`, 'i')
    : null;

  for (const nameMatch of text.matchAll(nameRe)) {
    const start = nameMatch.index + nameMatch[0].length;
    let window = text.slice(start, start + SEARCH_WINDOW);
    if (otherNameRe) {
      const boundary = window.match(otherNameRe);
      if (boundary) window = window.slice(0, boundary.index);
    }
    const priceMatch = window.match(/\$\s?([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]+)?)/);
    if (priceMatch) return priceMatch[1].replace(/,/g, '');
  }
  return undefined;
}

function updatePlanLine(line, oldValue, newValue) {
  if (newValue === undefined) return { line, changed: false };
  if (parseFloat(newValue) === parseFloat(oldValue)) return { line, changed: false };

  // Both regexes assume `oldValue` appears at most once in each of these two
  // positions on the line, which holds for the current `{ value: '...', ...,
  // label: '... — $...' }` plan line format produced by parseCompetitors().
  // If that format ever changes, these should be revisited.
  const valueRe = new RegExp(`(value: ')${escapeRegExp(oldValue)}(')`);
  const priceRe = new RegExp(`(\\$)${escapeRegExp(oldValue)}(?=\\D|$)`);
  if (!valueRe.test(line) || !priceRe.test(line)) {
    // Only apply the update when both the `value` field and the displayed
    // `$price` can be confidently located and replaced together, so we never
    // leave the two out of sync with each other.
    return { line, changed: false };
  }

  const updated = line
    .replace(valueRe, `$1${newValue}$2`)
    .replace(priceRe, `$1${newValue}`);
  return { line: updated, changed: updated !== line };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchText(url) {
  let lastErr;
  for (let attempt = 0; attempt <= FETCH_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText}`);
      }
      return htmlToText(await res.text());
    } catch (err) {
      lastErr = err;
      if (attempt < FETCH_RETRIES) await sleep(FETCH_RETRY_DELAY_MS);
    }
  }
  throw lastErr;
}

async function main() {
  const original = fs.readFileSync(INDEX_PATH, 'utf8');
  const lines = original.split('\n');
  const vendors = parseCompetitors(lines);

  const changes = [];
  const warnings = [];

  for (const [vendorKey, vendor] of Object.entries(vendors)) {
    if (!vendor.url) {
      warnings.push(`${vendorKey}: no pricing source URL found, skipped.`);
      continue;
    }

    let text;
    try {
      text = await fetchText(vendor.url);
    } catch (err) {
      warnings.push(`${vendorKey}: failed to fetch ${vendor.url} (${err.message}), skipped.`);
      continue;
    }

    for (const plan of vendor.plans) {
      const otherPlanNames = vendor.plans
        .filter(p => p.lineIndex !== plan.lineIndex)
        .map(p => p.name);
      const official = findPriceNear(text, plan.name, otherPlanNames);
      if (official === undefined) {
        warnings.push(`${vendorKey}: could not confidently find a price for "${plan.name}" on ${vendor.url}, skipped.`);
        continue;
      }

      const { line, changed } = updatePlanLine(lines[plan.lineIndex], plan.value, official);
      if (changed) {
        lines[plan.lineIndex] = line;
        changes.push(`${vendorKey} "${plan.name}": $${plan.value} -> $${official}`);
      }
    }
  }

  const updated = lines.join('\n');
  const changed = updated !== original;

  if (changed) {
    fs.writeFileSync(INDEX_PATH, updated);
  }

  const summaryParts = [];
  summaryParts.push(changed
    ? `Updated ${changes.length} competitor price value(s):\n` + changes.map(c => `- ${c}`).join('\n')
    : 'All competitor prices already match their public pricing pages. No changes needed.');
  if (warnings.length) {
    summaryParts.push(`Warnings (please verify manually):\n` + warnings.map(w => `- ${w}`).join('\n'));
  }
  const summary = summaryParts.join('\n\n');

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
