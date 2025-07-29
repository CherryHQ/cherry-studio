import path from 'node:path'

import { loggerService } from '@logger'
import { NUTSTORE_HOST } from '@shared/config/nutstore'
import { XMLParser } from 'fast-xml-parser'
import { isNil, partial } from 'lodash'
import { type FileStat } from 'webdav'

import { createOAuthUrl, decryptSecret } from '../integration/nutstore/sso/lib/index.mjs'

const logger = loggerService.withContext('NutstoreService')

interface OAuthResponse {
  username: string
  userid: string
  access_token: string
}

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
    return JSON.parse(decrypted) as OAuthResponse
  } catch (error) {
    logger.error('Failed to decrypt token:', error as Error)
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
    const response = await fetch(currentUrl, {
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

    const result = parseXml<WebDAVResponse>(text)
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

function parseXml<T>(xml: string) {
  const parser = new XMLParser({
    attributeNamePrefix: '',
    removeNSPrefix: true
  })
  return parser.parse(xml) as T
}
