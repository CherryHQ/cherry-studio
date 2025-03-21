import { isNil, partial } from 'lodash'
import path from 'path-browserify-esm'
import { type FileStat } from 'webdav'

import { NUTSTORE_HOST } from '.'
import { parseXml } from './parseXML'

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

function extractNextLink(linkHeader: string): string | null {
  const matches = linkHeader.match(/<([^>]+)>;\s*rel="next"/)
  return matches ? matches[1] : null
}

function convertToFileStat(serverBase: string, item: WebDAVResponse['multistatus']['response'][number]): FileStat {
  const props = item.propstat.prop
  const isDir = !isNil(props.resourcetype?.collection)
  const href = decodeURIComponent(item.href)
  const filename = serverBase === '/' ? href : path.join('/', href.replace(serverBase, ''))

  return {
    filename,
    basename: path.basename(filename),
    lastmod: props.getlastmodified || '',
    size: props.getcontentlength ? parseInt(props.getcontentlength, 10) : 0,
    type: isDir ? 'directory' : 'file',
    etag: null,
    mime: props.getcontenttype
  }
}

export async function getDirectoryContents(token: string, target: string): Promise<FileStat[]> {
  const contents: FileStat[] = []
  if (!target.startsWith('/')) {
    target = '/' + target
  }

  let currentUrl = `${NUTSTORE_HOST}${target}`

  // eslint-disable-next-line no-constant-condition
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
export interface StatModel {
  path: string
  basename: string
  isDir: boolean
  isDeleted: boolean
  mtime: number
  size: number
}

export function fileStatToStatModel(from: FileStat): StatModel {
  return {
    path: from.filename,
    basename: from.basename,
    isDir: from.type === 'directory',
    isDeleted: false,
    mtime: new Date(from.lastmod).valueOf(),
    size: from.size
  }
}
