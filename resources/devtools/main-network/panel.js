const rowsEl = document.getElementById('rows')
const detailsEl = document.getElementById('details')
const filterEl = document.getElementById('filter')
const countEl = document.getElementById('count')
const clearEl = document.getElementById('clear')
const statusEl = document.getElementById('status')
const COPY_FEEDBACK_DURATION_MS = 2500
const RECONNECT_INTERVAL_MS = 1000
// Keep in sync with MAIN_NETWORK_DEVTOOLS_DEFAULT_PORT in src/main/services/mainNetworkDevtools/MainNetworkDevtoolsService.ts.
const MAIN_NETWORK_DEVTOOLS_PORT = 38997

let events = []
let selectedId = null
let rowsSignature = ''
let detailsSignature = ''
let socket = null

function setStatus(text, className = '') {
  statusEl.textContent = text
  statusEl.className = `status ${className}`.trim()
}

function formatDuration(value) {
  return typeof value === 'number' ? `${value.toFixed(1)}ms` : ''
}

function formatTime(timestamp) {
  return timestamp ? new Date(timestamp).toLocaleTimeString() : ''
}

function formatIsoTime(timestamp) {
  return timestamp ? new Date(timestamp).toISOString() : ''
}

function getSearchText(event) {
  return [event.state, event.source, event.method, event.url, event.status, event.statusText, event.error]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

function filteredEvents() {
  const query = filterEl.value.trim().toLowerCase()
  if (!query) return events
  return events.filter((event) => getSearchText(event).includes(query))
}

function getRowsSignature(visible) {
  return JSON.stringify({
    selectedId,
    rows: visible.map((event) => ({
      id: event.id,
      state: event.state,
      source: event.source,
      method: event.method,
      url: event.url,
      status: event.status,
      duration: event.duration
    }))
  })
}

function renderRows(force = false) {
  const visible = filteredEvents()
  countEl.textContent = `${events.length} requests`

  const nextSignature = getRowsSignature(visible)
  if (!force && nextSignature === rowsSignature) return

  rowsEl.replaceChildren()
  rowsSignature = nextSignature

  for (const event of visible) {
    const tr = document.createElement('tr')
    tr.dataset.id = event.id
    if (event.id === selectedId) tr.classList.add('selected')

    const cells = [
      { text: formatTime(event.startedAt) },
      { text: event.state, className: event.state },
      { text: event.source, className: 'source' },
      { text: event.method, className: 'method' },
      { text: event.url, title: event.url },
      { text: event.status ?? '' },
      { text: formatDuration(event.duration) }
    ]

    for (const cell of cells) {
      const td = document.createElement('td')
      td.textContent = String(cell.text)
      if (cell.className) td.className = cell.className
      if (cell.title) td.title = cell.title
      tr.appendChild(td)
    }

    rowsEl.appendChild(tr)
  }

  if (selectedId && !visible.some((event) => event.id === selectedId)) {
    selectedId = null
    detailsSignature = ''
    detailsEl.textContent = 'Select a main-process network request.'
  }
}

function renderDetails(event, force = false) {
  const nextSignature = JSON.stringify(event)
  if (!force && nextSignature === detailsSignature) return

  detailsSignature = nextSignature
  detailsEl.replaceChildren()

  appendKeyValueSection('Request', {
    id: event.id,
    source: event.source,
    method: event.method,
    url: event.url,
    startedAt: formatIsoTime(event.startedAt)
  })
  appendHeadersSection('Request Headers', event.requestHeaders)
  appendBodySection('Request Body', event.requestBody)

  appendKeyValueSection('Response', {
    state: event.state,
    status: event.status,
    statusText: event.statusText,
    responseStartedAt: formatIsoTime(event.responseStartedAt),
    completedAt: formatIsoTime(event.completedAt)
  })
  appendHeadersSection('Response Headers', event.responseHeaders)
  appendBodySection('Response Body', event.responseBody, event.responseBodyError)

  if (event.error) appendKeyValueSection('Error', { message: event.error })
  appendKeyValueSection('Timing', { duration: formatDuration(event.duration) })
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  textarea.remove()
}

function appendSection(title, copyTextProvider) {
  const section = document.createElement('section')
  section.className = 'detail-section'

  const header = document.createElement('div')
  header.className = 'detail-section-header'

  const heading = document.createElement('h2')
  heading.textContent = title
  header.appendChild(heading)

  if (copyTextProvider) header.appendChild(createCopyButton(copyTextProvider))

  const content = document.createElement('div')
  content.className = 'detail-section-content'
  section.append(header, content)
  detailsEl.appendChild(section)
  return content
}

function createCopyButton(copyTextProvider) {
  const copyButton = document.createElement('button')
  copyButton.type = 'button'
  copyButton.className = 'copy-button'
  copyButton.textContent = 'Copy'
  copyButton.addEventListener('click', async () => {
    try {
      await copyText(copyTextProvider())
      copyButton.textContent = 'Copied'
    } catch {
      copyButton.textContent = 'Failed'
    }
    setTimeout(() => {
      copyButton.textContent = 'Copy'
    }, COPY_FEEDBACK_DURATION_MS)
  })
  return copyButton
}

function appendKeyValueSection(title, rows) {
  const visibleRows = Object.entries(rows).filter(([, value]) => value !== undefined && value !== '')
  const content = appendSection(title, () => visibleRows.map(([key, value]) => `${key}: ${value}`).join('\n'))
  const dl = document.createElement('dl')
  dl.className = 'kv-list'

  for (const [key, value] of visibleRows) {
    const dt = document.createElement('dt')
    dt.textContent = key
    const dd = document.createElement('dd')
    dd.textContent = String(value)
    dl.append(dt, dd)
  }

  content.appendChild(dl)
}

function appendHeadersSection(title, headers) {
  const entries = headers ? Object.entries(headers) : []
  const content = appendSection(title, () => entries.map(([key, value]) => `${key}: ${value}`).join('\n'))

  if (entries.length === 0) {
    appendMuted(content, 'No headers captured.')
    return
  }

  const table = document.createElement('div')
  table.className = 'headers-list'
  for (const [key, value] of entries) {
    const name = document.createElement('div')
    name.className = 'header-name'
    name.textContent = key
    const headerValue = document.createElement('div')
    headerValue.className = 'header-value'
    headerValue.textContent = value
    table.append(name, headerValue)
  }
  content.appendChild(table)
}

function appendBodySection(title, body, error) {
  const formattedText = body?.text ? formatBodyText(body.text, body.contentType) : ''
  const copyValue = formattedText || body?.note || error || ''
  const content = appendSection(title, copyValue ? () => copyValue : undefined)

  const meta = formatBodyMeta(body)
  if (meta) {
    const metaEl = document.createElement('div')
    metaEl.className = 'body-meta'
    metaEl.textContent = meta
    content.appendChild(metaEl)
  }

  if (error) {
    appendMuted(content, `Capture failed: ${error}`)
    return
  }

  if (body?.note) appendMuted(content, body.note)
  if (!formattedText) {
    if (!body?.note) appendMuted(content, 'No body captured.')
    return
  }

  const pre = document.createElement('pre')
  pre.className = 'body-preview'
  pre.textContent = formattedText
  content.appendChild(pre)
}

function appendMuted(parent, text) {
  const node = document.createElement('div')
  node.className = 'muted'
  node.textContent = text
  parent.appendChild(node)
}

function formatBodyMeta(body) {
  if (!body) return ''
  const parts = []
  if (body.contentType) parts.push(body.contentType)
  if (typeof body.size === 'number') parts.push(`${body.size} chars`)
  if (body.truncated) parts.push('truncated')
  return parts.join(' · ')
}

function formatBodyText(text, contentType = '') {
  if (isJsonContentType(contentType) || looksJson(text)) return tryFormatJson(text)
  if (isUrlEncodedContentType(contentType)) return formatUrlEncoded(text)
  if (contentType.toLowerCase().includes('event-stream')) return formatEventStream(text)
  return text
}

function tryFormatJson(text) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

function formatUrlEncoded(text) {
  try {
    const params = new URLSearchParams(text)
    return [...params].map(([key, value]) => `${key} = ${value}`).join('\n')
  } catch {
    return text
  }
}

function formatEventStream(text) {
  return text
    .split('\n')
    .map((line) => {
      const match = line.match(/^(data:\s*)(.+)$/)
      if (!match) return line
      return `${match[1]}${tryFormatJson(match[2])}`
    })
    .join('\n')
}

function isJsonContentType(contentType) {
  return contentType.toLowerCase().includes('json')
}

function isUrlEncodedContentType(contentType) {
  return contentType.toLowerCase().includes('x-www-form-urlencoded')
}

function looksJson(text) {
  const trimmed = text.trim()
  return trimmed.startsWith('{') || trimmed.startsWith('[')
}

function upsertEvent(event) {
  const index = events.findIndex((item) => item.id === event.id)
  if (index === -1) events.push(event)
  else events[index] = event

  renderRows()
  if (selectedId === event.id) renderDetails(event)
}

function replaceEvents(nextEvents) {
  events = Array.isArray(nextEvents) ? nextEvents : []
  renderRows(true)
  if (selectedId) {
    const selectedEvent = events.find((event) => event.id === selectedId)
    if (selectedEvent) renderDetails(selectedEvent, true)
  }
}

function clearEvents() {
  events = []
  selectedId = null
  rowsSignature = ''
  detailsSignature = ''
  detailsEl.textContent = 'Select a main-process network request.'
  renderRows(true)
}

function handleMessage(raw) {
  let message
  try {
    message = JSON.parse(raw)
  } catch {
    return
  }

  if (message.type === 'snapshot') {
    replaceEvents(message.events)
    return
  }

  if (message.type === 'event' && message.event) {
    upsertEvent(message.event)
    return
  }

  if (message.type === 'cleared') {
    clearEvents()
  }
}

function connect() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return

  if (socket) socket.close()
  setStatus(`Connecting 127.0.0.1:${MAIN_NETWORK_DEVTOOLS_PORT}...`)

  socket = new WebSocket(`ws://127.0.0.1:${MAIN_NETWORK_DEVTOOLS_PORT}/`)
  socket.addEventListener('open', () => setStatus(`Connected 127.0.0.1:${MAIN_NETWORK_DEVTOOLS_PORT}`, 'connected'))
  socket.addEventListener('message', (event) => handleMessage(event.data))
  socket.addEventListener('close', () => setStatus('Disconnected; retrying...', 'error'))
  socket.addEventListener('error', () => setStatus('Connection failed; retrying...', 'error'))
}

function ensureConnection() {
  connect()
}

filterEl.addEventListener('input', () => renderRows())

rowsEl.addEventListener('pointerdown', (pointerEvent) => {
  const target = pointerEvent.target
  if (!(target instanceof Element)) return

  const row = target.closest('tr[data-id]')
  if (!row || !rowsEl.contains(row)) return

  const event = events.find((item) => item.id === row.dataset.id)
  if (!event) return

  selectedId = event.id
  renderRows(true)
  renderDetails(event, true)
})

clearEl.addEventListener('click', () => {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'clear' }))
    return
  }

  clearEvents()
})

setInterval(ensureConnection, RECONNECT_INTERVAL_MS)
ensureConnection()
