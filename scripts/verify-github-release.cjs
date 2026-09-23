const fs = require('node:fs')

async function main() {
  const manifest = JSON.parse(fs.readFileSync('release-manifest.json'))
  for (const artifact of manifest.artifacts) {
    if (!artifact.url.startsWith(`https://github.com/${process.env.GITHUB_REPOSITORY}/releases/download/`)) {
      throw new Error(`Non-GitHub installer URL remains: ${artifact.name}`)
    }
    const response = await fetch(artifact.url, { method: 'HEAD', signal: AbortSignal.timeout(120000) })
    if (!response.ok) throw new Error(`Published installer unavailable: ${artifact.name}, HTTP ${response.status}`)
    const length = Number(response.headers.get('content-length'))
    if (Number.isFinite(length) && length !== artifact.size)
      throw new Error(`Published installer size mismatch: ${artifact.name}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
