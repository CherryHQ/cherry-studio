/* global chrome */

const rowsEl = document.getElementById('rows')
const detailsEl = document.getElementById('details')
const filterEl = document.getElementById('filter')
const countEl = document.getElementById('count')
const clearEl = document.getElementById('clear')
const capturePayloadsEl = document.getElementById('capturePayloads')
const COPY_FEEDBACK_DURATION_MS = 2500

let events = []
let selectedId = null

function evalInInspectedWindow(expression) {
  return new Promise((resolve) => {
    chrome.devtools.inspectedWindow.eval(expression, (result, exceptionInfo) => {
      if (exceptionInfo) {
        resolve(undefined)
        return
      }
      resolve(result)
    })
  })
}

function formatDuration(value) {
  return typeof value === 'number' ? `${value.toFixed(1)}ms` : ''
}

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString()
}

function getSearchText(event) {
  return [
    event.state,
    event.method,
    event.path,
    event.status,
    event.error?.code,
    event.error?.message
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

function filteredEvents() {
  const query = filterEl.value.trim().toLowerCase()
  if (!query) return events
  return events.filter((event) => getSearchText(event).includes(query))
}

function renderRows() {
  const visible = filteredEvents()
  countEl.textContent = `${events.length} requests`
  rowsEl.replaceChildren()

  for (const event of visible) {
    const tr = document.createElement('tr')
    tr.dataset.id = event.id
    if (event.id === selectedId) tr.classList.add('selected')

    const cells = [
      { text: formatTime(event.timestamp) },
      { text: event.state, className: event.state },
      { text: event.method, className: 'method' },
      { text: event.path, title: event.path },
      { text: event.status ?? '' },
      { text: formatDuration(event.clientDuration) },
      { text: formatDuration(event.serverDuration) }
    ]

    for (const cell of cells) {
      const td = document.createElement('td')
      td.textContent = String(cell.text)
      if (cell.className) td.className = cell.className
      if (cell.title) td.title = cell.title
      tr.appendChild(td)
    }

    tr.addEventListener('click', () => {
      selectedId = event.id
      renderRows()
      renderDetails(event)
    })
    rowsEl.appendChild(tr)
  }

  if (selectedId && !visible.some((event) => event.id === selectedId)) {
    selectedId = null
    detailsEl.textContent = 'Select a DataApi event.'
  }
}

function renderDetails(event) {
  detailsEl.replaceChildren()
  appendSection(
    'Request',
    {
      requestId: event.requestId,
      method: event.method,
      path: event.path,
      query: event.query,
      body: event.body,
      retryAttempt: event.retryAttempt,
      startedAt: event.timestamp ? new Date(event.timestamp).toISOString() : undefined
    },
    { copyable: true }
  )
  appendSection(
    'Response',
    {
      status: event.status,
      data: event.response,
      completedAt: event.completedAt ? new Date(event.completedAt).toISOString() : undefined
    },
    { copyable: true }
  )
  if (event.error) {
    appendSection('Error', event.error)
  }
  appendSection('Timing', {
    clientDuration: formatDuration(event.clientDuration),
    serverDuration: formatDuration(event.serverDuration),
    handlerDuration: formatDuration(event.handlerDuration)
  })
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

function appendSection(title, payload, options = {}) {
  const section = document.createElement('section')
  section.className = 'detail-section'

  const header = document.createElement('div')
  header.className = 'detail-section-header'

  const heading = document.createElement('h2')
  heading.textContent = title

  const pre = document.createElement('pre')
  pre.textContent = JSON.stringify(payload, null, 2)

  header.appendChild(heading)
  if (options.copyable) {
    const copyButton = document.createElement('button')
    copyButton.type = 'button'
    copyButton.className = 'copy-button'
    copyButton.textContent = 'Copy'
    copyButton.addEventListener('click', async () => {
      try {
        await copyText(pre.textContent ?? '')
        copyButton.textContent = 'Copied'
      } catch {
        copyButton.textContent = 'Failed'
      }
      setTimeout(() => {
        copyButton.textContent = 'Copy'
      }, COPY_FEEDBACK_DURATION_MS)
    })
    header.appendChild(copyButton)
  }

  section.append(header, pre)
  detailsEl.appendChild(section)
}

async function refresh() {
  const snapshot = await evalInInspectedWindow(
    'window.__CHERRY_DATA_API_DEVTOOLS__ ? window.__CHERRY_DATA_API_DEVTOOLS__.snapshot() : []'
  )
  events = Array.isArray(snapshot) ? snapshot : []
  renderRows()
  if (selectedId) {
    const selectedEvent = events.find((event) => event.id === selectedId)
    if (selectedEvent) renderDetails(selectedEvent)
  }
}

filterEl.addEventListener('input', renderRows)

clearEl.addEventListener('click', async () => {
  await evalInInspectedWindow(
    'window.__CHERRY_DATA_API_DEVTOOLS__ && window.__CHERRY_DATA_API_DEVTOOLS__.clear()'
  )
  selectedId = null
  detailsEl.textContent = 'Select a DataApi event.'
  await refresh()
})

capturePayloadsEl.addEventListener('change', async () => {
  const enabled = capturePayloadsEl.checked ? 'true' : 'false'
  await evalInInspectedWindow(
    `window.__CHERRY_DATA_API_DEVTOOLS__ && window.__CHERRY_DATA_API_DEVTOOLS__.setOptions({ capturePayloads: ${enabled} })`
  )
})

setInterval(refresh, 500)
void refresh()
