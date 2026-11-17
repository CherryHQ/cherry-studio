import type * as ChildProcess from 'node:child_process'
import { runInNewContext } from 'node:vm'

import { vi } from 'vitest'

import * as lifecycle from '../lifecycle'
import { type AppRecord } from '../lifecycle'
import { macRuntimeExecutable } from '../macRuntime'
import { getRunPaths } from '../paths'
import * as processes from '../process'
import { allowMacNotificationPermission, findMacNotification, setMacNotificationCenterOpen } from '../systemAutomation'

const { command, asyncCommand } = vi.hoisted(() => ({ command: vi.fn(), asyncCommand: vi.fn() }))
vi.mock('node:child_process', async (original) => {
  const { promisify } = await import('node:util')
  Object.defineProperty(asyncCommand, promisify.custom, {
    value: (...args: unknown[]) => Promise.resolve(asyncCommand(...args))
  })
  return { ...(await original<typeof ChildProcess>()), execFileSync: command, execFile: asyncCommand }
})

beforeEach(() => {
  const record = { platform: 'macos', electronPid: 42 } as AppRecord
  vi.spyOn(lifecycle, 'readAppRecord').mockReturnValue(record)
  vi.spyOn(processes, 'assertOwnedProcess').mockImplementation(() => undefined)
})
afterEach(() => {
  vi.restoreAllMocks()
  command.mockReset()
  asyncCommand.mockReset()
})

it('opens the actual notification after expanding its stack and waiting for refreshed entries', () => {
  command.mockReturnValueOnce('expanded').mockReturnValueOnce('absent').mockReturnValueOnce('found')
  expect(findMacNotification(getRunPaths('/owned-run'), 'Unique completed answer', true)).toBe(true)
})

it('never reports opening a notification when only a stack was expanded', () => {
  let now = 0
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  command.mockImplementation(() => {
    now += 1000
    return 'expanded'
  })
  expect(findMacNotification(getRunPaths('/owned-run'), 'Unique completed answer', true)).toBe(false)
})

it('preserves automation permission failures after a stack expands', () => {
  command.mockReturnValueOnce('expanded').mockImplementationOnce(() => {
    throw new Error('Automation permission denied')
  })
  expect(() => findMacNotification(getRunPaths('/owned-run'), 'Unique completed answer', true)).toThrow(
    'Automation permission denied'
  )
})

it('finds a grouped MenuBarAgent clock and closes despite a stale notification element', () => {
  const missing = Object.assign(new Error('Missing accessibility object'), { errorNumber: -1728 })
  const element = (identifier: string, children: unknown[] = []) => ({
    role: () => 'AXGroup',
    attributes: { byName: () => ({ value: () => identifier }) },
    uiElements: () => children
  })
  const stale = {
    attributes: {
      byName: () => ({
        value: () => {
          throw missing
        }
      })
    },
    uiElements: () => {
      throw missing
    }
  }
  const content = element('notification-content', [
    {
      attributes: { byName: () => ({ value: () => '' }) },
      uiElements: () => {
        throw new Error('Panel visibility must not traverse content before its sibling toolbar')
      }
    }
  ])
  let open = true
  command.mockImplementation((_command: string, args: string[]) => {
    return runInNewContext(args[3], {
      Application: () => ({
        processes: {
          byName: () => ({
            windows: () => (open ? [element('', [stale, content, element('widget-editor-button')])] : [])
          }),
          whose:
            ({ name }: { name: string }) =>
            () =>
              name === 'MenuBarAgent'
                ? [
                    {
                      menuBars: () => [
                        {
                          attributes: { byName: () => ({ value: () => 'menu-extras' }) },
                          role: () => 'AXMenuBar',
                          uiElements: () => [
                            {
                              attributes: { byName: () => ({ value: () => 'other-menu' }) },
                              role: () => 'AXMenuBarItem',
                              uiElements: () => {
                                throw new Error('Must not open unrelated dropdowns')
                              }
                            },
                            element('clock-group', [
                              {
                                attributes: { byName: () => ({ value: () => 'com.apple.menuextra.clock' }) },
                                click: () => {
                                  open = !open
                                }
                              }
                            ])
                          ]
                        }
                      ]
                    }
                  ]
                : []
        }
      }),
      delay: () => undefined
    })
  })

  expect(setMacNotificationCenterOpen(getRunPaths('/owned-run'), false)).toBe(true)
  expect(setMacNotificationCenterOpen(getRunPaths('/owned-run'), false)).toBe(false)

  expect(open).toBe(false)
})

