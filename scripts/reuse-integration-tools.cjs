const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const output = path.resolve('build/integration-output')
fs.mkdirSync(output, { recursive: true })
for (const run of process.env.NATIVE_RUNS.split(',').map((value) => value.trim())) {
  if (!/^\d+$/.test(run)) throw new Error('Native payload reuse requires GitHub run IDs')
  // A failed run can still contain successful tools; publication checks the complete set.
  execFileSync('gh', ['run', 'watch', run, '--repo', process.env.GITHUB_REPOSITORY, '--interval', '30'], { stdio: 'inherit' })
  const directory = path.resolve('build/reused-native', run)
  execFileSync('gh', ['run', 'download', run, '--repo', process.env.GITHUB_REPOSITORY, '--pattern', 'native-tools-*', '--dir', directory], { stdio: 'inherit' })
  for (const artifact of fs.readdirSync(directory)) {
    const source = path.join(directory, artifact)
    for (const name of fs.readdirSync(source)) {
      const destination = /^tools-.*\.json$/.test(name) ? `base-tools-${run}-${name.slice('tools-'.length)}` : name
      fs.copyFileSync(path.join(source, name), path.join(output, destination))
    }
  }
}
