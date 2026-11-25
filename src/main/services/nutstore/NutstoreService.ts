import path from 'node:path'

import { net } from 'electron'
import { isNil, partial } from 'es-toolkit/compat'
import { XMLParser } from 'fast-xml-parser'
import { type FileStat } from 'webdav'
import * as z from 'zod'

import { loggerService } from '@logger'
import { NUTSTORE_HOST } from '@shared/utils/nutstore'

import { createOAuthUrl, decryptSecret } from './sso/lib/index.mjs'

const logger = loggerService.withContext('NutstoreService')

const oauthResponseSchema = z.object({ username: z.string(), access_token: z.string() })
type OAuthResponse = z.infer<typeof oauthResponseSchema>

interface WebDAVResponse {
  multistatus: {
    response: Array<{
      href: string
      propstat: {
        prop: {
          displayname: string
          resourcetype: { collection?: any }
          getlastmodified?: string
          getcontentlength?: string
          getcontenttype?: string
        }
        status: string
      }
    }>
  }
}

export async function getNutstoreSSOUrl() {
  return await createOAuthUrl({
    app: 'cherrystudio'
  })
}

export async function decryptToken(token: string) {
  try {
    const decrypted = await decryptSecret({
      app: 'cherrystudio',
      s: token
    })

    const response: unknown = JSON.parse(decrypted)
    oauthResponseSchema.parse(response)

    // SAFETY: The schema checks both declared auth fields; returning the original JSON preserves extension and reserved keys.
    return response as OAuthResponse
  } catch (error) {
    logger.error('Failed to decrypt token:', error)

    return null
  }
}

export async function getDirectoryContents(token: string, target: string): Promise<FileStat[]> {
  const contents: FileStat[] = []

  if (!target.startsWith('/')) {
    target = '/' + target
  }

  let currentUrl = `${NUTSTORE_HOST}${target}`

  while (true) {
    const response = await net.fetch(currentUrl, {
      method: 'PROPFIND',
      headers: {
        Authorization: `Basic ${token}`,
        'Content-Type': 'application/xml',
        Depth: '1'
      },
      body: `<?xml version="1.0" encoding="utf-8"?>
        <propfind xmlns="DAV:">
          <prop>
            <displayname/>
            <resourcetype/>
            <getlastmodified/>
            <getcontentlength/>
            <getcontenttype/>
          </prop>
        </propfind>`
    })

    const text = await response.text()

    const result = readWebDavResponse(text)

    const items = Array.isArray(result.multistatus.response)
      ? result.multistatus.response
      : [result.multistatus.response]

    // 跳过第一个条目（当前目录）
    contents.push(...items.slice(1).map(partial(convertToFileStat, '/dav')))

    const linkHeader = response.headers['link'] || response.headers['Link']

    if (!linkHeader) {
      break
    }

    const nextLink = extractNextLink(linkHeader)

    if (!nextLink) {
      break
    }

    currentUrl = decodeURI(nextLink)
  }

  return contents
}

function extractNextLink(linkHeader: string): string | null {
  const matches = linkHeader.match(/<([^>]+)>;\s*rel="next"/)

  return matches ? matches[1] : null
}

function convertToFileStat(serverBase: string, item: WebDAVResponse['multistatus']['response'][number]): FileStat {
  const props = item.propstat.prop
  const isDir = !isNil(props.resourcetype?.collection)
  const href = decodeURIComponent(item.href)
  const filename = serverBase === '/' ? href : path.posix.join('/', href.replace(serverBase, ''))

  return {
    filename: filename.endsWith('/') ? filename.slice(0, -1) : filename,
    basename: path.basename(filename),
    lastmod: props.getlastmodified || '',
    size: props.getcontentlength ? parseInt(props.getcontentlength, 10) : 0,
    type: isDir ? 'directory' : 'file',
    etag: null,
    mime: props.getcontenttype
  }
}

function readWebDavResponse(xml: string): WebDAVResponse {
  const parser = new XMLParser({
    attributeNamePrefix: '',
    removeNSPrefix: true
  })

  // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion -- XMLParser does not validate WebDAV; retain the legacy numeric-value and singleton-response projection without claiming a decoded DTO.
  return parser.parse(xml) as WebDAVResponse
}
