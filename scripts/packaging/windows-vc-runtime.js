const fs = require('node:fs')
const path = require('node:path')
const childProcess = require('node:child_process')
const https = require('node:https')
const os = require('node:os')
const { pipeline } = require('node:stream/promises')

const generatedFile = 'vc-runtime-version.generated.nsh'
const incomplete = (reason) =>
  new Error(
    `VC runtime floor generation failed: cannot establish a complete Windows MSVC toolset and redistributable inventory (${reason}); refusing to package with an unverified floor.`
  )
const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]

function validateVersion(parts) {
  if (
    parts.length !== 3 ||
    !parts.every(Number.isInteger) ||
    parts[0] !== 14 ||
    parts[1] < 0 ||
    parts[1] > 65535 ||
    parts[2] < 1 ||
    parts[2] > 65535
  ) {
    throw incomplete(`unsupported version ${parts.join('.')}`)
  }
  return parts
}

function deriveRuntimeFloor(inventory) {
  if (
    !inventory ||
    !Array.isArray(inventory.toolsets) ||
    !inventory.toolsets.length ||
    !Array.isArray(inventory.redists) ||
    !inventory.redists.length
  )
    throw incomplete('empty inventory')
  const tools = inventory.toolsets.map((entry) => {
    if (
      !entry ||
      typeof entry.path !== 'string' ||
      !entry.path ||
      typeof entry.version !== 'string' ||
      !/^\d+\.\d+\.\d+$/.test(entry.version)
    ) {
      throw incomplete('invalid toolset metadata')
    }
    return validateVersion(entry.version.split('.').map(Number))
  })
  const toolset = tools.reduce((a, b) => (compare(a, b) >= 0 ? a : b))
  const maxima = {}
  for (const entry of inventory.redists) {
    if (
      !entry ||
      !['x64', 'arm64'].includes(entry.arch) ||
      typeof entry.path !== 'string' ||
      !entry.path ||
      !Array.isArray(entry.version) ||
      entry.version.length !== 4 ||
      !entry.version.every(Number.isInteger) ||
      entry.version[3] < 0 ||
      entry.version[3] > 65535
    )
      throw incomplete('invalid payload metadata')
    const version = validateVersion(entry.version.slice(0, 3))
    if (entry.version[3] !== 0) {
      throw new Error(
        `VC runtime floor generation failed: redistributable ${entry.version.join('.')} has a nonzero rebuild component; the installer requires a four-part version check before this payload can be used as its floor.`
      )
    }
    if (!maxima[entry.arch] || compare(version, maxima[entry.arch]) > 0) maxima[entry.arch] = version
  }
  for (const arch of ['x64', 'arm64']) {
    if (!maxima[arch]) throw incomplete(`missing ${arch} payload`)
    if (compare(maxima[arch], toolset) < 0) {
      throw new Error(
        `VC runtime floor generation failed: ${arch} redistributable ${maxima[arch].join('.')}.0 is older than discovered MSVC toolset ${toolset.join('.')}; update Visual Studio before packaging.`
      )
    }
  }
  const [major, minor, build] = compare(maxima.x64, maxima.arm64) >= 0 ? maxima.x64 : maxima.arm64
  return { major, minor, build }
}

function renderRuntimeFloor({ major, minor, build }) {
  validateVersion([major, minor, build])
  return `!define VC_RUNTIME_MIN_MAJOR ${major}\n!define VC_RUNTIME_MIN_MINOR ${minor}\n!define VC_RUNTIME_MIN_BUILD ${build}\n!define VC_RUNTIME_MIN_PACKED ${(major << 16) | minor}\n`
}

function readPayloadVersion(file) {
  const quoted = file.replace(/'/g, "''")
  const command = `$ErrorActionPreference = 'Stop'; $v = [System.Diagnostics.FileVersionInfo]::GetVersionInfo('${quoted}'); ConvertTo-Json -Compress -InputObject @($v.FileMajorPart, $v.FileMinorPart, $v.FileBuildPart, $v.FilePrivatePart)`
  return JSON.parse(
    childProcess
      .execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], {
        encoding: 'utf8',
        windowsHide: true
      })
      .replace(/^\uFEFF/, '')
  )
}

