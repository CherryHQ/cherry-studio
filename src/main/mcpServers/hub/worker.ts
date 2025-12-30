export const hubWorkerSource = `
const crypto = require('node:crypto')
const { parentPort } = require('node:worker_threads')

const MAX_LOGS = 1000

const logs = []
const pendingCalls = new Map()
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

const callTool = (functionName, params) =>
  new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID()
    pendingCalls.set(requestId, { resolve, reject })
    parentPort?.postMessage({ type: 'callTool', requestId, functionName, params })
  })

const buildContext = (tools) => {
  const context = {
    __callTool: callTool,
    parallel: (...promises) => Promise.all(promises),
    settle: (...promises) => Promise.allSettled(promises),
    console: capturedConsole
  }

  for (const tool of tools) {
    context[tool.functionName] = (params) => callTool(tool.functionName, params)
  }

  return context
}

const runCode = async (code, context) => {
  const contextKeys = Object.keys(context)
  const contextValues = contextKeys.map((key) => context[key])

  const wrappedCode = \`
    return (async () => {
      \${code}
    })()
  \`

  const fn = new Function(...contextKeys, wrappedCode)
  return await fn(...contextValues)
}

const handleExec = async (code, tools) => {
  if (isExecuting) {
    return
  }
  isExecuting = true

  try {
    const context = buildContext(tools)
    const result = await runCode(code, context)
    parentPort?.postMessage({ type: 'result', result, logs: logs.length > 0 ? logs : undefined })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    parentPort?.postMessage({ type: 'error', error: errorMessage, logs: logs.length > 0 ? logs : undefined })
  } finally {
    pendingCalls.clear()
  }
}

const handleToolResult = (message) => {
  const pending = pendingCalls.get(message.requestId)
  if (!pending) {
    return
  }
  pendingCalls.delete(message.requestId)
  pending.resolve(message.result)
}

const handleToolError = (message) => {
  const pending = pendingCalls.get(message.requestId)
  if (!pending) {
    return
  }
  pendingCalls.delete(message.requestId)
  pending.reject(new Error(message.error))
}

parentPort?.on('message', (message) => {
  if (!message || typeof message !== 'object') {
    return
  }
  switch (message.type) {
    case 'exec':
      handleExec(message.code, message.tools ?? [])
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
