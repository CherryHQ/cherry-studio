/**
 * List available @expo/ui components and modifiers installed in a project.
 *
 * Usage:
 *   node list-components.js <project-path> [--docs]
 *
 *   --docs  Include a one-line JSDoc description per modifier.
 *           Omit (default) for a compact names-only list that consumes fewer tokens.
 *
 * Output goes to stdout. Redirect or capture it to inject into an agent prompt.
 */

'use strict';

import fs from 'node:fs';
import path from 'node:path';

const projectPath = process.argv[2];
const withDocs = process.argv.includes('--docs');

if (!projectPath) {
  console.error('Usage: node list-components.js <project-path> [--docs]');
  process.exit(1);
}

const pkgRoot = path.join(projectPath, 'node_modules', '@expo', 'ui');
if (!fs.existsSync(pkgRoot)) {
  console.error(`@expo/ui not found in ${projectPath}/node_modules`);
  process.exit(1);
}

// Read installed version from package.json
let version = 'unknown';
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8'));
  version = pkg.version || 'unknown';
} catch (_) {}

// ---------------------------------------------------------------------------
// Component extraction — parse `export * from './Name'` in an index.d.ts
// ---------------------------------------------------------------------------
// TypeScript type names that are not components — skip anything matching these suffixes
const TYPE_SUFFIX = /(?:Props|Ref|Handle|Params|Config|Options|Type|Types|Value|Values|Colors|Style|Styles|Event|Events|Alignment|Animation|Spec)$/;

function extractComponents(indexFile) {
  if (!fs.existsSync(indexFile)) return [];
  const src = fs.readFileSync(indexFile, 'utf8');
  const names = [];
  for (const line of src.split('\n')) {
    // export * from './ComponentName'  or  export * from './ComponentName/index'
    const m = line.match(/^export \* from ['"]\.\/([^/'"]+)/);
    if (m) {
      const name = m[1];
      // Skip non-component re-exports (types, utils, state internals)
      if (/^(types|utils|index|State|hooks|colors|layout-types|MaterialSymbols)/.test(name)) continue;
      if (TYPE_SUFFIX.test(name)) continue;
      names.push(name);
    }
    // export { Name, ... } from './Something'  — pick up named re-exports too
    const n = line.match(/^export \{([^}]+)\}/);
    if (n) {
      for (const part of n[1].split(',')) {
        // Skip `type Foo` re-exports
        if (/^\s*type\s/.test(part)) continue;
        const id = part.trim().split(/\s+as\s+/)[0].trim();
        if (id && /^[A-Z]/.test(id) && !TYPE_SUFFIX.test(id)) names.push(id);
      }
    }
  }
  return [...new Set(names)].sort();
}

// ---------------------------------------------------------------------------
// Modifier extraction — parse `export declare const/function <name>` in
// a flat modifiers/index.d.ts, optionally with the preceding JSDoc summary.
// ---------------------------------------------------------------------------
function extractModifiers(modifiersFile) {
  if (!fs.existsSync(modifiersFile)) return [];
  const src = fs.readFileSync(modifiersFile, 'utf8');
  const lines = src.split('\n');
  const results = [];
  const seen = new Set();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^export declare (?:const|function) ([a-zA-Z_][a-zA-Z0-9_]*)/);
    if (!m) continue;
    const name = m[1];
    // Skip type-only helpers and internal symbols
    if (/^(is|filter|create|type|export)/.test(name) && name !== 'frame') continue;
    if (seen.has(name)) continue;
    seen.add(name);

    if (!withDocs) {
      results.push({ name });
      continue;
    }

    // Find /** that opens the JSDoc block immediately preceding this export,
    // then scan forward through the block for the first plain-prose summary.
    let jsdocStart = -1;
    for (let j = i - 1; j >= 0; j--) {
      const jl = lines[j].trim();
      if (jl === '/**') { jsdocStart = j; break; }
      if (jl !== '' && jl !== '*/' && !jl.startsWith('*')) break;
    }

    let summary = '';
    let deprecated = false;
    if (jsdocStart >= 0) {
      let inCodeBlock = false;
      for (let k = jsdocStart + 1; k < i; k++) {
        const kl = lines[k].trim();
        if (kl.startsWith('* ```')) { inCodeBlock = !inCodeBlock; continue; }
        if (inCodeBlock) continue;
        // Check @deprecated anywhere in the block (may appear after @param)
        if (kl.startsWith('* @deprecated')) { deprecated = true; continue; }
        // Extract summary from opening prose only — stop at first non-deprecated tag
        if (!summary) {
          if (kl.startsWith('* @')) continue; // skip tags while looking for prose
          if (kl === '*/' || kl === '/**' || kl === '*') continue;
          if (kl.startsWith('* ')) {
            const text = kl.slice(2).trim();
            if (!text.startsWith('-') && !text.startsWith('<')) {
              summary = text.replace(/\.$/, '');
            }
          }
        }
      }
    }
    results.push({ name, summary, deprecated });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------
function formatNames(names) {
  return names.join(', ');
}

function formatModifiers(mods) {
  if (!withDocs) return mods.map(m => m.name).join(', ');
  const lines = [];
  for (const m of mods) {
    const dep = m.deprecated ? ' [deprecated]' : '';
    const desc = m.summary ? `  — ${m.summary}` : '';
    lines.push(`  ${m.name}${dep}${desc}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const buildRoot = path.join(pkgRoot, 'build');

// Universal
const universalComponents = extractComponents(path.join(buildRoot, 'universal', 'index.d.ts'));

// Swift-UI (iOS only)
const swiftuiComponents = extractComponents(path.join(buildRoot, 'swift-ui', 'index.d.ts'));
const swiftuiModifiers = extractModifiers(path.join(buildRoot, 'swift-ui', 'modifiers', 'index.d.ts'));

// Jetpack Compose (Android only)
const composeComponents = extractComponents(path.join(buildRoot, 'jetpack-compose', 'index.d.ts'));
const composeModifiers = extractModifiers(path.join(buildRoot, 'jetpack-compose', 'modifiers', 'index.d.ts'));

const docsNote = withDocs ? ' (with descriptions)' : ' (names only — run with --docs for descriptions)';
console.log(`@expo/ui ${version}${docsNote}\n`);

console.log(`@expo/ui — universal (iOS + Android + web)`);
console.log(`  Components: ${formatNames(universalComponents)}\n`);

console.log(`@expo/ui/swift-ui — iOS ONLY (crashes on Android)`);
console.log(`  Components: ${formatNames(swiftuiComponents)}`);
if (withDocs) {
  console.log(`  Modifiers:\n${formatModifiers(swiftuiModifiers)}`);
} else {
  console.log(`  Modifiers: ${formatModifiers(swiftuiModifiers)}`);
}
console.log();

console.log(`@expo/ui/jetpack-compose — Android ONLY (crashes on iOS)`);
console.log(`  Components: ${formatNames(composeComponents)}`);
if (withDocs) {
  console.log(`  Modifiers:\n${formatModifiers(composeModifiers)}`);
} else {
  console.log(`  Modifiers: ${formatModifiers(composeModifiers)}`);
}
