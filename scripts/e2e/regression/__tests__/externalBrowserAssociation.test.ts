import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'

import { vi } from 'vitest'

import { cleanupExternalResources, observeExternalResource, registerExternalResource } from '../externalResources'
import { getRunPaths, type RunPaths } from '../paths'

const { native } = vi.hoisted(() => ({ native: vi.fn() }))
vi.mock('node:child_process', () => ({ execFileSync: native }))

const safari = 'com.apple.Safari'
const chrome = 'com.google.Chrome'
const title = 'Unique owned HTML preview'
let paths: RunPaths
let htmlHandler: string
let tabs: Record<string, { id: number; title: string }[]>
let runningBundles: string[]
let windowIds: Record<string, number>
let replaceWindowDuringQuit: boolean
let closeTabFails: boolean
let windowInspectionError:
  | 'ids'
  | 'tabs'
  | 'stale-proxy'
  | 'disappeared'
  | 'replaced'
  | 'refresh-denied'
  | 'permission-disappeared'
  | undefined

beforeEach(() => {
  paths = getRunPaths(mkdtempSync(join(tmpdir(), 'cherry-browser-association-')))
  htmlHandler = safari
  runningBundles = [chrome, safari]
  windowIds = { [safari]: 1, [chrome]: 1 }
  replaceWindowDuringQuit = false
  closeTabFails = false
  windowInspectionError = undefined
  tabs = {
    [safari]: [{ id: 1, title: 'User Safari tab' }],
    [chrome]: [{ id: 1, title: 'User Chrome tab' }]
  }
  native.mockImplementation((_command, args: string[]) => {
    const request = JSON.parse(args.at(-1)!) as { action: string }
    const applications = runningBundles.map((bundleIdentifier) => ({
      bundleIdentifier,
      processIdentifier: bundleIdentifier === chrome ? 100 : 101,
      launchDate: { timeIntervalSince1970: 1 },
      terminated: false,
      get terminate() {
        this.terminated = true
        runningBundles = runningBundles.filter((bundle) => bundle !== bundleIdentifier)
        return true
      }
    }))
    const application = Object.assign(
      (bundle: string) =>
        bundle === 'System Events'
          ? { processes: { whose: () => () => [{ windows: () => [] }] } }
          : {
              windows: {
                id: () => {
                  if (windowInspectionError === 'ids') throw new Error('Automation permission denied')
                  return tabs[bundle].length ? [windowIds[bundle]] : []
                },
                byId: (id: number) => ({
                  tabs: () => {
                    if (replaceWindowDuringQuit && request.action === 'quit') {
                      replaceWindowDuringQuit = false
                      windowInspectionError = 'replaced'
                    }
                    if (id !== windowIds[bundle])
                      throw new TypeError("null is not an object (evaluating 'window.tabs()')")
                    if (windowInspectionError === 'tabs') throw new Error('Automation permission denied')
                    if (windowInspectionError === 'stale-proxy')
                      throw new TypeError("null is not an object (evaluating 'window.tabs()')")
                    if (windowInspectionError) {
                      const replacement = windowInspectionError === 'replaced'
                      const permissionDenied = windowInspectionError === 'permission-disappeared'
                      tabs[bundle] = replacement ? [{ id: 3, title: 'Foreign replacement tab' }] : []
                      windowIds[bundle] += 1
                      windowInspectionError = windowInspectionError === 'refresh-denied' ? 'ids' : undefined
                      if (permissionDenied) throw new Error('Automation permission denied')
                      throw new TypeError("null is not an object (evaluating 'window.tabs()')")
                    }
                    return tabs[bundle].map((tab) => ({
                      id: () => tab.id,
                      name: () => tab.title,
                      title: () => tab.title,
                      url: () => 'about:blank',
                      close: () => {
                        if (closeTabFails) throw new Error('Owned tab temporarily refused to close')
                        tabs[bundle] = tabs[bundle].filter(({ id }) => id !== tab.id)
                      }
                    }))
                  }
                })
              }
            },
      { currentApplication: () => ({}) }
    )
    const dollar = Object.assign((value: string) => ({ stringByResolvingSymlinksInPath: value }), {
      NSWorkspace: {
        sharedWorkspace: {
          URLForApplicationToOpenURL: (url: { file: boolean }) => ({
            bundleIdentifier: url.file ? htmlHandler : chrome
          }),
          runningApplications: {
            count: applications.length,
            objectAtIndex: (index: number) => applications[index]
          }
        }
      },
      NSURL: { URLWithString: () => ({ file: false }), fileURLWithPath: () => ({ file: true }) },
      NSBundle: { bundleWithURL: (url: unknown) => url }
    })
    return runInNewContext(args[3] + '\nrun(' + JSON.stringify([args.at(-1)]) + ')', {
      $: dollar,
      ObjC: { import: () => {}, unwrap: (value: unknown) => value },
      Application: application,
      delay: () => {}
    })
  })
})

afterEach(() => rmSync(paths.root, { recursive: true, force: true }))

it('tracks the HTML file handler and closes its new tab while preserving existing tabs in both browsers', () => {
  const path = join(paths.root, 'preview.html')
  writeFileSync(path, '')
  const id = registerExternalResource(paths, 'macos', { kind: 'browser', title, path })
  tabs[safari].push({ id: 2, title })

  expect(observeExternalResource(paths, id)).toBe(true)
  cleanupExternalResources(paths)

  expect(tabs).toEqual({
    [safari]: [{ id: 1, title: 'User Safari tab' }],
    [chrome]: [{ id: 1, title: 'User Chrome tab' }]
  })
  expect(JSON.parse(readFileSync(join(paths.private, 'external-resources.json'), 'utf8'))).toEqual([])
})

