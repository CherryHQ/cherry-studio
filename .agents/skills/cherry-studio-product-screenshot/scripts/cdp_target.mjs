#!/usr/bin/env node

function usage() {
  console.error(`Usage:
  cdp_target.mjs --port <port> --url-contains <text> bring-to-front
  cdp_target.mjs --port <port> --url-contains <text> eval <expression>
  cdp_target.mjs --port <port> --url-contains <text> hover-text <exact text>
  cdp_target.mjs --port <port> --url-contains <text> click-text <exact text>
  cdp_target.mjs --port <port> --url-contains <text> hover-aria <exact aria-label>
  cdp_target.mjs --port <port> --url-contains <text> click-aria <exact aria-label>
  cdp_target.mjs --port <port> --url-contains <text> type <text>
  cdp_target.mjs --port <port> --url-contains <text> key <Enter|Escape|ArrowUp|ArrowDown>
  cdp_target.mjs --port <port> --url-contains <text> drag-aria <source label> --to <target label>
  cdp_target.mjs --port <port> --url-contains <text> close-tab <tab aria-label>
  cdp_target.mjs --port <port> --url-contains <text> move <x> <y>`)
  process.exit(2)
}

const args = process.argv.slice(2)
let port
let urlContains

while (args[0]?.startsWith('--')) {
  const flag = args.shift()
  const value = args.shift()
  if (!value) usage()
  if (flag === '--port') port = value
  else if (flag === '--url-contains') urlContains = value
  else usage()
}

const action = args.shift()
if (!port || !urlContains || !action) usage()

const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => {
  if (!response.ok) throw new Error(`CDP target list failed: HTTP ${response.status}`)
  return response.json()
})

const matches = targets.filter((target) => target.type === 'page' && target.url.includes(urlContains))
if (matches.length !== 1) {
  const found = targets.map(({ id, title, url }) => ({ id, title, url }))
  throw new Error(
    `Expected one target containing ${JSON.stringify(urlContains)}, found ${matches.length}: ${JSON.stringify(found)}`
  )
}

const target = matches[0]
const socket = new WebSocket(target.webSocketDebuggerUrl)
let nextId = 1
const pending = new Map()

const opened = new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', () => reject(new Error('CDP WebSocket connection failed')), { once: true })
})

socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  const waiter = pending.get(message.id)
  if (!waiter) return
  pending.delete(message.id)
  if (message.error) waiter.reject(new Error(JSON.stringify(message.error)))
  else waiter.resolve(message.result)
})

await opened

function send(method, params = {}) {
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
}

async function pointForText(text) {
  const expression = `(() => {
    const text = ${JSON.stringify(text)}
    const candidates = Array.from(document.querySelectorAll('button, [role="button"]'))
      .filter((element) => element.textContent.trim() === text)
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 0 && rect.height > 0)
      .sort((left, right) => right.rect.width * right.rect.height - left.rect.width * left.rect.height)
    if (!candidates.length) throw new Error('Visible button not found: ' + text)
    const rect = candidates[0].rect
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, width: rect.width, height: rect.height }
  })()`
  const result = await send('Runtime.evaluate', { expression, returnByValue: true })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  }
  return result.result.value
}

async function pointForAria(label) {
  const expression = `(() => {
    const label = ${JSON.stringify(label)}
    const candidates = Array.from(document.querySelectorAll('[aria-label]'))
      .filter((element) => element.getAttribute('aria-label') === label)
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 0 && rect.height > 0)
      .sort((left, right) => right.rect.width * right.rect.height - left.rect.width * left.rect.height)
    if (!candidates.length) throw new Error('Visible aria-label not found: ' + label)
    const rect = candidates[0].rect
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, width: rect.width, height: rect.height }
  })()`
  const result = await send('Runtime.evaluate', { expression, returnByValue: true })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  }
  return result.result.value
}

async function closePointForTab(label) {
  const expression = `(() => {
    const label = ${JSON.stringify(label)}
    const tab = Array.from(document.querySelectorAll('button[aria-label]'))
      .find((element) => element.getAttribute('aria-label') === label && element.getBoundingClientRect().y < 40)
    if (!tab) throw new Error('Visible tab not found: ' + label)
    const close = tab.querySelector('[aria-label="Close Tab"], [aria-label="关闭标签页"]')
    if (!close) throw new Error('Close control not found for tab: ' + label)
    const rect = close.getBoundingClientRect()
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, width: rect.width, height: rect.height }
  })()`
  const result = await send('Runtime.evaluate', { expression, returnByValue: true })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  }
  return result.result.value
}

