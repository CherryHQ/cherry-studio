/* global chrome, PerfFixtures */

const PERF_DEVTOOLS_PORT = 38998
const RECONNECT_INTERVAL_MS = 1000
/** A track with more spans than this draws a density strip instead of one bar each. */
const DENSITY_MIN_SPANS = 400
const DENSITY_BUCKETS = 240
/** Instances listed under one group row before truncating. */
const MAX_INSTANCE_ROWS = 200
/** Total rows rendered in one pass — the backstop when many tracks are expanded at once. */
const MAX_RENDERED_ROWS = 1200
/** Spans at or above this duration render in the warning color. */
const SLOW_MS = 50

const TRACKS = [
  { key: 'bootstrap', label: '⚡ Bootstrap' },
  { key: 'ipc', label: '🔌 IPC' },
  { key: 'db', label: '🗃 Database' },
  { key: 'dataapi', label: '🌐 DataApi' },
  { key: 'window', label: '🪟 Windows' },
  { key: 'custom', label: '📌 Custom' }
]

const el = {
  live: document.getElementById('live'),
  clear: document.getElementById('clear'),
  filter: document.getElementById('filter'),
  threshold: document.getElementById('threshold'),
  resetZoom: document.getElementById('reset-zoom'),
  count: document.getElementById('count'),
  status: document.getElementById('status'),
  overview: document.getElementById('overview'),
  overviewCanvas: document.getElementById('overview-canvas'),
  brush: document.getElementById('brush'),
  ruler: document.getElementById('ruler'),
  rows: document.getElementById('rows'),
  memoryChart: document.getElementById('memory-chart'),
  memoryCanvas: document.getElementById('memory-canvas'),
  memoryCursor: document.getElementById('memory-cursor'),
  memRss: document.getElementById('mem-rss'),
  memHeap: document.getElementById('mem-heap'),
  detail: document.getElementById('detail'),
  processes: document.getElementById('processes'),
  refreshProcesses: document.getElementById('refresh-processes')
}

const store = { spans: [], memory: [], processes: [] }
const ui = {
  live: true,
  filter: '',
  threshold: 0,
  expanded: new Set(['track:bootstrap']),
  selected: null,
  /** null = full extent */
  domain: null
}

let socket = null
let nodeIndex = new Map()

/* ------------------------------------------------------------------ format */

function formatMs(value) {
  if (value === undefined || value === null) return '–'
  if (value >= 1000) return `${(value / 1000).toFixed(2)}s`
  if (value >= 100) return `${value.toFixed(0)}ms`
  return `${value.toFixed(1)}ms`
}

function formatOffset(value) {
  return `+${formatMs(value)}`
}