it('rejects an unsupported HTML handler before the external file is opened', () => {
  htmlHandler = 'com.apple.TextEdit'
  const path = join(paths.root, 'preview.html')
  writeFileSync(path, '')

  expect(() => registerExternalResource(paths, 'macos', { kind: 'browser', title, path })).toThrow()
  expect(tabs[safari]).toEqual([{ id: 1, title: 'User Safari tab' }])
  expect(tabs[chrome]).toEqual([{ id: 1, title: 'User Chrome tab' }])
})

it('cleans up the final browser tab when its browser has no windows left', () => {
  runningBundles = [chrome]
  tabs[safari] = []
  const path = join(paths.root, 'preview.html')
  writeFileSync(path, '')
  const id = registerExternalResource(paths, 'macos', { kind: 'browser', title, path })
  runningBundles.push(safari)
  tabs[safari].push({ id: 2, title })

  expect(observeExternalResource(paths, id)).toBe(true)
  cleanupExternalResources(paths)

  expect(runningBundles).toEqual([chrome])
  expect(tabs[chrome]).toEqual([{ id: 1, title: 'User Chrome tab' }])
  expect(tabs[safari]).toEqual([])
  expect(JSON.parse(readFileSync(join(paths.private, 'external-resources.json'), 'utf8'))).toEqual([])
})

it.each(['ids', 'tabs', 'stale-proxy'] as const)(
  'preserves the browser and cleanup ledger when %s inspection fails',
  (method) => {
    const id = registerExternalResource(paths, 'macos', { kind: 'browser', title })
    tabs[chrome].push({ id: 2, title })
    expect(observeExternalResource(paths, id)).toBe(true)
    windowInspectionError = method

    expect(() => cleanupExternalResources(paths)).toThrow('External application cleanup failed')

    expect(tabs[chrome]).toEqual([
      { id: 1, title: 'User Chrome tab' },
      { id: 2, title }
    ])
    expect(JSON.parse(readFileSync(join(paths.private, 'external-resources.json'), 'utf8'))).toEqual([
      expect.objectContaining({ id })
    ])
  }
)

it.each(['disappeared', 'replaced', 'refresh-denied', 'permission-disappeared'] as const)(
  'only ignores a failed tabs query after confirming its window disappeared: %s',
  (failure) => {
    runningBundles = [chrome]
    tabs[safari] = []
    const path = join(paths.root, 'preview.html')
    writeFileSync(path, '')
    const id = registerExternalResource(paths, 'macos', { kind: 'browser', title, path })
    runningBundles.push(safari)
    tabs[safari].push({ id: 2, title })
    expect(observeExternalResource(paths, id)).toBe(true)
    windowInspectionError = failure

    if (failure === 'disappeared') {
      cleanupExternalResources(paths)
      expect(runningBundles).toEqual([chrome])
      expect(JSON.parse(readFileSync(join(paths.private, 'external-resources.json'), 'utf8'))).toEqual([])
    } else {
      expect(() => cleanupExternalResources(paths)).toThrow('External application cleanup failed')
      expect(runningBundles).toContain(safari)
      expect(JSON.parse(readFileSync(join(paths.private, 'external-resources.json'), 'utf8'))).toEqual([
        expect.objectContaining({ id })
      ])
    }
    if (failure === 'replaced') expect(tabs[safari]).toEqual([{ id: 3, title: 'Foreign replacement tab' }])
    expect(tabs[chrome]).toEqual([{ id: 1, title: 'User Chrome tab' }])
  }
)

it('keeps URL-only browser cleanup associated with the HTTPS handler', () => {
  const id = registerExternalResource(paths, 'macos', { kind: 'browser', title })
  tabs[chrome].push({ id: 2, title })

  expect(observeExternalResource(paths, id)).toBe(true)
  cleanupExternalResources(paths)

  expect(tabs[safari]).toEqual([{ id: 1, title: 'User Safari tab' }])
  expect(tabs[chrome]).toEqual([{ id: 1, title: 'User Chrome tab' }])
})

it('preserves a foreign replacement window that appears inside the quit snapshot', () => {
  runningBundles = [chrome]
  tabs[safari] = []
  const path = join(paths.root, 'preview.html')
  writeFileSync(path, '')
  const id = registerExternalResource(paths, 'macos', { kind: 'browser', title, path })
  runningBundles.push(safari)
  tabs[safari].push({ id: 2, title })
  expect(observeExternalResource(paths, id)).toBe(true)
  closeTabFails = true
  replaceWindowDuringQuit = true

  let cleanupError: unknown
  try {
    cleanupExternalResources(paths)
  } catch (error) {
    cleanupError = error
  }

  expect(runningBundles).toContain(safari)
  expect(tabs[safari]).toEqual([{ id: 3, title: 'Foreign replacement tab' }])
  expect(tabs[chrome]).toEqual([{ id: 1, title: 'User Chrome tab' }])
  expect(JSON.parse(readFileSync(join(paths.private, 'external-resources.json'), 'utf8'))).toEqual([
    expect.objectContaining({ id })
  ])
  expect(cleanupError).toBeInstanceOf(AggregateError)
})