try {
  let output
  if (action === 'bring-to-front') {
    output = await send('Page.bringToFront')
  } else if (action === 'eval') {
    const expression = args.join(' ')
    if (!expression) usage()
    const result = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    })
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
    }
    output = result.result.value
  } else if (action === 'hover-text' || action === 'click-text') {
    const text = args.join(' ')
    if (!text) usage()
    const point = await pointForText(text)
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y })
    if (action === 'click-text') {
      await send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: point.x,
        y: point.y,
        button: 'left',
        clickCount: 1
      })
      await send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: point.x,
        y: point.y,
        button: 'left',
        clickCount: 1
      })
    }
    output = { text, point }
  } else if (action === 'hover-aria' || action === 'click-aria') {
    const label = args.join(' ')
    if (!label) usage()
    const point = await pointForAria(label)
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y })
    if (action === 'click-aria') {
      await send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: point.x,
        y: point.y,
        button: 'left',
        clickCount: 1
      })
      await send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: point.x,
        y: point.y,
        button: 'left',
        clickCount: 1
      })
    }
    output = { label, point }
  } else if (action === 'type') {
    const text = args.join(' ')
    if (!text) usage()
    await send('Input.insertText', { text })
    output = { text }
  } else if (action === 'key') {
    const key = args[0]
    const keys = {
      Enter: { code: 'Enter', keyCode: 13 },
      Escape: { code: 'Escape', keyCode: 27 },
      ArrowUp: { code: 'ArrowUp', keyCode: 38 },
      ArrowDown: { code: 'ArrowDown', keyCode: 40 }
    }
    const selected = keys[key]
    if (!selected) usage()
    await send('Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      key,
      code: selected.code,
      windowsVirtualKeyCode: selected.keyCode,
      nativeVirtualKeyCode: selected.keyCode
    })
    await send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key,
      code: selected.code,
      windowsVirtualKeyCode: selected.keyCode,
      nativeVirtualKeyCode: selected.keyCode
    })
    output = { key }
  } else if (action === 'drag-aria') {
    const separator = args.indexOf('--to')
    if (separator < 1 || separator === args.length - 1) usage()
    const sourceLabel = args.slice(0, separator).join(' ')
    const targetLabel = args.slice(separator + 1).join(' ')
    const source = await pointForAria(sourceLabel)
    const target = await pointForAria(targetLabel)
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: source.x, y: source.y })
    await send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: source.x,
      y: source.y,
      button: 'left',
      buttons: 1,
      clickCount: 1
    })
    for (let step = 1; step <= 12; step += 1) {
      const ratio = step / 12
      await send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: source.x + (target.x - source.x) * ratio,
        y: source.y + (target.y - source.y) * ratio,
        button: 'left',
        buttons: 1
      })
      await new Promise((resolve) => setTimeout(resolve, 16))
    }
    await send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: target.x,
      y: target.y,
      button: 'left',
      buttons: 0,
      clickCount: 1
    })
    output = { sourceLabel, targetLabel, source, target }
  } else if (action === 'close-tab') {
    const label = args.join(' ')
    if (!label) usage()
    const tabPoint = await pointForAria(label)
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: tabPoint.x, y: tabPoint.y })
    await new Promise((resolve) => setTimeout(resolve, 80))
    const closePoint = await closePointForTab(label)
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: closePoint.x, y: closePoint.y })
    await send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: closePoint.x,
      y: closePoint.y,
      button: 'left',
      clickCount: 1
    })
    await send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: closePoint.x,
      y: closePoint.y,
      button: 'left',
      clickCount: 1
    })
    output = { label, closePoint }
  } else if (action === 'move') {
    const [rawX, rawY] = args
    const x = Number(rawX)
    const y = Number(rawY)
    if (!Number.isFinite(x) || !Number.isFinite(y)) usage()
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    output = { x, y }
  } else {
    usage()
  }
  console.log(JSON.stringify({ target: { id: target.id, title: target.title, url: target.url }, output }, null, 2))
} finally {
  socket.close()
}
