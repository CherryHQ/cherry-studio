const fs = require('node:fs')
const { execFileSync } = require('node:child_process')
const version = require('../package.json').version
const repository = process.env.GITHUB_REPOSITORY
const branch = process.env.GITHUB_REF_NAME
const current = JSON.parse(execFileSync('gh', ['api', `repos/${repository}/git/ref/heads/${branch}`], { encoding: 'utf8' }))
if (current.object.sha !== process.env.GITHUB_SHA) throw new Error('Source branch changed during release; keep the previous release entry until artifacts are reconciled')
const body = { query: 'mutation($input: CreateCommitOnBranchInput!) { createCommitOnBranch(input: $input) { commit { url oid } } }', variables: { input: {
  branch: { repositoryNameWithOwner: repository, branchName: branch },
  expectedHeadOid: current.object.sha,
  message: { headline: `chore(releases): publish complete v${version} installers [skip ci]`, body: 'Assisted-by: Codex:GPT-6 [GitHub Actions release packaging]' },
  fileChanges: { additions: ['RELEASES.md', 'release-manifest.json'].map((path) => ({ path, contents: fs.readFileSync(path).toString('base64') })) }
} } }
execFileSync('gh', ['api', 'graphql', '--input', '-'], { input: JSON.stringify(body), stdio: ['pipe', 'inherit', 'inherit'] })
