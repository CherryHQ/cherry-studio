import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { describe, expect, it } from 'vitest'

import { parseLaunchInput } from '../launchInput'

describe('parseLaunchInput', () => {
  it('gives the first protocol URL precedence even when malformed or after operands', () => {
    expect(parseLaunchInput(['app', '/first', 'cherrystudio://[', 'cherrystudio://navigate/agents'], false)).toEqual({
      kind: 'protocol',
      url: 'cherrystudio://['
    })
  })

  it('skips the executable and the dev app entry only in defaultApp mode', () => {
    expect(parseLaunchInput(['/executable'], false)).toBeUndefined()
    expect(parseLaunchInput(['electron', '/app-entry'], true)).toBeUndefined()
    expect(parseLaunchInput(['electron', '/app-entry', '/folder'], true)).toEqual({
      kind: 'folder',
      operand: '/folder'
    })
    expect(parseLaunchInput(['app', '/folder'], false)).toEqual({ kind: 'folder', operand: '/folder' })
  })

  it('uses -- to end switch parsing', () => {
    expect(parseLaunchInput(['app', '--profile', '/profile', '--', '-folder', '/later'], false)).toEqual({
      kind: 'folder',
      operand: '-folder'
    })
  })

  it('never treats separate or inline switch values as folder operands', () => {
    expect(parseLaunchInput(['app', '--profile', '/profile'], false)).toBeUndefined()
    expect(parseLaunchInput(['app', '-p', '/profile', '--flag=value', '/folder'], false)).toEqual({
      kind: 'folder',
      operand: '/folder'
    })
    expect(parseLaunchInput(['app', '--profile=/profile', '/folder'], false)).toEqual({
      kind: 'folder',
      operand: '/folder'
    })
  })

  it.each(['relative', '/missing', '', 'file:///bad%FF', 'file:///bad%'])(
    'keeps the first operand %j without falling back',
    (first) => {
      expect(parseLaunchInput(['app', first, '/valid'], false)).toEqual({ kind: 'folder', operand: first })
    }
  )

  it('rejects remote file authorities on POSIX and preserves UNC transport on Windows', () => {
    const remote = 'file://remote/folder'
    expect(parseLaunchInput(['app', remote, '/later'], false)).toEqual({
      kind: 'folder',
      operand: process.platform === 'win32' ? String.raw`\\remote\folder` : remote
    })
  })

  it('decodes local file URLs once, preserving special filename characters', () => {
    const folder = path.resolve('/folder with spaces 中文 + # 100%') + path.sep
    expect(parseLaunchInput(['app', pathToFileURL(folder).href, '/later'], false)).toEqual({
      kind: 'folder',
      operand: folder
    })
  })

  it('keeps a bare path verbatim, including whitespace and dot segments', () => {
    const operand = '/folder/../project '
    expect(parseLaunchInput(['app', operand, '/later'], false)).toEqual({ kind: 'folder', operand })
  })
})