function formatBytes(bytes) {
  if (!bytes) return '–'
  const mb = bytes / (1024 * 1024)
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(0)} MB`
}

/* -------------------------------------------------------------------- data */

function trackLabel(key) {
  const track = TRACKS.find((item) => item.key === key)
  return track ? track.label : key
}

function stats(spans) {
  if (spans.length === 0) return { count: 0, avg: 0, max: 0, total: 0 }
  let total = 0
  let max = 0
  for (const span of spans) {
    total += span.duration
    if (span.duration > max) max = span.duration
  }
  return { count: spans.length, avg: total / spans.length, max, total }
}

function fullExtent() {
  if (store.spans.length === 0) return { start: 0, end: 1 }
  let start = Infinity
  let end = -Infinity
  for (const span of store.spans) {
    if (span.startTime < start) start = span.startTime
    if (span.startTime + span.duration > end) end = span.startTime + span.duration
  }
  for (const sample of store.memory) {
    if (sample.at < start) start = sample.at
    if (sample.at > end) end = sample.at
  }
  return end > start ? { start, end } : { start, end: start + 1 }
}

function domain() {
  return ui.domain ?? fullExtent()
}

function visibleSpans() {
  const query = ui.filter.trim().toLowerCase()
  return store.spans.filter((span) => {
    if (span.duration < ui.threshold) return false
    if (!query) return true
    return span.name.toLowerCase().includes(query) || trackLabel(span.track).toLowerCase().includes(query)
  })
}

/**
 * Group name-identical siblings, but only within the same parent scope. A group
 * holding a single instance collapses away so a genuinely nested track (bootstrap)
 * renders as a plain tree with no redundant layer.
 */
function buildGroups(siblings, childrenOf, scopeKey) {
  const byName = new Map()
  for (const span of siblings) {
    const bucket = byName.get(span.name)
    if (bucket) bucket.push(span)
    else byName.set(span.name, [span])
  }

  const nodes = []
  for (const [name, spans] of byName) {
    if (spans.length === 1) {
      nodes.push(instanceNode(spans[0], childrenOf))
      continue
    }
    nodes.push({
      kind: 'group',
      key: `group:${scopeKey}:${name}`,
      label: name,
      spans,
      stats: stats(spans),
      children: spans.map((span) => instanceNode(span, childrenOf))
    })
  }
  // Timeline order — keeps a genuinely nested track (bootstrap) reading as a gantt tree.
  return nodes.sort((a, b) => a.spans[0].startTime - b.spans[0].startTime)
}

function instanceNode(span, childrenOf) {
  const children = childrenOf(span.id)
  return {
    kind: 'instance',
    key: span.id,
    label: span.name,
    span,
    spans: [span],
    stats: { count: 1, avg: span.duration, max: span.duration, total: span.duration },
    children: children.length > 0 ? buildGroups(children, childrenOf, span.id) : []
  }
}

function buildTree() {
  const spans = visibleSpans()
  const present = new Set(spans.map((span) => span.id))
  const byParent = new Map()
  const rootsByTrack = new Map()

  for (const span of spans) {
    // A span whose parent was filtered out is reparented to its track root.
    if (span.parentId && present.has(span.parentId)) {
      const bucket = byParent.get(span.parentId)
      if (bucket) bucket.push(span)
      else byParent.set(span.parentId, [span])
    } else {
      const bucket = rootsByTrack.get(span.track)
      if (bucket) bucket.push(span)
      else rootsByTrack.set(span.track, [span])
    }
  }

  const childrenOf = (id) => byParent.get(id) ?? []
  const spansByTrack = new Map()
  for (const span of spans) {
    const bucket = spansByTrack.get(span.track)
    if (bucket) bucket.push(span)
    else spansByTrack.set(span.track, [span])
  }

  return TRACKS.filter((track) => spansByTrack.has(track.key)).map((track) => {
    const all = spansByTrack.get(track.key)
    return {
      kind: 'track',
      key: `track:${track.key}`,
      label: track.label,
      track: track.key,
      spans: all,
      stats: stats(all),
      children: buildGroups(rootsByTrack.get(track.key) ?? [], childrenOf, track.key)
    }
  })
}

/* ----------------------------------------------------------------- render */

/**
 * A filter narrows the set to what the user asked to see, so everything surviving it
 * is expanded — otherwise matches stay hidden inside collapsed tracks and the filter
 * looks broken.
 */
function isNarrowed() {
  return ui.filter.trim() !== '' || ui.threshold > 0
}

function isExpanded(key) {
  return isNarrowed() || ui.expanded.has(key)
}

function positionOf(value) {
  const view = domain()
  return ((value - view.start) / (view.end - view.start)) * 100
}

function renderRuler() {
  const view = domain()
  const span = view.end - view.start
  el.ruler.textContent = ''
  for (let i = 0; i <= 4; i++) {
    const tick = document.createElement('span')
    tick.className = 'tick'
    tick.style.left = `${i * 20}%`
    tick.textContent = formatMs(view.start + span * i * 0.2)
    el.ruler.append(tick)
  }
}

function densityBars(spans) {
  const view = domain()
  const width = (view.end - view.start) / DENSITY_BUCKETS
  const buckets = new Array(DENSITY_BUCKETS).fill(0)
  let peak = 0

  for (const span of spans) {
    const index = Math.floor((span.startTime - view.start) / width)
    if (index < 0 || index >= DENSITY_BUCKETS) continue
    buckets[index] += 1
    if (buckets[index] > peak) peak = buckets[index]
  }
  if (peak === 0) return []

  const nodes = []
  for (let i = 0; i < DENSITY_BUCKETS; i++) {
    if (buckets[i] === 0) continue
    const bar = document.createElement('i')
    bar.className = 'density'
    bar.style.left = `${(i / DENSITY_BUCKETS) * 100}%`
    bar.style.width = `${100 / DENSITY_BUCKETS}%`
    bar.style.opacity = String(0.25 + 0.75 * (buckets[i] / peak))
    nodes.push(bar)
  }
  return nodes
}

function spanBars(spans, merged) {
  const view = domain()
  const nodes = []
  for (const span of spans) {
    const left = positionOf(span.startTime)
    const width = (span.duration / (view.end - view.start)) * 100
    if (left > 100 || left + width < 0) continue

    const bar = document.createElement('i')
    bar.className = 'bar'
    if (merged) bar.classList.add('is-merged')
    if (span.duration >= SLOW_MS) bar.classList.add('is-slow')
    bar.style.left = `${Math.max(0, left)}%`
    bar.style.width = `${Math.max(0.15, Math.min(100 - Math.max(0, left), width))}%`
    bar.title = `${span.name} · ${formatMs(span.duration)} @ ${formatOffset(span.startTime)}`

    // Only label bars wide enough to hold text.
    if (!merged && width > 12) {
      const label = document.createElement('span')
      label.className = 'bar-label'
      label.textContent = `${span.name} · ${formatMs(span.duration)}`
      bar.append(label)
    }
    nodes.push(bar)
  }
  return nodes
}

function renderRow(node, depth) {
  const row = document.createElement('div')
  row.className = 'row'
  row.dataset.key = node.key
  if (node.kind === 'track') row.classList.add('is-track')
  if (ui.selected === node.key) row.classList.add('is-selected')

  const name = document.createElement('div')
  name.className = 'cell-name'
  name.style.paddingLeft = `${8 + depth * 14}px`

  const twisty = document.createElement('span')
  twisty.className = 'twisty'
  const expandable = node.children.length > 0
  if (expandable) {
    twisty.textContent = isExpanded(node.key) ? '▾' : '▸'
    twisty.addEventListener('click', (event) => {
      event.stopPropagation()
      toggleExpanded(node.key)
    })
  } else {
    twisty.classList.add('is-leaf')
    twisty.textContent = '·'
  }
  name.append(twisty, document.createTextNode(node.label))

  const count = document.createElement('div')
  count.className = 'cell-num'
  count.textContent = node.kind === 'instance' ? '' : String(node.stats.count)

  const avg = document.createElement('div')
  avg.className = 'cell-num'
  avg.textContent = node.kind === 'instance' ? '' : formatMs(node.stats.avg)

  const max = document.createElement('div')
  max.className = 'cell-num is-duration'
  if (node.stats.max >= SLOW_MS) max.classList.add('is-slow')
  max.textContent = formatMs(node.stats.max)

  const bars = document.createElement('div')
  bars.className = 'cell-bars'
  if (node.kind === 'instance') {
    bars.append(...spanBars(node.spans, false))
  } else if (node.spans.length > DENSITY_MIN_SPANS) {
    bars.append(...densityBars(node.spans))
  } else {
    bars.append(...spanBars(node.spans, true))
  }

  row.append(name, count, avg, max, bars)
  row.addEventListener('click', () => select(node.key))
  return row
}

function flatten(nodes, depth, out) {
  for (const node of nodes) {
    out.push({ node, depth })
    if (!isExpanded(node.key)) continue

    if (node.kind === 'group' && node.children.length > MAX_INSTANCE_ROWS) {
      for (const child of node.children.slice(0, MAX_INSTANCE_ROWS)) out.push({ node: child, depth: depth + 1 })
      out.push({ truncated: node.children.length - MAX_INSTANCE_ROWS, depth: depth + 1 })
      continue
    }
    flatten(node.children, depth + 1, out)
  }
  return out
}

function renderRows() {
  const tree = buildTree()
  nodeIndex = new Map()
  indexNodes(tree)

  const fragment = document.createDocumentFragment()
  const all = flatten(tree, 0, [])
  const flat = all.slice(0, MAX_RENDERED_ROWS)
  const hiddenRows = all.length - flat.length

  if (flat.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'empty'
    empty.textContent = store.spans.length === 0 ? 'No spans recorded yet.' : 'No spans match the current filter.'
    fragment.append(empty)
  }

  for (const entry of flat) {
    if (entry.truncated) {
      const row = document.createElement('div')
      row.className = 'row'
      const name = document.createElement('div')
      name.className = 'cell-name'
      name.style.paddingLeft = `${8 + entry.depth * 14}px`
      name.style.opacity = '0.6'
      name.textContent = `⋮ ${entry.truncated} more`
      row.append(name)
      fragment.append(row)
      continue
    }
    fragment.append(renderRow(entry.node, entry.depth))
  }

  if (hiddenRows > 0) {
    const notice = document.createElement('div')
    notice.className = 'empty'
    notice.textContent = `⋮ ${hiddenRows} more rows hidden — collapse a track or narrow the filter`
    fragment.append(notice)
  }

  el.rows.textContent = ''
  el.rows.append(fragment)
  el.count.textContent = `${store.spans.length} spans · ${tree.length} tracks`
}

function indexNodes(nodes) {
  for (const node of nodes) {
    nodeIndex.set(node.key, node)
    indexNodes(node.children)
  }
}

/* --------------------------------------------------------------- canvases */

function sizeCanvas(canvas) {
  const ratio = window.devicePixelRatio || 1
  const rect = canvas.getBoundingClientRect()
  canvas.width = Math.max(1, Math.round(rect.width * ratio))
  canvas.height = Math.max(1, Math.round(rect.height * ratio))
  const context = canvas.getContext('2d')
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  return { context, width: rect.width, height: rect.height }
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

function renderOverview() {
  const { context, width, height } = sizeCanvas(el.overviewCanvas)
  context.clearRect(0, 0, width, height)
  if (store.spans.length === 0) return

  const extent = fullExtent()
  const scale = (value) => ((value - extent.start) / (extent.end - extent.start)) * width
  const tracks = TRACKS.filter((track) => store.spans.some((span) => span.track === track.key))
  const laneHeight = 4
  const gap = 2
  const top = 4

  context.fillStyle = `rgba(${cssVar('--color-bar')}, 0.75)`
  tracks.forEach((track, index) => {
    const y = top + index * (laneHeight + gap)
    for (const span of store.spans) {
      if (span.track !== track.key) continue
      const x = scale(span.startTime)
      const w = Math.max(1, (span.duration / (extent.end - extent.start)) * width)
      context.fillRect(x, y, w, laneHeight)
    }
  })

  if (store.memory.length > 1) {
    const peak = Math.max(...store.memory.map((sample) => sample.rss))
    context.strokeStyle = cssVar('--color-rss')
    context.lineWidth = 1.2
    context.globalAlpha = 0.85
    context.beginPath()
    store.memory.forEach((sample, index) => {
      const x = scale(sample.at)
      const y = height - (sample.rss / peak) * (height - 6) - 2
      if (index === 0) context.moveTo(x, y)
      else context.lineTo(x, y)
    })
    context.stroke()
    context.globalAlpha = 1
  }

  if (ui.domain) {
    el.brush.hidden = false
    const left = ((ui.domain.start - extent.start) / (extent.end - extent.start)) * 100
    const right = ((ui.domain.end - extent.start) / (extent.end - extent.start)) * 100
    el.brush.style.left = `${left}%`
    el.brush.style.width = `${Math.max(0.5, right - left)}%`
  } else {
    el.brush.hidden = true
  }
  el.resetZoom.hidden = !ui.domain
}

function renderMemory() {
  const { context, width, height } = sizeCanvas(el.memoryCanvas)
  context.clearRect(0, 0, width, height)

  const latest = store.memory[store.memory.length - 1]
  el.memRss.textContent = latest ? `rss ${formatBytes(latest.rss)}` : 'rss –'
  el.memHeap.textContent = latest ? `heapUsed ${formatBytes(latest.heapUsed)}` : 'heapUsed –'
  if (store.memory.length < 2) return

  const view = domain()
  const peak = Math.max(...store.memory.map((sample) => sample.rss)) * 1.05
  const line = (key, color) => {
    context.strokeStyle = color
    context.lineWidth = 1.5
    context.beginPath()
    let started = false
    for (const sample of store.memory) {
      const x = ((sample.at - view.start) / (view.end - view.start)) * width
      const y = height - (sample[key] / peak) * (height - 8) - 4
      if (!started) {
        context.moveTo(x, y)
        started = true
      } else {
        context.lineTo(x, y)
      }
    }
    context.stroke()
  }

  line('rss', cssVar('--color-rss'))
  line('heapUsed', cssVar('--color-heap'))
}

function renderProcesses() {
  el.processes.textContent = ''
  for (const process of store.processes) {
    const row = document.createElement('tr')
    const name = document.createElement('td')
    name.textContent = process.name ? `${process.type} · ${process.name}` : process.type
    const cpu = document.createElement('td')
    cpu.className = 'right cpu'
    cpu.textContent = `${process.cpuPercent.toFixed(1)}%`
    const memory = document.createElement('td')
    memory.className = 'right mem'
    memory.textContent = formatBytes(process.memoryKb * 1024)
    row.append(name, cpu, memory)
    el.processes.append(row)
  }
}

/* ----------------------------------------------------------------- detail */

function renderDetail() {
  const node = ui.selected ? nodeIndex.get(ui.selected) : null
  if (!node) {
    el.detail.textContent = 'Select a track, group, or span.'
    return
  }

  el.detail.textContent = ''
  const line = (html) => {
    const div = document.createElement('div')
    div.innerHTML = html
    el.detail.append(div)
    return div
  }

  if (node.kind === 'instance') {
    const span = node.span
    line(`<strong>${span.name}</strong> &nbsp;<span>${trackLabel(span.track)}</span>`)
    line(`id <strong>${span.id}</strong>`)
    line(`duration <strong>${formatMs(span.duration)}</strong> &nbsp; start <strong>${formatOffset(span.startTime)}</strong>`)
    line(`parent <strong>${span.parentId ?? '—'}</strong> &nbsp; children <strong>${node.children.length}</strong>`)
    if (span.detail) line(`detail <strong>${escapeHtml(JSON.stringify(span.detail))}</strong>`)
    return
  }

  line(`<strong>${node.label}</strong>`)
  line(
    `count <strong>${node.stats.count}</strong> &nbsp; avg <strong>${formatMs(node.stats.avg)}</strong>` +
      ` &nbsp; max <strong>${formatMs(node.stats.max)}</strong> &nbsp; total <strong>${formatMs(node.stats.total)}</strong>`
  )

  const list = document.createElement('div')
  list.className = 'instances'
  const sorted = [...node.spans].sort((a, b) => b.duration - a.duration).slice(0, 12)
  for (const span of sorted) {
    const item = document.createElement('div')
    item.className = 'instance'
    item.innerHTML =
      `<strong>${formatMs(span.duration)}</strong> @ ${formatOffset(span.startTime)} · ${escapeHtml(span.name)}` +
      (span.detail ? ` · ${escapeHtml(JSON.stringify(span.detail))}` : '')
    item.addEventListener('click', () => select(span.id))
    list.append(item)
  }
  if (node.spans.length > sorted.length) {
    const more = document.createElement('div')
    more.textContent = `⋮ ${node.spans.length - sorted.length} more instances`
    more.style.opacity = '0.6'
    list.append(more)
  }
  el.detail.append(list)
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (char) => `&#${char.charCodeAt(0)};`)
}

