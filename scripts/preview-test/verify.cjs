const assert = require('node:assert/strict')
const { spawn, execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const net = require('node:net')
const path = require('node:path')
const { setTimeout: sleep } = require('node:timers/promises')
const { fileURLToPath } = require('node:url')
const [artifactPath, seedPath, head] = process.argv.slice(2)
const prerequisite = {
  version: '1.9.12',
  sha512: 'KxUIh8bapKKiCeXX0r97OMFe2o1SvZ1lUV7bw/Gc6YwaQecKKi9x1/L0EkyQuombtANNkUnmIRCy4ixNUDAiKA=='
}
const bridge = {
  version: '2.1.0',
  sha512: 'aAkLbyq81m5ofVFFH8DEN8xzMd1zKTarI53qrtRD6iTiTSNv606Tb95ajtCbpvwc04kC5ITZ7c7RIGqDhHZJxw=='
}
const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'))
const root = __dirname
const fixture = seed.fixture
const home = path.join(fixture, 'home')
const roaming = path.join(home, 'AppData', 'Roaming')
const local = path.join(home, 'AppData', 'Local')
const temp = path.join(fixture, 'temp')
const data = path.join(fixture, 'data')
const settingsPath = path.join(data, 'config.json')
const readSettings = () => JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
const initialSettings = readSettings()
assert.equal(initialSettings.tray, true)
assert.equal(initialSettings.trayOnClose, true)
const historyPath = path.join(data, 'version.log')
const history = fs.readFileSync(historyPath, 'utf8')
const originalExe = path.join(fixture, 'Cherry Studio Portable.exe')
const evidence = { fixture, head, priorHistory: history.trim().split(/\r?\n/) }
const artifact = path.resolve(artifactPath)
for (const dir of [roaming, local, temp]) fs.mkdirSync(dir, { recursive: true })
assert(!fs.existsSync(path.join(data, 'Data', 'cherrystudio.sqlite')))
fs.copyFileSync(artifact, originalExe)

const env = { ...process.env }
for (const key of Object.keys(env)) {
  if (/^(USERPROFILE|APPDATA|LOCALAPPDATA|TEMP|TMP|PSMODULEPATH|ELECTRON_RUN_AS_NODE)$/i.test(key)) delete env[key]
}
Object.assign(env, { USERPROFILE: home, APPDATA: roaming, LOCALAPPDATA: local, TEMP: temp, TMP: temp })
const checkHome = execFileSync(process.execPath, ['-p', 'require("node:os").homedir()'], { env, encoding: 'utf8' })
assert.equal(checkHome.trim().toLowerCase(), home.toLowerCase())

const getHash = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const targetHash = getHash(originalExe)
evidence.artifact = artifact
evidence.artifactSha256 = targetHash
const pidLive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
const poll = async (check, label, ms = 120000) => {
  const expires = Date.now() + ms
  let lastError
  do {
    try {
      const value = await check()
      if (value) return value
    } catch (error) {
      lastError = error
    }
    await sleep(400)
  } while (Date.now() < expires)
  throw new Error(`Timed out waiting for ${label}`, { cause: lastError })
}

async function reservePort() {
  const server = net.createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  await new Promise((resolve) => server.close(resolve))
  return port
}

function getListener(port) {
  const listeners = execFileSync('netstat.exe', ['-ano', '-p', 'tcp'], { encoding: 'utf8' })
  return listeners
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .find(([, address, , state]) => address === `127.0.0.1:${port}` && state === 'LISTENING')
}

async function main() {
  const port = await reservePort()
  const args = [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', '--lang=en-US']
  const log = fs.openSync(path.join(fixture, 'launcher.log'), 'w')
  const launcher = spawn(originalExe, args, { cwd: fixture, env, stdio: ['ignore', log, log] })
  launcher.on('error', (error) => {
    evidence.launchError = String(error)
  })
  fs.closeSync(log)
  evidence.launcherPid = launcher.pid
  evidence.cdpPort = port
  console.log('Started test fixture', fixture, launcher.pid, port)
  const endpoint = `http://127.0.0.1:${port}/json/list`
  const targets = async () => (await fetch(endpoint, { signal: AbortSignal.timeout(2000) })).json()
  let socket
  let call
  let target
  try {
    target = await poll(
      async () =>
        (await targets()).find(
          (entry) =>
            entry.type === 'page' &&
            entry.title === 'Cherry Studio' &&
            /\/legacyUpgrade\/index\.html(?:[?#].*)?$/.test(entry.url)
        ),
      'packaged legacy upgrade window'
    )
    assert(decodeURIComponent(target.url).toLowerCase().includes(temp.replaceAll('\\', '/').toLowerCase()))
    const listener = getListener(port)
    assert(listener, 'Missing loopback CDP listener')
    const electronPid = Number(listener.at(-1))
    const processInfo = JSON.parse(
      execFileSync(
        path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
        [
          '-NoProfile',
          '-Command',
          `[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); Get-CimInstance Win32_Process -Filter "ProcessId = ${electronPid}" | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress`
        ],
        { env, encoding: 'utf8', windowsHide: true }
      )
    )
    assert.equal(processInfo.ParentProcessId, launcher.pid)
    assert(processInfo.ExecutablePath.toLowerCase().startsWith(temp.toLowerCase() + '\\'))
    evidence.electronPid = electronPid
    evidence.target = target.url
    const resources = fileURLToPath(target.url).split(/[/\\]app\.asar[/\\]/)[0]
    evidence.updateConfigPresent = fs.existsSync(path.join(resources, 'app-update.yml'))
    fs.writeFileSync(
      path.join(fixture, 'instance.json'),
      JSON.stringify(
        {
          workspace: path.join(root, 'source'),
          head: evidence.head,
          policy: 'ephemeral',
          owner: 'agent',
          launch_purpose: 'pr-test:23998',
          workflow_relation: 'started',
          runner_pid: launcher.pid,
          electron_pid: electronPid,
          cdp_port: port,
          target_url: target.url,
          cwd: fixture,
          launch_command: [originalExe, ...args],
          log_path: path.join(data, 'logs'),
          start_time: new Date().toISOString()
        },
        null,
        2
      )
    )
    socket = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true })
      socket.addEventListener('error', reject, { once: true })
    })
    let id = 0
    call = async (method, params = {}) => {
      assert(pidLive(electronPid), 'Tracked Electron process has exited')
      assert((await targets()).some((entry) => entry.id === target.id && entry.url === target.url))
      return new Promise((resolve, reject) => {
        const requestId = ++id
        const receive = ({ data }) => {
          const reply = JSON.parse(data)
          if (reply.id !== requestId) return
          socket.removeEventListener('message', receive)
          clearTimeout(timeout)
          if (reply.error) reject(new Error(JSON.stringify(reply.error)))
          else resolve(reply.result)
        }
        const timeout = setTimeout(() => {
          socket.removeEventListener('message', receive)
          reject(new Error(`CDP timeout: ${method}`))
        }, 5000)
        socket.addEventListener('message', receive)
        socket.send(JSON.stringify({ id: requestId, method, params }))
      })
    }
    const evaluate = async (expression) => {
      const result = await call('Runtime.evaluate', { expression, returnByValue: true })
      assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails))
      return result.result.value
    }
    const snapshot = () =>
      evaluate(`({
      text: document.body.innerText,
      buttons: [...document.querySelectorAll('footer button')].map(b => ({ text: b.innerText, disabled: b.disabled })),
      status: document.querySelector('[role=status]')?.innerText
    })`)
    const capture = async (name) => {
      const result = await call('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(path.join(root, name), Buffer.from(result.data, 'base64'))
    }
    const click = async (index) => {
      const button = await evaluate(`(() => {
        const b = document.querySelectorAll('footer button')[${index}];
        if (!b || b.disabled) return null;
        setTimeout(() => b.click(), 0);
        return b.innerText;
      })()`)
      assert(button, 'Expected an enabled footer button')
      return button
    }
    evidence.initial = await poll(async () => {
      const state = await snapshot()
      return state.buttons.length === 2 && /install|安装/i.test(state.buttons[1].text) && state
    }, 'install button')
    assert.equal(evidence.initial.buttons[1].text, 'Install 1.9.12')
    assert.match(evidence.initial.text, /Quit it to automatically install and open 2\.1\.0/)
    await capture('portable-relay-initial.png')
    evidence.action = await click(1)
    evidence.installButtonClicks = 1
    const outcome = await poll(
      async () => {
        if (!pidLive(electronPid)) return 'old-exited'
        const state = await snapshot()
        if (/retry|重试/i.test(state.buttons[1]?.text) && !state.buttons[1].disabled) return 'install-failed'
        return false
      },
      'native handoff or an installer failure',
      300000
    )
    if (outcome === 'install-failed') {
      await capture('portable-relay-failed.png')
      const logs = path.join(data, 'logs')
      for (const name of fs.readdirSync(logs).filter((name) => name.startsWith('app-error.'))) {
        console.error(fs.readFileSync(path.join(logs, name), 'utf8'))
      }
      throw new Error('Installer exposed Retry')
    }
    await poll(() => !pidLive(launcher.pid), 'original portable wrapper exit', 25000)
    evidence.oldProcessExited = true
    const quotePs = (value) => "'" + value.replaceAll("'", "''") + "'"
    const locateRelaunch = (wrapperFile) => `[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false);
        $target = ${quotePs(wrapperFile)};
        $root = ${quotePs(temp + '\\')};
        $wrappers = @(Get-CimInstance Win32_Process -Filter ${quotePs("Name = '" + path.basename(wrapperFile) + "'")} |
          Where-Object { $_.ExecutablePath -eq $target });
        foreach ($wrapper in $wrappers) {
          $main = Get-CimInstance Win32_Process -Filter "ParentProcessId = $($wrapper.ProcessId)" |
            Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -and
              $_.CommandLine -notmatch '--type=' } | Select-Object -First 1;
          if ($main) {
            [pscustomobject]@{ wrapperPid = $wrapper.ProcessId; electronPid = $main.ProcessId; executablePath = $main.ExecutablePath;
              version = (Get-Item -LiteralPath $main.ExecutablePath).VersionInfo.ProductVersion } | ConvertTo-Json -Compress;
            break
          }
        }`
    const windowsPowerShell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe')
    const runPowerShell = (command) =>
      execFileSync(windowsPowerShell, ['-NoProfile', '-Command', command], {
        env,
        encoding: 'utf8',
        windowsHide: true
      }).trim()
    const hashAt = (file) => createHash('sha512').update(fs.readFileSync(file)).digest('base64')
    async function verifyRelaunch(stage, previousPid, wrapperFile) {
      await poll(() => hashAt(wrapperFile) === stage.sha512, `exact ${stage.version} EXE at ${wrapperFile}`, 95000)
      const relaunch = await poll(
        () => {
          const result = runPowerShell(locateRelaunch(wrapperFile))
          return result && JSON.parse(result)
        },
        `automatic ${stage.version} relaunch`,
        90000
      )
      const productVersion = relaunch.version.split(/[ +]/)[0]
      assert([stage.version, `${stage.version}.0`].includes(productVersion), productVersion)
      assert.notEqual(relaunch.electronPid, previousPid)
      return relaunch
    }

    const stagedExe = await poll(
      () =>
        fs
          .readdirSync(fixture)
          .find(
            (name) => name.startsWith(path.basename(originalExe) + '.update-') && /-[a-f0-9-]{36}\.exe$/i.test(name)
          ),
      'staged prerequisite executable'
    )
    const stagedPath = path.join(fixture, stagedExe)
    evidence.prerequisite = await verifyRelaunch(prerequisite, electronPid, stagedPath)
    evidence.recordedHistory = await poll(
      () => {
        const updated = fs.readFileSync(historyPath, 'utf8')
        assert(updated.startsWith(history), 'Original version log was modified')
        const entries = updated.trim().split(/\r?\n/)
        return entries.at(-1).startsWith('1.9.12|win|prod|packaged|portable|') && entries
      },
      '1.9.12 recording its startup in the same data directory',
      90000
    )
    const old = evidence.prerequisite
    assert.equal(getHash(originalExe), targetHash, 'Original launcher was replaced before 1.9.12 exited')
    evidence.prerequisiteSha512 = prerequisite.sha512
    evidence.temporaryTrayOnClose = readSettings().trayOnClose
    assert.equal(evidence.temporaryTrayOnClose, false)
    assert.equal(readSettings().tray, true)
    const clickClose = () => {
      const result = execFileSync(
        windowsPowerShell,
        [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          path.join(root, 'migration-fixtures', 'close-prerequisite.ps1'),
          '-ProcessId',
          String(old.electronPid),
          '-Executable',
          old.executablePath
        ],
        { env, encoding: 'utf8', windowsHide: true }
      ).trim()
      return result && JSON.parse(result)
    }
    evidence.closeButton = await poll(clickClose, '1.9.12 top-right Close button', 60000)
    assert.equal(evidence.closeButton.pid, old.electronPid)
    await poll(() => !pidLive(old.electronPid) && !pidLive(old.wrapperPid), 'graceful exit of 1.9.12', 45000)
    evidence.prerequisiteExited = true

    evidence.relaunch = await verifyRelaunch(bridge, old.electronPid, originalExe)
    const restoredSettings = readSettings()
    for (const key of ['tray', 'trayOnClose', 'portableMigrationFixture']) {
      assert.equal(restoredSettings[key], initialSettings[key], `Changed original setting: ${key}`)
    }
    assert(!fs.existsSync(settingsPath + '.portable-migration.json'), 'Settings backup was not removed')
    evidence.originalTraySettings = { tray: initialSettings.tray, trayOnClose: initialSettings.trayOnClose }
    evidence.restoredTraySettings = { tray: restoredSettings.tray, trayOnClose: restoredSettings.trayOnClose }
    evidence.replacedWithExactGitCodeExecutable = true
    evidence.replacementSha512 = bridge.sha512
    evidence.portablePath = originalExe
    fs.writeFileSync(path.join(root, 'migration-fixtures', 'relaunch-2.1.0.json'), JSON.stringify(evidence, null, 2))
    console.log('Verified automatic 1.9.12 to 2.1.0 handoff', evidence.relaunch)
  } finally {
    if (call && evidence.electronPid && pidLive(evidence.electronPid)) {
      try {
        await call('Runtime.evaluate', {
          expression: `(() => {
            const button = document.querySelector('footer button');
            if (!button?.disabled && /quit|退出/i.test(button?.innerText ?? '')) setTimeout(() => button.click(), 0);
          })()`
        })
        await poll(
          () => !pidLive(evidence.electronPid) && !pidLive(launcher.pid),
          'test app exit after an error',
          10000
        )
        evidence.exited = true
      } catch (error) {
        evidence.cleanupError = String(error)
      }
    }
    socket?.close()
    fs.writeFileSync(path.join(root, 'portable-relay-result.json'), JSON.stringify(evidence, null, 2))
    if (launcher.exitCode === null) launcher.unref()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
