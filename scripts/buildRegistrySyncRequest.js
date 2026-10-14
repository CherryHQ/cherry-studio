const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const CREATE_COMMIT_MUTATION =
  'mutation($input:CreateCommitOnBranchInput!){createCommitOnBranch(input:$input){commit{oid url}}}'

function listStagedPaths(diffFilter) {
  return execFileSync('git', ['diff', '--cached', '--name-only', '-z', `--diff-filter=${diffFilter}`])
    .toString()
    .split('\0')
    .filter(Boolean)
}

function buildRegistrySyncRequest({
  rootDirectory,
  additionPaths,
  deletionPaths,
  refId,
  expectedHeadOid,
  headline,
  body
}) {
  const additions = additionPaths.map((filePath) => ({
    path: filePath,
    contents: fs.readFileSync(path.resolve(rootDirectory, filePath)).toString('base64')
  }))
  const deletions = deletionPaths.map((filePath) => ({ path: filePath }))

  return {
    query: CREATE_COMMIT_MUTATION,
    variables: {
      input: {
        branch: { id: refId },
        expectedHeadOid,
        message: { headline, body },
        fileChanges: { additions, deletions }
      }
    }
  }
}

function requiredEnvironment(name) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

function main() {
  const [outputPath] = process.argv.slice(2)
  if (!outputPath) throw new Error('output path is required')

  const rootDirectory = process.cwd()
  const request = buildRegistrySyncRequest({
    rootDirectory,
    additionPaths: listStagedPaths('ACMR'),
    deletionPaths: listStagedPaths('D'),
    refId: requiredEnvironment('REGISTRY_SYNC_REF_ID'),
    expectedHeadOid: requiredEnvironment('REGISTRY_SYNC_EXPECTED_HEAD_OID'),
    headline: requiredEnvironment('REGISTRY_SYNC_HEADLINE'),
    body: requiredEnvironment('REGISTRY_SYNC_BODY')
  })

  fs.writeFileSync(outputPath, JSON.stringify(request))
}

if (require.main === module) main()

exports.buildRegistrySyncRequest = buildRegistrySyncRequest