function inspectWindowsMsvc() {
  try {
    const env = Object.fromEntries(Object.entries(process.env).map(([key, value]) => [key.toLowerCase(), value]))
    for (const key of ['cc', 'cxx', 'vctargetspath', 'npm_config_msbuild_path', 'gyp_defines']) {
      if (env[key]) throw new Error(`unsupported toolchain redirection ${key}`)
    }
    if (!env['programfiles(x86)']) throw new Error('ProgramFiles(x86) is missing')
    const vswhere = path.join(env['programfiles(x86)'], 'Microsoft Visual Studio', 'Installer', 'vswhere.exe')
    const instances = JSON.parse(
      childProcess
        .execFileSync(vswhere, ['-all', '-products', '*', '-prerelease', '-format', 'json'], {
          encoding: 'utf8',
          windowsHide: true
        })
        .replace(/^\uFEFF/, '')
    )
    if (!Array.isArray(instances) || !instances.length) throw new Error('no registered Visual Studio instances')
    const inventory = { toolsets: [], redists: [] }
    const roots = []
    const redistRoots = []
    const seen = new Set()
    const canonical = (value) =>
      fs
        .realpathSync(value)
        .replace(/[\\/]+$/, '')
        .toLowerCase()
    const directories = (root) => {
      let entries
      try {
        entries = fs.readdirSync(root, { withFileTypes: true })
      } catch (error) {
        if (error.code === 'ENOENT') return []
        throw error
      }
      return entries
        .filter(
          (entry) =>
            entry.isDirectory() || (entry.isSymbolicLink() && fs.statSync(path.join(root, entry.name)).isDirectory())
        )
        .map((entry) => entry.name)
    }
    const readPayload = (file, arch, source) => {
      const resolved = fs.realpathSync(file)
      const key = canonical(resolved)
      if (seen.has(key)) return
      seen.add(key)
      const version = readPayloadVersion(resolved)
      inventory.redists.push({ path: resolved, arch, version })
      process.stdout.write(`VC runtime payload (${source}): ${arch} ${version.join('.')} ${resolved}\n`)
    }
    for (const instance of instances) {
      if (typeof instance.installationPath !== 'string' || !instance.installationPath)
        throw new Error('missing instance path')
      const root = fs.realpathSync(instance.installationPath)
      roots.push(root)
      const toolsRoot = path.join(root, 'VC', 'Tools', 'MSVC')
      for (const version of directories(toolsRoot)) {
        if (!/^\d+\.\d+\.\d+$/.test(version)) continue
        const toolPath = fs.realpathSync(path.join(toolsRoot, version))
        const bin = path.join(toolPath, 'bin')
        const compilers = directories(bin).flatMap((host) =>
          directories(path.join(bin, host)).map((arch) => path.join(bin, host, arch, 'cl.exe'))
        )
        if (!compilers.some((file) => fs.existsSync(file) && fs.statSync(file).isFile()))
          throw new Error(`missing compiler in ${toolPath}`)
        if (!inventory.toolsets.some((entry) => canonical(entry.path) === canonical(toolPath))) {
          inventory.toolsets.push({ path: toolPath, version })
          process.stdout.write(`VC runtime toolset: ${version} ${toolPath}\n`)
        }
      }
      const redistRoot = path.join(root, 'VC', 'Redist', 'MSVC')
      for (const folder of directories(redistRoot)) {
        const tree = path.join(redistRoot, folder)
        redistRoots.push(tree)
        for (const arch of ['x64', 'arm64']) {
          const exe = path.join(tree, `vc_redist.${arch}.exe`)
          // Prefer the EXE; CRT DLLs belong to the same payload family.
          // https://learn.microsoft.com/en-us/cpp/windows/redistributing-visual-cpp-files
          if (fs.existsSync(exe)) readPayload(exe, arch, 'redist EXE')
          else {
            for (const crt of directories(path.join(tree, arch)).filter((name) =>
              /^Microsoft\.VC14.*CRT$/i.test(name)
            )) {
              const dll = path.join(tree, arch, crt, 'msvcp140.dll')
              if (fs.existsSync(dll)) readPayload(dll, arch, 'CRT DLL')
            }
          }
        }
      }
    }
    const allowedPaths = {
      vsinstalldir: roots,
      vcinstalldir: roots.map((root) => path.join(root, 'VC')),
      vctoolsinstalldir: inventory.toolsets.map((entry) => entry.path),
      vctoolsredistdir: redistRoots,
      gyp_msvs_override_path: roots
    }
    if (env.npm_config_msvs_version && /[\\/:]/.test(env.npm_config_msvs_version)) {
      allowedPaths.npm_config_msvs_version = roots
    }
    for (const [key, allowed] of Object.entries(allowedPaths)) {
      if (!env[key]) continue
      let selected
      try {
        selected = canonical(env[key])
      } catch {
        throw new Error(`unaccounted ${key}`)
      }
      if (!allowed.some((root) => fs.existsSync(root) && canonical(root) === selected))
        throw new Error(`unaccounted ${key}`)
    }
    if (env.vctoolsversion && !inventory.toolsets.some((entry) => entry.version === env.vctoolsversion))
      throw new Error('unaccounted VCToolsVersion')
    deriveRuntimeFloor(inventory)
    return inventory
  } catch (error) {
    if (error.message.startsWith('VC runtime floor generation failed:')) throw error
    throw incomplete(error.message)
  }
}