/* ------------------------------------------------------------ interaction */

function render() {
  renderRuler()
  renderRows()
  renderOverview()
  renderMemory()
  renderProcesses()
  renderDetail()
}

function toggleExpanded(key) {
  if (ui.expanded.has(key)) ui.expanded.delete(key)
  else ui.expanded.add(key)
  renderRows()
}

function select(key) {
  ui.selected = key
  for (const row of el.rows.querySelectorAll('.row')) {
    row.classList.toggle('is-selected', row.dataset.key === key)
  }
  renderDetail()
}

function setStatus(text, className = '') {
  el.status.textContent = text
  el.status.className = `status ${className}`.trim()
}

el.filter.addEventListener('input', () => {
  ui.filter = el.filter.value
  renderRows()
})

el.threshold.addEventListener('input', () => {
  ui.threshold = Number(el.threshold.value) || 0
  renderRows()
})

el.clear.addEventListener('click', () => {
  send({ type: 'clear' })
  store.spans = []
  ui.selected = null
  ui.domain = null
  render()
})

el.live.addEventListener('click', () => {
  ui.live = !ui.live
  el.live.classList.toggle('is-on', ui.live)
  el.live.textContent = ui.live ? '● Live' : '⏸ Paused'
})

el.resetZoom.addEventListener('click', () => {
  ui.domain = null
  render()
})