it('does not hide a denied Notification Center inspection as a closed panel', () => {
  const denied = Object.assign(new Error('Automation permission denied'), { errorNumber: -1743 })
  command.mockImplementation((_command: string, args: string[]) => {
    runInNewContext(args[3], {
      Application: () => ({
        processes: {
          byName: () => ({
            windows: () => {
              throw denied
            }
          })
        }
      }),
      ObjC: { import: () => undefined }
    })
    return ''
  })

  expect(() => setMacNotificationCenterOpen(getRunPaths('/owned-run'), false)).toThrow('Automation permission denied')
})

it('fails when clicking the clock does not open Notification Center', () => {
  let now = 0
  command.mockImplementation((_command: string, args: string[]) => {
    runInNewContext(args[3], {
      Application: () => ({
        processes: {
          byName: () => ({ windows: () => [] }),
          whose: () => () => [
            {
              menuBars: () => [
                {
                  attributes: { byName: () => ({ value: () => 'menu-extras' }) },
                  role: () => 'AXMenuBar',
                  uiElements: () => [
                    {
                      attributes: { byName: () => ({ value: () => 'com.apple.menuextra.clock' }) },
                      click: () => undefined
                    }
                  ]
                }
              ]
            }
          ]
        }
      }),
      Date: { now: () => (now += 1000) },
      delay: () => undefined
    })
    return ''
  })

  expect(() => setMacNotificationCenterOpen(getRunPaths('/owned-run'), true)).toThrow(
    'Notification Center did not reach the requested state'
  )
})

it('grants only the permission card for the isolated signed application', async () => {
  const paths = getRunPaths('/owned-run')
  vi.mocked(lifecycle.readAppRecord).mockReturnValue({
    platform: 'macos',
    electronPid: 42,
    executablePath: macRuntimeExecutable(paths)
  } as AppRecord)
  const name = 'Cherry Studio E2E 012345abcdef'
  command.mockReturnValue(name)
  const allowed: string[] = []
  const card = (applicationName: string) => {
    const group = {
      role: () => 'AXGroup',
      name: () => '',
      actions: () => [{ name: () => 'Name:Allow\nTarget:0x0', perform: () => allowed.push(applicationName) }],
      uiElements: () => [
        {
          role: () => 'AXStaticText',
          name: () => `Notifications for ${applicationName}`,
          attributes: { byName: () => ({ value: () => group }) },
          uiElements: () => []
        }
      ]
    }
    return group
  }
  asyncCommand.mockImplementation((_file: string, args: string[]) => ({
    stdout: runInNewContext(args[3], {
      Application: () => ({
        processes: { byName: () => ({ windows: () => [card('Another Application'), card(name)] }) }
      })
    }),
    stderr: ''
  }))

  await allowMacNotificationPermission(paths)

  expect(allowed).toEqual([name])
})

it('rejects permission changes for an ordinary developer runtime', async () => {
  vi.mocked(lifecycle.readAppRecord).mockReturnValue({
    platform: 'macos',
    electronPid: 42,
    executablePath: '/Applications/Electron.app/Contents/MacOS/Electron'
  } as AppRecord)

  await expect(allowMacNotificationPermission(getRunPaths('/owned-run'))).rejects.toThrow(
    'isolated signed macOS runtime'
  )
})
