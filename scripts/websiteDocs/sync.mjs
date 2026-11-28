import { appendFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import {
  assertCurrentPlan,
  changedFiles,
  contentTree,
  fetchRevision,
  filesForCommit,
  git,
  mergeContent,
  planPath,
  prAction,
  repositories,
  scratch,
  sha
} from './content.mjs'
import {
  api,
  createBranch,
  freshness,
  head,
  latestPr,
  managedHead,
  replaceBranch,
  signedCommit,
  stateBranch,
  statePath,
  syncBranch
} from './github.mjs'

const remote = (side) => `https://github.com/${repositories[side]}.git`

async function snapshots(repo) {
  const heads = {}
  const trees = {}
  for (const side of Object.keys(repositories)) {
    heads[side] = sha(await head(side))
    fetchRevision(repo, remote(side), heads[side])
    trees[side] = contentTree(repo, heads[side], side)
  }
  return { heads, trees }
}

export function baselineTree(repo, state) {
  if (state?.version !== 1) throw new Error('Invalid synchronization baseline')
  const desktopTree = contentTree(repo, sha(state.heads?.desktop), 'desktop')
  const websiteTree = contentTree(repo, sha(state.heads?.website), 'website')
  if (desktopTree !== sha(state.tree) || websiteTree !== state.tree) throw new Error('Recorded baseline trees disagree')
  return desktopTree
}

/** @param {{ apply?: boolean, bootstrap?: boolean, resume?: string }} options */
export async function reconcile({ apply = false, bootstrap = false, resume } = {}) {
  if (apply && (!process.env.GH_TOKEN || !process.env.DOCS_SYNC_BOT_LOGIN))
    throw new Error('Use the configured GitHub App for --apply')
  if (resume && !['desktop', 'website', 'all'].includes(resume)) throw new Error('Invalid resume direction')
  const work = scratch()
  const report = { mode: apply ? 'apply' : 'dry-run', actions: [] }
  const prs = {}
  try {
    const current = await snapshots(work.repo)
    report.heads = current.heads
    report.trees = current.trees
    const stateHead = await head('desktop', stateBranch)
    let state
    if (stateHead) {
      fetchRevision(work.repo, remote('desktop'), stateHead)
      const present = git(work.repo, ['ls-tree', '--name-only', stateHead, '--', statePath]).toString().trim()
      if (present) {
        state = JSON.parse(git(work.repo, ['show', `${stateHead}:${statePath}`]).toString())
        for (const side of Object.keys(repositories)) fetchRevision(work.repo, remote(side), sha(state.heads?.[side]))
      } else if (!bootstrap) throw new Error('Incomplete baseline initialization; resume with --bootstrap')
    } else if (!bootstrap) {
      throw new Error('No shared baseline. Use --bootstrap only after importing and verifying equal content')
    }
    const base = state ? baselineTree(work.repo, state) : current.trees.desktop
    if (!state && current.trees.desktop !== current.trees.website)
      throw new Error('Bootstrap requires identical content in both repositories')
    report.baseline = base
    report.baselineHeads = state?.heads ?? current.heads
    for (const side of Object.keys(repositories)) {
      const pr = await latestPr(side)
      const tracked = pr?.state === 'open' ? await managedHead(side, pr) : undefined
      prs[side] = { pr, action: prAction(pr, tracked, resume === side || resume === 'all') }
      if (apply && pr?.state === 'open')
        await freshness(side, pr.head.sha, 'pending', 'Comparing both documentation repositories')
    }
    const merged = mergeContent(work.repo, base, current.trees.desktop, current.trees.website)
    if (merged.conflicts.length) {
      report.conflicts = merged.conflicts
      throw Object.assign(new Error(`Documentation conflicts: ${merged.conflicts.join(', ')}`), { report })
    }
    report.result = merged.tree
    for (const side of Object.keys(repositories)) {
      const changes = changedFiles(work.repo, current.trees[side], merged.tree)
      const { pr, action } = prs[side]
      if (action === 'manual' || (changes.length && action === 'paused')) {
        report.actions.push({ side, action, pr: pr?.html_url, paths: changes.map((file) => file.name) })
        if (apply && pr?.state === 'open')
          await freshness(side, pr.head.sha, 'failure', 'Manual edits need maintainer reconciliation')
        continue
      }
      if (!changes.length) continue
      const plan = {
        version: 1,
        destination: side,
        baseline: base,
        baselineHeads: report.baselineHeads,
        ...current,
        heads: { ...current.heads },
        result: merged.tree
      }
      if (pr?.state === 'open') {
        fetchRevision(work.repo, remote(side), pr.head.sha)
        const oldPlan = JSON.parse(git(work.repo, ['show', `${pr.head.sha}:${planPath}`]).toString())
        let reusable = contentTree(work.repo, pr.head.sha, side) === merged.tree
        try {
          assertCurrentPlan(oldPlan, current.trees)
        } catch {
          reusable = false
        }
        if (reusable) {
          report.actions.push({ side, action: 'unchanged', pr: pr.html_url })
          if (apply) await freshness(side, pr.head.sha, 'success', 'Synchronization plan matches current content')
          continue
        }
      }
      report.actions.push({ side, action, paths: changes.map((file) => file.name) })
      if (!apply) continue
      const latest = await snapshots(work.repo)
      assertCurrentPlan(plan, latest.trees)
      if (latest.trees[side] === merged.tree) {
        report.actions.at(-1).action = 'converged'
        continue
      }
      plan.heads[side] = latest.heads[side]
      const files = filesForCommit(work.repo, changes, side)
      files.additions.push({
        path: planPath,
        contents: Buffer.from(`${JSON.stringify(plan, null, 2)}\n`).toString('base64')
      })
      const branch = await head(side, syncBranch)
      if (pr?.state === 'open' && branch !== pr.head.sha)
        throw new Error('Synchronization branch changed; retry reconciliation')
      if (branch && !(await managedHead(side, { head: { sha: branch } })))
        throw new Error('Synchronization branch contains manual changes')
      const published = await replaceBranch(work.repo, side, branch, latest.heads[side], files, merged.tree)
      const body = `Synchronize shared website documentation.\n\nBaseline tree: \`${base}\`\nBaseline desktop: \`${report.baselineHeads.desktop}\`\nBaseline website: \`${report.baselineHeads.website}\`\nDesktop: \`${plan.heads.desktop}\`\nWebsite: \`${plan.heads.website}\`\nResult: \`${merged.tree}\`\n\nThis PR requires content validation and human review. It is not automatically merged.`
      if (pr?.state === 'open') {
        await api(`repos/${repositories[side]}/pulls/${pr.number}`, 'PATCH', { body })
      } else {
        const opened = await api(`repos/${repositories[side]}/pulls`, 'POST', {
          title: 'docs(website-docs): synchronize shared content',
          head: syncBranch,
          base: 'main',
          body
        })
        if (!opened?.number) throw new Error('Cannot create synchronization PR')
      }
      const after = await snapshots(work.repo)
      assertCurrentPlan(plan, after.trees)
      await freshness(side, published, 'success', 'Synchronization plan matches current content')
    }
    if (
      current.trees.desktop === current.trees.website &&
      !report.actions.some((action) => action.action === 'manual')
    ) {
      report.actions.push({ action: 'checkpoint' })
      if (apply) {
        const latest = await snapshots(work.repo)
        if (latest.trees.desktop !== current.trees.desktop || latest.trees.website !== current.trees.website)
          throw new Error('Content changed before checkpoint; retry reconciliation')
        for (const side of Object.keys(repositories)) {
          const pr = prs[side].pr
          if (pr?.state === 'open')
            await api(`repos/${repositories[side]}/pulls/${pr.number}`, 'PATCH', {
              state: 'closed',
              body: 'Closed by the coordinator: shared content has converged.'
            })
        }
        if (!state || state.heads.desktop !== latest.heads.desktop || state.heads.website !== latest.heads.website) {
          if (!stateHead) await createBranch('desktop', stateBranch, latest.heads.desktop)
          const next = { version: 1, heads: latest.heads, tree: current.trees.desktop }
          await signedCommit(
            'desktop',
            stateBranch,
            stateHead ?? latest.heads.desktop,
            {
              additions: [
                { path: statePath, contents: Buffer.from(`${JSON.stringify(next, null, 2)}\n`).toString('base64') }
              ],
              deletions: []
            },
            'chore(website-docs): checkpoint synchronized content',
            `Docs-Sync-Result: ${current.trees.desktop}`
          )
        }
      }
    }
    return report
  } catch (error) {
    if (apply) {
      for (const side of Object.keys(prs)) {
        const pr = prs[side].pr
        if (pr?.state === 'open') {
          try {
            await freshness(side, pr.head.sha, 'failure', 'Reconciliation failed; inspect the coordinator run')
          } catch {
            /* Preserve the original failure. */
          }
        }
      }
    }
    error.report ??= report
    throw error
  } finally {
    work.close()
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({
      options: {
        apply: { type: 'boolean', default: false },
        bootstrap: { type: 'boolean', default: false },
        resume: { type: 'string' }
      }
    })
    const report = await reconcile(values)
    const output = `${JSON.stringify(report, null, 2)}\n`
    process.stdout.write(output)
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n\`\`\`json\n${output}\`\`\`\n`)
  } catch (error) {
    const output = `${JSON.stringify({ ...error.report, error: error.message }, null, 2)}\n`
    process.stderr.write(output)
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n\`\`\`json\n${output}\`\`\`\n`)
    process.exitCode = 1
  }
}
