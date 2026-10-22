#!/usr/bin/env node
/**
 * Builds the serialized ad-blocking engine shipped in `resources/adblock/`.
 *
 * The runtime never parses filter text: parsing ~100k rules costs seconds on a
 * cold start, while `FiltersEngine.deserialize` is effectively a memory copy.
 * Everything in this script therefore happens at build time.
 *
 * Usage:
 *   node scripts/adblock/build-engine.mjs            # use a 7-day cache, download when stale
 *   node scripts/adblock/build-engine.mjs --force    # always download
 *   node scripts/adblock/build-engine.mjs --offline  # never touch the network
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, copyFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const root = path.resolve(import.meta.dirname, '../..')
const cacheDir = path.join(root, 'node_modules/.cache/adblock')
const outputDir = path.join(root, 'resources/adblock')

const LISTS = [
  {
    name: 'EasyList',
    url: 'https://easylist-downloads.adblockplus.org/easylist.txt',
    mirrors: [
      'https://easylist.to/easylist/easylist.txt',
      'https://cdn.jsdelivr.net/gh/easylist/easylist@master/easylist.txt'
    ]
  },
  {
    name: 'EasyList China',
    url: 'https://easylist-downloads.adblockplus.org/easylistchina.txt',
    mirrors: [
      'https://cdn.jsdelivr.net/gh/easylist/easylistchina@master/easylistchina.txt',
      'https://raw.githubusercontent.com/easylist/easylistchina/master/easylistchina.txt'
    ]
  },
  {
    name: 'EasyPrivacy',
    url: 'https://easylist-downloads.adblockplus.org/easyprivacy.txt',
    mirrors: [
      'https://easylist.to/easylist/easyprivacy.txt',
      'https://cdn.jsdelivr.net/gh/easylist/easylist@master/easyprivacy.txt'
    ]
  }
]

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const args = new Set(process.argv.slice(2))
const offline = args.has('--offline')
const force = args.has('--force')

function countRules(text) {
  let count = 0
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('!') || trimmed.startsWith('[')) continue
    count++
  }
  return count
}

function headerVersion(text) {
  const match = /^!\s*Version:\s*(.+)$/m.exec(text)
  return match?.[1]?.trim() ?? null
}

async function download(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(60_000),
    headers: {
      // Some mirrors reject requests without a browser-ish UA.
      'User-Agent': 'Mozilla/5.0 (compatible; CherryStudioAdblockBuilder/1.0)'
    }
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const text = await response.text()
  if (text.length < 10_000) throw new Error(`suspiciously small payload (${text.length} bytes)`)
  return text
}

async function loadList(list) {
  mkdirSync(cacheDir, { recursive: true })
  const cachePath = path.join(cacheDir, `${list.name.replace(/\s+/g, '-').toLowerCase()}.txt`)
  const cached = existsSync(cachePath) ? statSync(cachePath) : undefined
  const fresh = cached && Date.now() - cached.mtimeMs < CACHE_TTL_MS

  if (!force && cached && (offline || fresh)) {
    const text = readFileSync(cachePath, 'utf8')
    console.log(`[cache] ${list.name}: ${countRules(text)} rules`)
    return { text, source: 'cache', version: headerVersion(text) }
  }
  if (offline) {
    throw new Error(`${list.name} is not cached and --offline was requested`)
  }

  const candidates = [list.url, ...(list.mirrors ?? [])]
  let lastError
  for (const url of candidates) {
    try {
      const text = await download(url)
      writeFileSync(cachePath, text)
      console.log(`[fetch] ${list.name}: ${countRules(text)} rules <- ${url}`)
      return { text, source: url, version: headerVersion(text) }
    } catch (error) {
      lastError = error
      console.warn(`[warn] ${list.name} from ${url} failed: ${error.message}`)
    }
  }
  if (cached) {
    console.warn(`[warn] ${list.name}: all downloads failed, falling back to stale cache`)
    const text = readFileSync(cachePath, 'utf8')
    return { text, source: 'stale-cache', version: headerVersion(text) }
  }
  throw new Error(`${list.name} could not be downloaded: ${lastError?.message}`)
}

async function main() {
  const { FiltersEngine } = require('@ghostery/adblocker')
  const preloadEntry = require.resolve('@ghostery/adblocker-electron-preload')
  const preloadPackage = JSON.parse(
    readFileSync(require.resolve('@ghostery/adblocker-electron-preload/package.json'), 'utf8')
  )

  const loaded = []
  for (const list of LISTS) {
    loaded.push({ name: list.name, ...(await loadList(list)) })
  }

  const customPath = path.join(root, 'scripts/adblock/custom-filters.txt')
  const custom = readFileSync(customPath, 'utf8')

  const text = [...loaded.map((entry) => entry.text), custom].join('\n\n')
  console.log(`[build] parsing ${countRules(text)} rules...`)
  const started = performance.now()

  const engine = FiltersEngine.parse(text, {
    loadNetworkFilters: true,
    loadCosmeticFilters: true,
    loadExceptionFilters: true,
    loadCSPFilters: true,
    enableMutationObserver: true,
    guessRequestTypeFromUrl: true
  })

  const serialized = engine.serialize()
  mkdirSync(outputDir, { recursive: true })
  writeFileSync(path.join(outputDir, 'engine.bin'), serialized)

  // The preload has to live on disk at a path we control: pnpm keeps transitive
  // dependencies under `.pnpm/`, which an asar-packed app cannot rely on.
  copyFileSync(preloadEntry, path.join(outputDir, 'preload.cjs'))

  const metadata = {
    version: 1,
    generatedAt: new Date().toISOString(),
    engineBytes: serialized.byteLength,
    ruleCount: countRules(text),
    preloadVersion: preloadPackage.version,
    lists: loaded.map((entry) => ({
      name: entry.name,
      version: entry.version,
      source: entry.source,
      rules: countRules(entry.text)
    })),
    customRules: countRules(custom)
  }
  writeFileSync(path.join(outputDir, 'engine.json'), `${JSON.stringify(metadata, null, 2)}\n`)

  console.log(
    `[done] ${metadata.ruleCount} rules -> ${(serialized.byteLength / 1024 / 1024).toFixed(2)} MiB ` +
      `in ${(performance.now() - started).toFixed(0)} ms`
  )
  console.log(`[done] preload copied from ${path.relative(root, preloadEntry)}`)
}

main().catch((error) => {
  console.error(`[fail] ${error.message}`)
  process.exit(1)
})
