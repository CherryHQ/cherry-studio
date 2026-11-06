export const MAC_EXTERNAL_APP_SCRIPT = String.raw`
ObjC.import('AppKit')
ObjC.import('Foundation')
ObjC.import('CoreGraphics')

function run(argv) {
  const request = JSON.parse(argv[0])
  const target = request.target
  const originalDirectory = target.directory
  const events = Application('System Events')
  let bundles = target.kind === 'document'
    ? { Preview: ['com.apple.Preview'], Pages: ['com.apple.iWork.Pages'], TextEdit: ['com.apple.TextEdit'] }[target.application]
    : target.kind === 'folder' ? ['com.apple.finder']
    : target.kind === 'terminal' ? ['com.apple.Terminal']
    : target.kind === 'settings' ? ['com.apple.systempreferences']
    : ['com.apple.Safari', 'com.google.Chrome', 'com.microsoft.edgemac', 'com.brave.Browser']
  if (target.kind === 'browser') {
    let bundle = target.application
    if (!bundle) {
      const url = $.NSWorkspace.sharedWorkspace.URLForApplicationToOpenURL($.NSURL.URLWithString('https://example.invalid'))
      bundle = ObjC.unwrap($.NSBundle.bundleWithURL(url).bundleIdentifier)
    }
    if (bundles.indexOf(bundle) < 0) throw new Error('Default browser does not support safe tab cleanup: ' + bundle)
    bundles = [bundle]
  }
  const handles = {}
  const processes = {}
  function value(read, fallback) { try { return read() } catch (_) { return fallback } }
  function path(url) {
    return value(() => ObjC.unwrap($(decodeURIComponent(String(url)).replace(/^file:\/\//, '')).stringByResolvingSymlinksInPath).replace(/\/$/, ''), '')
  }
  if (target.path) target.path = path(target.path)
  if (target.directory) target.directory = path(target.directory)
  const shell = Application.currentApplication()
  shell.includeStandardAdditions = true
  function containsTerminalDirectory(text) {
    return [target.directory, originalDirectory].some(directory => {
      for (let index = text.indexOf(directory); index >= 0; index = text.indexOf(directory, index + 1)) {
        const next = text[index + directory.length]
        if (next === undefined || !/[A-Za-z0-9._-]/.test(next)) return true
      }
      return false
    })
  }
  function terminalTabMatches(tab) {
    if (containsTerminalDirectory(tab.contents())) return true
    const tty = tab.tty().replace(/^\/dev\//, '')
    if (!/^ttys[0-9]+$/.test(tty)) return false
    const pids = value(() => shell.doShellScript('/bin/ps -t ' + tty + ' -o pid='), '').trim().split(/\s+/)
    return pids.some(pid => {
      if (!/^[0-9]+$/.test(pid)) return false
      const cwd = value(() => shell.doShellScript('/usr/sbin/lsof -a -p ' + pid + ' -d cwd -Fn'), '')
      return cwd.split(/[\r\n]+/).some(line => line[0] === 'n' && path(line.slice(1)) === target.directory)
    })
  }
  function dismissCloseConfirmation(window) {
    delay(0.2)
    for (const sheet of value(() => window.sheets(), [])) {
      for (const button of sheet.buttons()) {
        if (['Delete', 'Don’t Save', "Don't Save", '不存储', '不保存', 'Terminate', '终止'].indexOf(button.name()) >= 0)
          button.click()
      }
    }
  }
  function inspect() {
    const result = { processes: [], windows: [] }
    if (target.kind === 'browser') result.browserApplication = bundles[0]
    const apps = $.NSWorkspace.sharedWorkspace.runningApplications
    for (let index = 0; index < apps.count; index++) {
      const running = apps.objectAtIndex(index)
      const bundle = ObjC.unwrap(running.bundleIdentifier)
      if (bundles.indexOf(bundle) < 0 || running.terminated) continue
      const pid = Number(running.processIdentifier)
      const startedAt = String(running.launchDate.timeIntervalSince1970)
      const process = { pid, startedAt, application: bundle, shared: bundle === 'com.apple.finder' }
      result.processes.push(process)
      processes[pid] = running
      const prefix = pid + ':' + startedAt + ':'
      const ui = events.processes.whose({ unixId: pid })()[0]
      if (!ui) continue
      const windows = ui.windows()
      if (target.kind === 'browser') {
        const browser = Application(bundle)
        for (const window of browser.windows()) {
          for (const tab of window.tabs()) {
            const title = bundle === 'com.apple.Safari' ? tab.name() : tab.title()
            const tabId = value(() => tab.id(), tab.url())
            const id = prefix + 'tab:' + window.id() + ':' + tabId
            result.windows.push({ id, pid, matches: title.indexOf(target.title) >= 0 })
            handles[id] = { close: () => tab.close() }
          }
        }
        continue
      }
      if (target.kind === 'folder') {
        const finder = Application('Finder')
        const directory = target.path.replace(/\/[^/]+$/, '')
        for (const window of finder.windows()) {
          const id = prefix + 'finder:' + window.id()
          result.windows.push({ id, pid, matches: path(value(() => window.target().url(), '')) === directory })
          handles[id] = { close: () => window.close() }
        }
        continue
      }
      if (target.kind === 'document' && target.application === 'Pages') {
        for (const document of Application(bundle).documents()) {
          const id = prefix + 'document:' + document.id()
          const file = value(() => String(document.file()), '')
          const name = document.name()
          const filename = target.path.slice(target.path.lastIndexOf('/') + 1)
          result.windows.push({ id, pid, matches: path(file) === target.path ||
            name === filename || name === filename.replace(/\.docx$/, '') })
          handles[id] = { close: () => document.close({ saving: 'no' }) }
        }
      }
      for (const window of windows) {
        const title = value(() => window.name(), '')
        const document = value(() => window.attributes.byName('AXDocument').value(), '')
        let candidates = []
        for (let attempt = 0; attempt < 15; attempt++) {
          const position = window.position()
          const size = window.size()
          const desktopWindows = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(0, 0)))
          const applicationWindows = desktopWindows.filter(candidate => candidate.kCGWindowOwnerPID === pid && candidate.kCGWindowLayer === 0)
          candidates = applicationWindows.filter(candidate => {
            const bounds = candidate.kCGWindowBounds
            return Math.abs(bounds.X - position[0]) < 2 && Math.abs(bounds.Y - position[1]) < 2 &&
              Math.abs(bounds.Width - size[0]) < 2 && Math.abs(bounds.Height - size[1]) < 2
          })
          const named = applicationWindows.filter(candidate => title && candidate.kCGWindowName === title)
          if (candidates.length !== 1 && named.length === 1) candidates = named
          if (candidates.length === 1) break
          delay(0.1)
        }
        if (candidates.length !== 1) throw new Error('External window identity is ambiguous for application ' + pid)
        const number = candidates[0].kCGWindowNumber
        const id = prefix + 'window:' + number
        let matches = target.kind === 'settings'
        if (target.kind === 'document') matches = path(document) === target.path
        if (target.kind === 'terminal') {
          matches = path(document) === target.directory
          if (!matches) {
            const containsDirectory = (element, depth) => {
              if (element.role() === 'AXTextArea') {
                const text = String(element.value())
                return containsTerminalDirectory(text)
              }
              return depth < 8 && element.uiElements().some(child => containsDirectory(child, depth + 1))
            }
            matches = containsDirectory(window, 0)
          }
          const terminalWindow = Application('com.apple.Terminal').windows.byId(number)
          if (terminalWindow.exists()) {
            const tabs = terminalWindow.tabs()
            matches = tabs.length > 0 && tabs.every(terminalTabMatches)
          }
        }
        if (target.kind === 'browser') matches = title.indexOf(target.title) >= 0
        result.windows.push({ id, pid, matches })
        handles[id] = { close: () => {
          if (target.kind === 'terminal') {
            const terminalWindow = Application('com.apple.Terminal').windows.byId(number)
            if (terminalWindow.exists()) {
              terminalWindow.close({ saving: 'no' })
              dismissCloseConfirmation(window)
              return
            }
          }
          if (target.kind === 'document' && target.application === 'Pages') {
            for (const document of Application(bundle).documents()) {
              if (path(value(() => String(document.file()), '')) === target.path) document.close({ saving: 'no' })
            }
            return
          }
          const buttons = window.buttons.whose({ subrole: 'AXCloseButton' })()
          if (!buttons.length) throw new Error('External window has no close button: ' + id)
          buttons[0].click()
          dismissCloseConfirmation(window)
        } }
      }
    }
    return result
  }
  let snapshot = inspect()
  if (request.action === 'inspect') return JSON.stringify(snapshot)
  const expected = request.process
  const current = snapshot.processes.find(process => process.pid === expected.pid && process.startedAt === expected.startedAt)
  if (!current) return JSON.stringify(snapshot)
  if (request.action === 'close') {
    const handle = handles[request.window.id]
    if (handle) handle.close()
  } else {
    if (current.shared) throw new Error('Refusing to terminate Finder')
    if (snapshot.windows.some(window => window.pid === current.pid && request.owned.indexOf(window.id) < 0))
      throw new Error('External application contains unrelated windows')
    const running = processes[current.pid]
    if (request.action === 'force') running.forceTerminate
    else running.terminate
  }
  const deadline = Date.now() + 3000
  do {
    delay(0.1)
    snapshot = inspect()
    if (request.action === 'close'
      ? !snapshot.windows.some(window => window.id === request.window.id)
      : !snapshot.processes.some(process => process.pid === expected.pid && process.startedAt === expected.startedAt)) break
  } while (Date.now() < deadline)
  return JSON.stringify(snapshot)
}
`