el.refreshProcesses.addEventListener('click', () => send({ type: 'metrics' }))

// Overview brush.
let brushStart = null
function overviewRatio(event) {
  const rect = el.overview.getBoundingClientRect()
  return Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
}
el.overview.addEventListener('mousedown', (event) => {
  brushStart = overviewRatio(event)
})
el.overview.addEventListener('mousemove', (event) => {
  if (brushStart === null) return
  const current = overviewRatio(event)
  const left = Math.min(brushStart, current)
  const right = Math.max(brushStart, current)
  el.brush.hidden = false
  el.brush.style.left = `${left * 100}%`
  el.brush.style.width = `${(right - left) * 100}%`
})
el.overview.addEventListener('mouseup', (event) => {
  if (brushStart === null) return
  const current = overviewRatio(event)
  const left = Math.min(brushStart, current)
  const right = Math.max(brushStart, current)
  brushStart = null
  if (right - left < 0.005) return
  const extent = fullExtent()
  const size = extent.end - extent.start
  ui.domain = { start: extent.start + left * size, end: extent.start + right * size }
  render()
})
el.overview.addEventListener('dblclick', () => {
  ui.domain = null
  render()
})

// Time cursor shared between the span area and the memory chart.
function syncCursor(event) {
  const bars = el.rows.querySelector('.cell-bars') ?? el.memoryChart
  const rect = bars.getBoundingClientRect()
  const x = event.clientX - rect.left
  if (x < 0 || x > rect.width) {
    el.memoryCursor.hidden = true
    return
  }
  el.memoryCursor.hidden = false
  el.memoryCursor.style.left = `${x}px`
}
el.rows.addEventListener('mousemove', syncCursor)
el.memoryChart.addEventListener('mousemove', syncCursor)
el.rows.addEventListener('mouseleave', () => {
  el.memoryCursor.hidden = true
})

