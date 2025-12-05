/**
 * Stats major contributors per module based on .github/pr-modules.yml
 * Output a markdown summary and write JSON to .github/reviewer-suggestions.json
 *
 * Usage:
 *   node scripts/stats-contributors.js [--top 3] [--since 1.year] [--mode auto|shortlog|log|blame] [--blame-sample 30]
 */

const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

function parseArgs() {
  const args = process.argv.slice(2)
  const out = { top: 3, since: '', mode: 'auto', blameSample: 30 }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--top' && i + 1 < args.length) {
      out.top = parseInt(args[++i], 10) || 3
    } else if (args[i] === '--since' && i + 1 < args.length) {
      out.since = String(args[++i])
    } else if (args[i] === '--mode' && i + 1 < args.length) {
      out.mode = String(args[++i])
    } else if (args[i] === '--blame-sample' && i + 1 < args.length) {
      out.blameSample = parseInt(args[++i], 10) || 30
    }
  }
  return out
}

// Minimal YAML parser for categories/globs in .github/pr-modules.yml
function parseModulesConfig(configPath) {
  const text = readText(configPath)
  if (!text) throw new Error(`Cannot read ${configPath}`)
  const lines = text.split(/\r?\n/)
  const categories = []
  let inCategories = false
  let current = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!inCategories) {
      if (/^categories:\s*$/.test(line)) inCategories = true
      continue
    }

    // New category key
    const catMatch = /^\s{2}([a-zA-Z0-9_-]+):\s*$/.exec(line)
    if (catMatch) {
      if (current) categories.push(current)
      current = { key: catMatch[1], name: '', globs: [] }
      continue
    }

    if (!current) continue

    const nameMatch = /^\s{4}name:\s*"?([^"]+)"?\s*$/.exec(line)
    if (nameMatch) {
      current.name = nameMatch[1].trim()
      continue
    }

    // Enter globs list, then collect dash items
    const globsHeader = /^\s{4}globs:\s*$/.exec(line)
    if (globsHeader) {
      let j = i + 1
      while (j < lines.length) {
        const l = lines[j]
        const item = /^\s{6}-\s*"?([^"]+)"?\s*$/.exec(l)
        if (!item) break
        current.globs.push(item[1].trim())
        j++
      }
      continue
    }
  }
  if (current) categories.push(current)
  return categories
}

function git(args, cwd) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (res.status !== 0) {
    const msg = (res.stderr || '').trim() || `git ${args.join(' ')} failed`
    throw new Error(msg)
  }
  return res.stdout
}

function buildPathspecs(globs) {
  // Use pathspec magic :(glob)pattern so that ** works and we avoid shell expansion
  return globs.map((g) => `:(glob)${g}`)
}

function lsFilesForGlobs(globs, repoRoot) {
  const pathspecs = buildPathspecs(globs)
  if (pathspecs.length === 0) return []
  try {
    const stdout = git(['ls-files', '--', ...pathspecs], repoRoot)
    return stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
  } catch (e) {
    // No matched files or pathspec error → treat as empty
    return []
  }
}

function shortlogFor(globs, repoRoot, since) {
  const files = lsFilesForGlobs(globs, repoRoot)
  if (files.length === 0) return []
  const base = ['shortlog', '-sne']
  if (since) base.push(`--since=${since}`)
  const stdout = git([...base, '--', ...files], repoRoot)
  const lines = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  const rows = []
  for (const l of lines) {
    // e.g. "  42  John Doe <john@example.com>"
    const m = /^(\d+)\s+(.+?)\s+<([^>]+)>$/.exec(l)
    if (!m) continue
    const commits = parseInt(m[1], 10)
    const name = m[2]
    const email = m[3]
    const gh = extractGithubUsername(name, email)
    rows.push({ commits, name, email, github: gh })
  }
  rows.sort((a, b) => b.commits - a.commits)
  return rows
}

function logAuthorsFor(globs, repoRoot, since) {
  const files = lsFilesForGlobs(globs, repoRoot)
  if (files.length === 0) return []
  const base = ['log', '--format=%an <%ae>']
  if (since) base.push(`--since=${since}`)
  const stdout = git([...base, '--', ...files], repoRoot)
  const lines = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  const map = new Map()
  for (const l of lines) {
    const m = /^(.+?)\s+<([^>]+)>$/.exec(l)
    if (!m) continue
    const name = m[1]
    const email = m[2]
    const gh = extractGithubUsername(name, email)
    const key = `${name} <${email}>`
    map.set(key, (map.get(key) || 0) + 1)
  }
  const out = []
  for (const [key, commits] of map.entries()) {
    const m = /^(.+?)\s+<([^>]+)>$/.exec(key)
    out.push({ commits, name: m[1], email: m[2], github: extractGithubUsername(m[1], m[2]) })
  }
  out.sort((a, b) => b.commits - a.commits)
  return out
}

