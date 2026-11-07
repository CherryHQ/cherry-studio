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
let staleWindow: boolean
let windowInspectionError: 'exists' | 'tabs' | undefined

beforeEach(() => {
  paths = getRunPaths(mkdtempSync(join(tmpdir(), 'cherry-browser-association-')))
  htmlHandler = safari
  runningBundles = [chrome, safari]
  staleWindow = false
  windowInspectionError = undefined
  tabs = {
    [safari]: [{ id: 1, title: 'User Safari tab' }],
    [chrome]: [{ id: 1, title: 'User Chrome tab' }]
  }
  native.mockImplementation((_command, args: string[]) => {
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
              windows: () =>
                tabs[bundle].length
                  ? [
                      {
                        exists: () => {
                          if (windowInspectionError === 'exists') throw new Error('Automation permission denied')
                          return true
                        },
                        id: () => 1,
                        tabs: () => {
                          if (windowInspectionError === 'tabs') throw new Error('Automation permission denied')
                          return tabs[bundle].map((tab) => ({
                            id: () => tab.id,
                            name: () => tab.title,
                            title: () => tab.title,
                            url: () => 'about:blank',
                            close: () => {
                              tabs[bundle] = tabs[bundle].filter(({ id }) => id !== tab.id)
                            }
                          }))
                        }
                      }
                    ]
                  : [
                      staleWindow
                        ? new Proxy(
                            {},
                            {
                              get: (_target, property) => {
                                if (property === 'exists') return () => false
                                throw new TypeError(`Invalid window specifier: ${String(property)}`)
                              }
                            }
                          )
                        : null
                    ]
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

it.each([false, true])('cleans up the final browser tab with a stale window proxy: %s', (stale) => {
  staleWindow = stale
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

it.each(['exists', 'tabs'] as const)('preserves the browser and cleanup ledger when %s inspection fails', (method) => {
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
})

it('keeps URL-only browser cleanup associated with the HTTPS handler', () => {
  const id = registerExternalResource(paths, 'macos', { kind: 'browser', title })
  tabs[chrome].push({ id: 2, title })

  expect(observeExternalResource(paths, id)).toBe(true)
  cleanupExternalResources(paths)

  expect(tabs[safari]).toEqual([{ id: 1, title: 'User Safari tab' }])
  expect(tabs[chrome]).toEqual([{ id: 1, title: 'User Chrome tab' }])
})