window.addEventListener('resize', () => {
  renderOverview()
  renderMemory()
})

/* ------------------------------------------------------------- connection */

function send(message) {
  if (socket && socket.readyState === 1) socket.send(JSON.stringify(message))
}

function applyMessage(message) {
  switch (message.type) {
    case 'snapshot':
      store.spans = message.spans ?? []
      store.memory = message.memory ?? []
      store.processes = message.processes ?? store.processes
      render()
      break
    case 'span':
      if (!ui.live) return
      store.spans.push(message.span)
      renderRows()
      renderOverview()
      break
    case 'memory':
      if (!ui.live) return
      store.memory.push(message.sample)
      renderMemory()
      renderOverview()
      break
    case 'metrics':
      store.processes = message.processes ?? []
      renderProcesses()
      break
    case 'cleared':
      store.spans = []
      render()
      break
    default:
      break
  }
}

function connect() {
  setStatus('Connecting…')
  socket = new WebSocket(`ws://127.0.0.1:${PERF_DEVTOOLS_PORT}`)

  socket.addEventListener('open', () => setStatus('connected', 'is-connected'))
  socket.addEventListener('message', (event) => {
    try {
      applyMessage(JSON.parse(event.data))
    } catch {
      // Ignore malformed frames.
    }
  })
  socket.addEventListener('close', () => {
    socket = null
    setStatus('disconnected — retrying', 'is-error')
    setTimeout(connect, RECONNECT_INTERVAL_MS)
  })
  socket.addEventListener('error', () => socket?.close())
}

function loadDemoData() {
  const data = PerfFixtures.build()
  store.spans = data.spans
  store.memory = data.memory
  store.processes = data.processes
  setStatus('demo data (no monitor)', '')
  render()
}

// Outside DevTools (a plain browser tab) there is no monitor to reach — show the
// fixtures instead so the panel can be developed and reviewed standalone.
if (typeof chrome === 'undefined' || !chrome.devtools) {
  loadDemoData()
} else {
  renderProcesses()
  connect()
}
