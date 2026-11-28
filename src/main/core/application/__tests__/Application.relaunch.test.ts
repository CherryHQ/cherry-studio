import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { app, dialog } from 'electron'
import { afterEach, expect, it, vi } from 'vitest'

import { bootConfigService } from '@main/data/bootConfig'

import { Application } from '../Application'

vi.unmock('@application')

afterEach(() => vi.restoreAllMocks())

it.each([false, true])('exits development relaunch with Electron ready=%s', (ready) => {
  vi.spyOn(bootConfigService, 'set').mockImplementation(() => {})
  vi.spyOn(bootConfigService, 'flush').mockImplementation(() => {})
  const exits: number[] = []
  Object.assign(app, {
    isReady: vi.fn(() => ready),
    exit: vi.fn((code: number) => exits.push(code))
  })
  Object.assign(dialog, {
    showMessageBoxSync: vi.fn(() => {
      if (!ready) throw new Error('dialog module can only be used after app is ready')
      return 0
    })
  })
  Application.getInstance().relaunch()
  expect(exits).toEqual([0])
  if (ready)
    expect(dialog.showMessageBoxSync).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Manual Restart Required' })
    )
})

function useMarkerFile(contents?: string): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'run-marker-')), 'last-exit')
  if (contents !== undefined) fs.writeFileSync(file, contents)
  Application.getInstance().__setPathMapForTesting({ 'app.last_exit_marker_file': file } as never)
  return file
}

it('records the run as ended cleanly before a relaunch exits', () => {
  const marker = useMarkerFile('running')
  vi.spyOn(bootConfigService, 'flush').mockImplementation(() => {})
  let atExit: string | undefined
  Object.assign(app, { isReady: vi.fn(() => false), exit: vi.fn(() => (atExit = fs.readFileSync(marker, 'utf8'))) })

  Application.getInstance().relaunch()

  expect(atExit).toBe('clean')
})

it.each([
  [undefined, 'unknown'],
  ['running', 'unclean'],
  ['clean', 'clean']
] as const)('reads a previous run marker of %s as a %s exit and marks this run as running', (previous, lastExit) => {
  const marker = useMarkerFile(previous)
  const set = vi.spyOn(bootConfigService, 'set')
  const application = Application.getInstance()

  // bootstrap() starts with this step; the rest of bootstrap needs the full service graph.
  ;(application as unknown as { markRunning(): void }).markRunning()

  expect(application.lastExit).toBe(lastExit)
  expect(fs.readFileSync(marker, 'utf8')).toBe('running')
  // A broken or shared boot config file is left as it is.
  expect(set).not.toHaveBeenCalled()
})
