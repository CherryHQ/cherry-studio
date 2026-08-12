import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { arch, platform } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const smokeEntryName = 'packaged-pi-smoke.cjs'
const stagedEntry = path.join(root, 'out', 'main', smokeEntryName)
const successMarker = 'PACKAGED_PI_SMOKE_OK'
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

const packagedProbe = String.raw`
const assert = require('node:assert/strict')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')

async function main() {
  const tempRoot = mkdtempSync(path.join(tmpdir(), 'cherry-packaged-pi-'))
  const piHome = path.join(tempRoot, 'agent')
  const sessions = path.join(tempRoot, 'sessions')
  const workspace = path.join(tempRoot, 'workspace')
  require('node:fs').mkdirSync(piHome)
  require('node:fs').mkdirSync(sessions)
  require('node:fs').mkdirSync(workspace)
  process.env.PI_CODING_AGENT_DIR = piHome
  process.env.PI_CODING_AGENT_SESSION_DIR = sessions

  try {
    const [pi, piAi] = await Promise.all([
      import('@earendil-works/pi-coding-agent'),
      import('@earendil-works/pi-ai')
    ])

    for (const name of [
      'createAgentSession',
      'DefaultResourceLoader',
      'AuthStorage',
      'ModelRegistry',
      'SessionManager',
      'SettingsManager'
    ]) {
      assert.equal(typeof pi[name], 'function', 'missing pi SDK export: ' + name)
    }
    assert.equal(typeof piAi.lazyStream, 'function', 'missing pi-ai lazyStream export')

    const authStorage = pi.AuthStorage.inMemory()
    authStorage.setRuntimeApiKey('cherry-package-smoke', 'not-a-real-key')
    assert.ok(pi.ModelRegistry.inMemory(authStorage))
    assert.ok(pi.SessionManager.inMemory(workspace))
    const settingsManager = pi.SettingsManager.inMemory()
    assert.ok(new pi.DefaultResourceLoader({ cwd: workspace, agentDir: piHome, settingsManager }))
    assert.equal(pi.getAgentDir(), piHome)

    // Photon is a transitive Pi dependency whose WASM must be outside app.asar.
    // Construct and encode a real pixel so this checks loading, not just package presence.
    const { PhotonImage } = require('@silvia-odwyer/photon-node')
    const image = new PhotonImage(new Uint8Array([255, 0, 0, 255]), 1, 1)
    try {
      assert.equal(image.get_width(), 1)
      assert.ok(image.get_bytes().length > 0, 'Photon failed to encode through packaged WASM')
    } finally {
      image.free()
    }

    process.stdout.write('${successMarker}\n')
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
`

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    env: options.env ?? process.env
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n')
    throw new Error(`${command} ${args.join(' ')} exited with ${result.status}${output ? `\n${output}` : ''}`)
  }
  return result
}

function hostTarget() {
  const hostPlatform = platform()
  const hostArch = arch()
  assert.ok(['darwin', 'linux', 'win32'].includes(hostPlatform), `unsupported packaging platform: ${hostPlatform}`)
  assert.ok(['arm64', 'x64'].includes(hostArch), `unsupported packaging architecture: ${hostArch}`)
  return { hostPlatform, hostArch }
}

function packageLayout(hostPlatform, hostArch) {
  if (hostPlatform === 'darwin') {
    const appOutDir = path.join(root, 'dist', hostArch === 'arm64' ? 'mac-arm64' : 'mac')
    const appDir = path.join(appOutDir, 'Cherry Studio.app', 'Contents')
    return {
      resourcesDir: path.join(appDir, 'Resources'),
      executable: path.join(appDir, 'MacOS', 'Cherry Studio')
    }
  }

  if (hostPlatform === 'win32') {
    const appOutDir = path.join(root, 'dist', hostArch === 'arm64' ? 'win-arm64-unpacked' : 'win-unpacked')
    return {
      resourcesDir: path.join(appOutDir, 'resources'),
      executable: findExecutable(appOutDir, ['Cherry Studio.exe', 'CherryStudio.exe'])
    }
  }

  const appOutDir = path.join(root, 'dist', hostArch === 'arm64' ? 'linux-arm64-unpacked' : 'linux-unpacked')
  return {
    resourcesDir: path.join(appOutDir, 'resources'),
    executable: findExecutable(appOutDir, ['CherryStudio', 'cherry-studio', 'cherrystudio'])
  }
}

function findExecutable(directory, preferredNames) {
  for (const name of preferredNames) {
    const candidate = path.join(directory, name)
    try {
      chmodSync(candidate, 0o755)
      return candidate
    } catch {
      // Try the next electron-builder platform spelling.
    }
  }

  const entries = readdirSync(directory, { withFileTypes: true })
  const fallback = entries.find(
    (entry) => entry.isFile() && /cherry/i.test(entry.name) && (platform() !== 'win32' || entry.name.endsWith('.exe'))
  )
  assert.ok(fallback, `could not find packaged Cherry Studio executable under ${directory}`)
  const candidate = path.join(directory, fallback.name)
  if (platform() !== 'win32') chmodSync(candidate, 0o755)
  return candidate
}

function packagePlatformArgs(hostPlatform, hostArch) {
  const platformFlag = hostPlatform === 'darwin' ? '--mac' : hostPlatform === 'win32' ? '--win' : '--linux'
  return ['exec', 'electron-builder', '--dir', platformFlag, `--${hostArch}`]
}

function main() {
  const { hostPlatform, hostArch } = hostTarget()
  run(pnpm, ['build'])
  const mainBundle = readFileSync(path.join(root, 'out', 'main', 'main.js'), 'utf8')
  assert.match(
    mainBundle,
    /import\(["']@earendil-works\/pi-coding-agent["']\)/,
    'built main bundle no longer preserves the Pi SDK dynamic import'
  )
  mkdirSync(path.dirname(stagedEntry), { recursive: true })
  writeFileSync(stagedEntry, packagedProbe)

  try {
    run(pnpm, packagePlatformArgs(hostPlatform, hostArch))
    const { resourcesDir, executable } = packageLayout(hostPlatform, hostArch)
    const asarPath = path.join(resourcesDir, 'app.asar')
    assert.ok(statSync(asarPath).size > 0, `missing packaged app archive: ${asarPath}`)

    const result = run(executable, [path.join(asarPath, 'out', 'main', smokeEntryName)], {
      capture: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    })
    assert.match(result.stdout, new RegExp(`(?:^|\\n)${successMarker}(?:\\n|$)`))
    process.stdout.write(result.stdout)
  } finally {
    rmSync(stagedEntry, { force: true })
  }
}

main()