function prepareWindowsRuntimeFloor(
  { buildResourcesDir },
  { hostPlatform = process.platform, inspect = inspectWindowsMsvc } = {}
) {
  if (hostPlatform !== 'win32') {
    throw new Error(
      `VC runtime floor generation failed: Windows-target packaging requires a Windows host; cannot verify MSVC on ${hostPlatform}.`
    )
  }
  const output = path.join(buildResourcesDir, generatedFile)
  fs.rmSync(output, { force: true })
  const floor = deriveRuntimeFloor(inspect())
  fs.writeFileSync(output, renderRuntimeFloor(floor))
  process.stdout.write(`VC runtime floor: ${floor.major}.${floor.minor}.${floor.build}\n`)
  return floor
}

async function resolvePublishedPayloadVersion(url) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-runtime-payload-'))
  const file = path.join(dir, 'vc_redist.exe')
  const signal = AbortSignal.timeout(60_000)
  const visited = new Set()
  try {
    while (true) {
      if (visited.has(url) || visited.size >= 10) throw new Error('redirect loop or limit exceeded')
      visited.add(url)
      const response = await new Promise((resolve, reject) => {
        https.get(url, { signal }, resolve).on('error', reject)
      })
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.resume()
        if (!response.headers.location) throw new Error('redirect without Location')
        url = new URL(response.headers.location, url).href
        continue
      }
      if (response.statusCode !== 200) {
        response.resume()
        throw new Error(`HTTP ${response.statusCode}`)
      }
      await pipeline(response, fs.createWriteStream(file), { signal })
      return readPayloadVersion(file)
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

async function verifyWindowsRuntimePayload(floor, { arch, resolvePayloadVersion = resolvePublishedPayloadVersion }) {
  if (!['x64', 'arm64'].includes(arch)) throw new Error(`Unsupported Windows packaging architecture: ${arch}`)
  const url = `https://aka.ms/vs/17/release/vc_redist.${arch}.exe`
  const minimum = validateVersion([floor.major, floor.minor, floor.build])
  try {
    const version = await resolvePayloadVersion(url)
    if (
      !Array.isArray(version) ||
      version.length !== 4 ||
      !version.every((part) => Number.isInteger(part) && part >= 0 && part <= 65535) ||
      version[0] < 1
    ) {
      throw new Error('cannot read payload file version')
    }
    if (compare(version, minimum) < 0) {
      throw new Error(`payload ${version.join('.')} is older than required floor ${minimum.join('.')}`)
    }
  } catch (error) {
    throw new Error(`VC runtime payload verification failed for ${url}: ${error.message}`, { cause: error })
  }
}

module.exports = {
  verifyWindowsRuntimePayload,
  inspectWindowsMsvc,
  deriveRuntimeFloor,
  renderRuntimeFloor,
  prepareWindowsRuntimeFloor
}
