// WebUI desktop bridge static HTTP server
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import { createWebUiApiRouter, isWebUiApiRequest, isWebUiRequestAuthorized } from './apiRouter'
import type { WebUiSseRelay } from './sseRelay'

export type WebUiStaticServerOptions = {
  readonly distRoot: string
  readonly getAuthKey: () => string
  readonly getLanguage: () => string | null
  readonly host: string
  readonly port: number
  readonly sseRelay: WebUiSseRelay
}

export type WebUiStaticServer = {
  readonly port: number
  start(): Promise<void>
  stop(): Promise<void>
}

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
}

const isPrivateOrLoopbackAddress = (remoteAddress?: string) => {
  if (!remoteAddress) return false
  const address = remoteAddress.replace('::ffff:', '')

  return (
    address === '::1' ||
    address === '127.0.0.1' ||
    address.startsWith('10.') ||
    address.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(address)
  )
}

const resolveStaticPath = async (distRoot: string, requestUrl = '/') => {
  const pathname = new URL(requestUrl, 'http://webui.local').pathname
  const requestSegments = decodeURIComponent(pathname)
    .split(/[\\/]+/)
    .filter((segment) => segment && segment !== '.')

  if (requestSegments.includes('..')) {
    return undefined
  }

  const safePath = requestSegments.join(sep)
  const requestedPath = safePath === sep || safePath === '' ? 'index.html' : safePath
  const resolvedRoot = resolve(distRoot)
  const resolvedPath = resolve(join(resolvedRoot, requestedPath))
  const relativePath = relative(resolvedRoot, resolvedPath)

  if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    return undefined
  }

  const fileStat = await stat(resolvedPath).catch(() => undefined)
  if (fileStat?.isFile()) {
    return resolvedPath
  }

  return resolve(join(resolvedRoot, 'index.html'))
}

export const createWebUiStaticServer = ({
  distRoot,
  getAuthKey,
  getLanguage,
  host,
  port,
  sseRelay
}: WebUiStaticServerOptions): WebUiStaticServer => {
  let server: Server | undefined
  const apiRouter = createWebUiApiRouter({
    getAuthKey,
    getLanguage,
    getSseClientCount: () => sseRelay.size,
    sseRelay
  })

  const handleRequest = async (request: IncomingMessage, response: ServerResponse) => {
    if (!isPrivateOrLoopbackAddress(request.socket.remoteAddress)) {
      response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
      response.end('Forbidden')
      return
    }

    if (isWebUiApiRequest(request.url)) {
      await apiRouter.handle(request, response)
      return
    }

    const url = new URL(request.url ?? '/', 'http://webui.local')

    if (url.pathname === '/events') {
      if (!isWebUiRequestAuthorized(request, url, getAuthKey())) {
        response.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' })
        response.end('Unauthorized')
        return
      }
      sseRelay.addClient(response)
      return
    }

    const filePath = await resolveStaticPath(distRoot, request.url)
    if (!filePath) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      response.end('Not found')
      return
    }

    response.writeHead(200, {
      'Content-Type': contentTypes[extname(filePath)] ?? 'application/octet-stream'
    })
    createReadStream(filePath).pipe(response)
  }

  return {
    port,

    start() {
      server = createServer((request, response) => {
        handleRequest(request, response).catch((error: unknown) => {
          response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
          response.end(error instanceof Error ? error.message : 'Internal Server Error')
        })
      })

      return new Promise<void>((resolveStart, rejectStart) => {
        server?.once('error', rejectStart)
        server?.listen(port, host, () => {
          server?.off('error', rejectStart)
          resolveStart()
        })
      })
    },

    stop() {
      return new Promise<void>((resolveStop, rejectStop) => {
        if (!server?.listening) {
          resolveStop()
          return
        }

        server.close((error) => {
          if (error) {
            rejectStop(error)
            return
          }
          resolveStop()
        })
      })
    }
  }
}
