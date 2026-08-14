/**
 * Deterministic demo data for developing the panel without a running main process.
 * Used only when no PerfDevtoolsService websocket is reachable.
 */

;(function () {
  const SESSION_MS = 40000
  let nextId = 0

  function mulberry32(seed) {
    return function random() {
      seed |= 0
      seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  const rand = mulberry32(20260815)

  function pick(list) {
    return list[Math.floor(rand() * list.length)]
  }

  function span(track, name, startTime, duration, parentId, detail) {
    return { id: `s${nextId++}`, name, track, parentId, startTime, duration, detail }
  }

  /** Startup: unique names, real nesting — exercises the collapse-to-tree path. */
  function bootstrapSpans() {
    const out = []
    const boot = span('bootstrap', 'bootstrap', 0, 1284.3)
    out.push(boot)

    const background = span('bootstrap', 'phase:background', 2.1, 18.7, boot.id)
    const before = span('bootstrap', 'phase:beforeReady', 21.0, 340.2, boot.id)
    const when = span('bootstrap', 'phase:whenReady', 361.4, 922.8, boot.id)
    out.push(background, before, when)

    out.push(
      span('bootstrap', 'DbService.init', 22.4, 298.1, before.id, { migrations: 3 }),
      span('bootstrap', 'PreferenceService.init', 320.6, 12.4, before.id),
      span('bootstrap', 'CacheService.init', 333.1, 7.1, before.id),
      span('bootstrap', 'BootConfigService.init', 340.3, 2.0, before.id),
      span('bootstrap', 'KnowledgeService.init', 363.0, 511.9, when.id, { indexes: 7 }),
      span('bootstrap', 'MainWindowService.init', 875.2, 88.3, when.id),
      span('bootstrap', 'ShortcutService.init', 963.6, 4.1, when.id),
      span('bootstrap', 'TrayService.init', 967.8, 13.0, when.id),
      span('bootstrap', 'MCPService.init', 980.9, 140.2, when.id, { servers: 4 }),
      span('bootstrap', 'UpdateService.init', 1121.2, 8.4, when.id),
      span('bootstrap', 'SchedulerService.init', 1129.7, 3.2, when.id)
    )
    return out
  }

  /** Runtime: repeated names, no parents — exercises the grouping path. */
  function ipcSpans() {
    const out = []
    const channels = [
      { name: 'window.minimize', n: 88, base: 0.3, jitter: 1.8 },
      { name: 'window.setTitle', n: 64, base: 0.2, jitter: 0.9 },
      { name: 'shell.openExternal', n: 12, base: 1.4, jitter: 7.0 },
      { name: 'file.read', n: 52, base: 2.1, jitter: 9.0 },
      { name: 'notification.show', n: 28, base: 0.8, jitter: 2.2 }
    ]
    for (const channel of channels) {
      for (let i = 0; i < channel.n; i++) {
        const at = 1500 + rand() * (SESSION_MS - 1500)
        out.push(span('ipc', channel.name, at, channel.base + rand() * channel.jitter))
      }
    }
    // One channel with a few slow outliers — the case the max column exists for.
    for (const at of [18400, 25100, 32600]) {
      out.push(span('ipc', 'file.select', at, at === 18400 ? 184.2 : at === 25100 ? 42.1 : 1.9, undefined, {
        multi: at === 18400
      }))
    }
    return out
  }

  /** Bursty and numerous — exercises the density strip. */
  function dbSpans() {
    const out = []
    const statements = ['SELECT topics', 'SELECT messages', 'INSERT messages', 'UPDATE topics', 'SELECT blocks']
    const bursts = [3000, 9500, 15000, 22000, 27500, 34000]
    for (const burstAt of bursts) {
      const size = 120 + Math.floor(rand() * 110)
      for (let i = 0; i < size; i++) {
        const at = burstAt + rand() * 2200
        const slow = rand() > 0.985
        out.push(span('db', pick(statements), at, slow ? 12 + rand() * 30 : 0.2 + rand() * 2.4))
      }
    }
    for (let i = 0; i < 180; i++) {
      out.push(span('db', pick(statements), 1500 + rand() * (SESSION_MS - 1500), 0.2 + rand() * 1.6))
    }
    return out
  }

  /** Deliberately overlapping — exercises the merged-bar concurrency rendering. */
  function dataApiSpans() {
    const out = []
    const routes = ['GET /topics', 'GET /messages', 'POST /messages', 'GET /assistants']
    for (let i = 0; i < 74; i++) {
      out.push(span('dataapi', pick(routes), 1800 + rand() * (SESSION_MS - 1800), 1 + rand() * 14))
    }
    // Two concurrent clusters of the same route.
    for (const cluster of [4200, 21000]) {
      for (let i = 0; i < 4; i++) {
        out.push(span('dataapi', 'GET /topics', cluster + i * 260, 30 + rand() * 38))
      }
    }
    return out
  }

  function windowSpans() {
    const out = []
    const types = ['create:main', 'create:mini', 'create:selection']
    for (let i = 0; i < 12; i++) {
      out.push(span('window', pick(types), 2000 + rand() * (SESSION_MS - 2000), 18 + rand() * 110))
    }
    return out
  }

  /** Manual instrumentation with real parent/child nesting inside a repeated name. */
  function customSpans() {
    const out = []
    for (let i = 0; i < 14; i++) {
      const at = 12000 + i * 900 + rand() * 200
      const parent = span('custom', 'knowledge.embed', at, 52 + rand() * 44, undefined, { chunk: i })
      out.push(parent)
      const children = 1 + Math.floor(rand() * 2)
      for (let c = 0; c < children; c++) {
        out.push(span('custom', 'vector.upsert', at + 6 + c * 18, 9 + rand() * 22, parent.id))
      }
    }
    return out
  }

  function memorySamples() {
    const out = []
    let rss = 186 * 1024 * 1024
    let heap = 78 * 1024 * 1024
    for (let at = 0; at <= SESSION_MS; at += 2000) {
      // Knowledge embedding window pushes both up noticeably.
      const climbing = at >= 12000 && at <= 25000
      rss += (climbing ? 14 : 4) * 1024 * 1024 * (0.6 + rand() * 0.8)
      heap += (climbing ? 6 : 1.4) * 1024 * 1024 * (0.5 + rand())
      if (at === 26000) heap -= 22 * 1024 * 1024 // a GC
      out.push({
        at,
        rss: Math.round(rss),
        heapUsed: Math.round(heap),
        heapTotal: Math.round(heap * 1.35),
        external: Math.round(18 * 1024 * 1024),
        arrayBuffers: Math.round(6 * 1024 * 1024)
      })
    }
    return out
  }

  function processes() {
    return [
      { pid: 4821, type: 'Browser', name: 'main', cpuPercent: 3.2, memoryKb: 412 * 1024 },
      { pid: 4830, type: 'Tab', name: 'main window', cpuPercent: 11.8, memoryKb: 386 * 1024 },
      { pid: 4844, type: 'Tab', name: 'mini window', cpuPercent: 0.6, memoryKb: 74 * 1024 },
      { pid: 4826, type: 'GPU', name: undefined, cpuPercent: 1.1, memoryKb: 142 * 1024 },
      { pid: 4851, type: 'Utility', name: 'network', cpuPercent: 0.4, memoryKb: 48 * 1024 },
      { pid: 4863, type: 'Utility', name: 'storage', cpuPercent: 0.1, memoryKb: 22 * 1024 }
    ]
  }

  window.PerfFixtures = {
    build() {
      nextId = 0
      return {
        spans: [
          ...bootstrapSpans(),
          ...ipcSpans(),
          ...dbSpans(),
          ...dataApiSpans(),
          ...windowSpans(),
          ...customSpans()
        ],
        memory: memorySamples(),
        processes: processes()
      }
    }
  }
})()
