const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const directory = path.resolve(__dirname, '../build/integration-output')
for (const service of ['surreal-memory', 'liter-llm']) {
  const image = `ghcr.io/prometheus-ags/the-boss-${service}`
  const references = ['amd64', 'arm64'].map((arch) => {
    const { digest } = JSON.parse(fs.readFileSync(path.join(directory, `${service}-${arch}.json`)))
    if (!/^sha256:[a-f0-9]{64}$/.test(digest)) throw new Error(`Invalid ${service} ${arch} digest`)
    return `${image}@${digest}`
  })
  const tag = `${image}:${process.env.PAYLOAD_TAG}`
  execFileSync('docker', ['buildx', 'imagetools', 'create', '--tag', tag, ...references], { stdio: 'inherit' })
  const description = execFileSync('docker', ['buildx', 'imagetools', 'inspect', tag], { encoding: 'utf8' })
  const digest = /^Digest:\s+(sha256:[a-f0-9]{64})\s*$/m.exec(description)?.[1]
  if (!digest) throw new Error(`Registry returned no manifest digest for ${tag}`)
  fs.writeFileSync(path.join(directory, `${service}-image.json`), JSON.stringify({ image, digest }, null, 2))
}
