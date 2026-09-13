import WebSocket from 'ws'

interface CdpMessage {
  error?: { code: number; message: string }
  id?: number
  result?: unknown
}

interface RuntimeEvaluation {
  exceptionDetails?: {
    exception?: { description?: string }
    text?: string
  }
  result: {
    value?: unknown
  }
}

async function openSocket(url: string): Promise<WebSocket> {
  const socket = new WebSocket(url, { handshakeTimeout: 5_000 })
  await new Promise<void>((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      socket.terminate()
      reject(new Error('CDP 连接超时'))
    }, 5_000)
    const onError = (error: Error): void => {
      clearTimeout(timer)
      reject(error)
    }
    socket.once('error', onError)
    socket.once('open', () => {
      clearTimeout(timer)
      socket.off('error', onError)
      resolvePromise()
    })
  })
  return socket
}

function evaluationValue<T>(evaluation: RuntimeEvaluation): T {
  if (evaluation.exceptionDetails) {
    throw new Error(
      evaluation.exceptionDetails.exception?.description ?? evaluation.exceptionDetails.text ?? 'CDP 表达式执行失败'
    )
  }
  return evaluation.result.value as T
}

export async function evaluateCdpExpression<T>(webSocketDebuggerUrl: string, expression: string): Promise<T> {
  const socket = await openSocket(webSocketDebuggerUrl)
  try {
    const evaluation = await new Promise<RuntimeEvaluation>((resolvePromise, reject) => {
      const commandId = 1
      const timer = setTimeout(() => reject(new Error('CDP 表达式执行超时')), 15_000)
      const finish = (callback: () => void): void => {
        clearTimeout(timer)
        socket.off('message', onMessage)
        socket.off('error', onError)
        socket.off('close', onClose)
        callback()
      }
      const onError = (error: Error): void => finish(() => reject(error))
      const onClose = (): void => finish(() => reject(new Error('CDP 连接已关闭')))
      const onMessage = (data: WebSocket.RawData): void => {
        let message: CdpMessage
        try {
          message = JSON.parse(data.toString()) as CdpMessage
        } catch {
          return
        }
        if (message.id !== commandId) return
        if (message.error) {
          finish(() => reject(new Error(`CDP ${message.error?.code}：${message.error?.message}`)))
          return
        }
        finish(() => resolvePromise(message.result as RuntimeEvaluation))
      }

      socket.on('message', onMessage)
      socket.once('error', onError)
      socket.once('close', onClose)
      socket.send(
        JSON.stringify({
          id: commandId,
          method: 'Runtime.evaluate',
          params: { awaitPromise: true, expression, returnByValue: true }
        }),
        (error) => {
          if (error) finish(() => reject(error))
        }
      )
    })
    return evaluationValue<T>(evaluation)
  } finally {
    socket.close()
  }
}