function blameAuthorsSample(globs, repoRoot, sample) {
  const files = lsFilesForGlobs(globs, repoRoot)
  if (files.length === 0) return []
  const pick = files.slice(0, Math.max(1, sample))
  const map = new Map()
  for (const f of pick) {
    let stdout = ''
    try {
      stdout = git(['blame', '--line-porcelain', '--', f], repoRoot)
    } catch (e) {
      continue
    }
    const lines = stdout.split(/\r?\n/)
    for (const line of lines) {
      // author and author-mail lines
      const am = /^author-mail\s+<([^>]+)>$/.exec(line)
      if (am) {
        const email = am[1]
        // We do not rely on index; we just keep email-based identity
        const gh = extractGithubUsername('', email)
        const key = `${gh || ''}<${email}>`
        map.set(key, (map.get(key) || 0) + 1)
      }
    }
  }
  const out = []
  for (const [key, commits] of map.entries()) {
    const m = /^(.*?)<([^>]+)>$/.exec(key)
    const email = m ? m[2] : ''
    const gh = extractGithubUsername('', email)
    out.push({ commits, name: gh || email, email, github: gh })
  }
  out.sort((a, b) => b.commits - a.commits)
  return out
}

function extractGithubUsername(name, email) {
  // Try noreply forms: 12345+user@users.noreply.github.com or user@users.noreply.github.com
  const noreply = /^(?:\d+\+)?([A-Za-z0-9-]+)@users\.noreply\.github\.com$/.exec(email)
  if (noreply) return noreply[1]
  // If name itself looks like a probable GitHub handle
  if (/^[A-Za-z0-9-]{3,}$/.test(name)) return name
  return ''
}

function main() {
  const repoRoot = process.cwd()
  const { top, since, mode, blameSample } = parseArgs()
  const configPath = path.join(repoRoot, '.github', 'pr-modules.yml')
  const categories = parseModulesConfig(configPath)

  const suggestions = {}
  const markdownLines = []
  markdownLines.push('| Module | Top Contributors (commits) |')
  markdownLines.push('|---|---|')

  for (const cat of categories) {
    let rows = []
    try {
      if (mode === 'shortlog' || mode === 'auto') rows = shortlogFor(cat.globs, repoRoot, since)
      if (rows.length === 0 && (mode === 'log' || mode === 'auto')) rows = logAuthorsFor(cat.globs, repoRoot, since)
      if (rows.length === 0 && (mode === 'blame' || mode === 'auto'))
        rows = blameAuthorsSample(cat.globs, repoRoot, blameSample)
    } catch (e) {
      // Fallback to next method if one fails
      if (mode === 'auto') {
        try {
          rows = logAuthorsFor(cat.globs, repoRoot, since)
        } catch (e2) {
          // ignore and continue
        }
        if (rows.length === 0) {
          try {
            rows = blameAuthorsSample(cat.globs, repoRoot, blameSample)
          } catch (e3) {
            // ignore and continue
          }
        }
      } else {
        // Non-auto mode: report empty on error
        rows = []
      }
    }
    const topRows = rows.slice(0, top)
    suggestions[cat.key] = topRows.map((r) => ({
      github: r.github,
      name: r.name,
      email: r.email,
      commits: r.commits
    }))
    const cell = topRows
      .map((r) => {
        const id = r.github ? `@${r.github}` : r.name
        return `${id} (${r.commits})`
      })
      .join(', ')
    markdownLines.push(`| ${cat.key} | ${cell || '-'} |`)
  }

  const outJsonPath = path.join(repoRoot, '.github', 'reviewer-suggestions.json')
  fs.writeFileSync(outJsonPath, JSON.stringify({ generatedAt: new Date().toISOString(), suggestions }, null, 2))

  console.log(markdownLines.join('\n'))
  console.log(`\nSaved JSON: ${path.relative(repoRoot, outJsonPath)}`)
}

main()
