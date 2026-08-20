export const execWorkerSource = `
const crypto = require('node:crypto')
const { parentPort } = require('node:worker_threads')

const MAX_LOGS = 1000

const logs = []
const pendingCalls = new Map()
const activeCalls = new Map()
let isExecuting = false

const stringify = (value) => {
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value instanceof Error) return value.message

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

const pushLog = (level, args) => {
  if (logs.length >= MAX_LOGS) {
    return
  }

  const message = args.map((arg) => stringify(arg)).join(' ')
  const entry = \`[\${level}] \${message}\`
  logs.push(entry)
  parentPort?.postMessage({ type: 'log', entry })
}

const capturedConsole = {
  log: (...args) => pushLog('log', args),
  warn: (...args) => pushLog('warn', args),
  error: (...args) => pushLog('error', args),
  info: (...args) => pushLog('info', args),
  debug: (...args) => pushLog('debug', args)
}

const invoke = (name, params) => {
  let call
  const promise = new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID()
    call = { requestId, resolve, reject, promise: undefined }
    pendingCalls.set(requestId, call)
    activeCalls.set(requestId, call)
    parentPort?.postMessage({ type: 'callTool', requestId, name, params })
  })
  call.promise = promise
  // A script can throw before observing this promise; drainActiveCalls reports only the script's
  // own failure after the child settles, so suppress Node's unhandled-rejection side channel.
  promise.catch(() => undefined)

  return promise
}

const tools = {
  invoke,
  log: (level, message, fields) => {
    const safeLevel = typeof level === 'string' ? level : 'info'
    const safeMsg = typeof message === 'string' ? message : stringify(message)
    if (fields !== undefined) {
      pushLog(safeLevel, [safeMsg, fields])
    } else {
      pushLog(safeLevel, [safeMsg])
    }
  }
}

const buildContext = () => {
  return {
    tools,
    parallel: (...promises) => Promise.all(promises),
    settle: (...promises) => Promise.allSettled(promises),
    console: capturedConsole
  }
}

const runCode = async (code, context) => {
  const contextKeys = Object.keys(context)
  const contextValues = contextKeys.map((key) => context[key])

  // We run in an async context to allow top-level await inside the provided code.
  // IMPORTANT: Users should explicitly return the final value.
  const wrappedCode = "return (async () => {\\n" + code + "\\n})()"

  const fn = new Function(...contextKeys, wrappedCode)
  return await fn(...contextValues)
}

const drainActiveCalls = async () => {
  while (activeCalls.size > 0) {
    const batch = [...activeCalls.values()].map((call) => call.promise)
    await Promise.allSettled(batch)
    // Settled callbacks can synchronously enqueue follow-up tools. Let them run before deciding
    // the worker has no remaining work.
    await Promise.resolve()
  }
}

const handleExec = async (code) => {
  if (isExecuting) {
    return
  }
  isExecuting = true

  try {
    const context = buildContext()
    let result
    let codeError
    try {
      result = await runCode(code, context)
    } catch (error) {
      codeError = error
    }
    await drainActiveCalls()
    if (codeError) throw codeError
    parentPort?.postMessage({ type: 'result', result, logs: logs.length > 0 ? logs : undefined })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    parentPort?.postMessage({ type: 'error', error: errorMessage, logs: logs.length > 0 ? logs : undefined })
  } finally {
    pendingCalls.clear()
    activeCalls.clear()
  }
}

const handleToolResult = (message) => {
  const pending = pendingCalls.get(message.requestId)
  if (!pending) {
    return
  }
  pendingCalls.delete(message.requestId)
  activeCalls.delete(message.requestId)
  pending.resolve(message.result)
}

const handleToolError = (message) => {
  const pending = pendingCalls.get(message.requestId)
  if (!pending) {
    return
  }
  pendingCalls.delete(message.requestId)
  activeCalls.delete(message.requestId)
  pending.reject(new Error(message.error))
}

parentPort?.on('message', (message) => {
  if (!message || typeof message !== 'object') {
    return
  }
  switch (message.type) {
    case 'exec':
      handleExec(message.code)
      break
    case 'toolResult':
      handleToolResult(message)
      break
    case 'toolError':
      handleToolError(message)
      break
    default:
      break
  }
})
`
