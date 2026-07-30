import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { type BackupPlatform, type ManagedRootRebaseTable, prepareManagedRootRebase } from '../managedPathRebase'
import {
  classifyExternalWorkspacePath,
  type ExternalWorkspaceGateInput,
  gateExternalWorkspacePath
} from '../workspacePathPolicy'

/**
 * Layer 2 of the workspace path policy (docs/references/backup/README.md §3.1).
 *
 * The gate is pure, so almost everything provable about it is proved here without
 * a filesystem — including the two cases that matter most and cannot be produced
 * on a POSIX CI machine at all: a Windows UNC path and a Windows path on the
 * wrong drive.
 */

const WIN_ANCHOR = 'C:\\Users\\me\\AppData\\Roaming\\CherryStudio\\Data\\Agents\\system'
const POSIX_ANCHOR = '/Users/me/Library/CherryStudio/Data/Agents/system'

function gate(overrides: Partial<ExternalWorkspaceGateInput> & { value: string }) {
  const platform: BackupPlatform = overrides.targetPlatform ?? 'win32'
  return gateExternalWorkspacePath({
    producerPlatform: overrides.producerPlatform ?? platform,
    targetPlatform: platform,
    localAnchorPath:
      'localAnchorPath' in overrides
        ? (overrides.localAnchorPath ?? null)
        : platform === 'win32'
          ? WIN_ANCHOR
          : POSIX_ANCHOR,
    targetManagedRoots: overrides.targetManagedRoots ?? [],
    value: overrides.value
  })
}

describe('gateExternalWorkspacePath', () => {
  it('admits an ordinary win32 path on this install’s own drive for probing', () => {
    expect(gate({ value: 'C:\\Users\\me\\code\\project' })).toEqual({ kind: 'probe' })
    // Drive letters are compared case-insensitively, like every other win32 component.
    expect(gate({ value: 'c:\\Users\\me\\code\\project' })).toEqual({ kind: 'probe' })
  })

  it('refuses a UNC path before anything can touch it', () => {
    // The credential-leak shape: resolving it makes Windows authenticate to the
    // attacker's host. It must lose on the string alone.
    expect(gate({ value: '\\\\attacker\\share\\loot' })).toEqual({ kind: 'disconnect', reason: 'network-path' })
    expect(gate({ value: '//attacker/share/loot' })).toEqual({ kind: 'disconnect', reason: 'network-path' })
  })

  it('refuses a drive this install does not run from', () => {
    expect(gate({ value: 'Z:\\loot' })).toEqual({ kind: 'disconnect', reason: 'foreign-volume' })
  })

  it('refuses a path whose syntax belongs to the other platform', () => {
    expect(gate({ value: '/Users/me/code', producerPlatform: 'darwin', targetPlatform: 'win32' })).toEqual({
      kind: 'disconnect',
      reason: 'platform-mismatch'
    })
    expect(gate({ value: 'C:\\code', producerPlatform: 'win32', targetPlatform: 'linux' })).toEqual({
      kind: 'disconnect',
      reason: 'platform-mismatch'
    })
  })

  it('refuses anything that is not an absolute, normalized path', () => {
    expect(gate({ value: 'relative/path', targetPlatform: 'linux' })).toEqual({
      kind: 'disconnect',
      reason: 'not-absolute'
    })
    expect(gate({ value: '', targetPlatform: 'linux' })).toEqual({ kind: 'disconnect', reason: 'not-absolute' })
    expect(gate({ value: '/Users/me/../../etc', targetPlatform: 'linux' })).toEqual({
      kind: 'disconnect',
      reason: 'unnormalized'
    })
  })

  it('refuses a path inside one of this device’s own managed roots', () => {
    // Such a path is an overlay target the archive never declared as a resource;
    // honouring it would make the materialized database require a unit the
    // manifest does not carry, and the authority check would refuse the restore.
    const targetManagedRoots = ['/Users/me/Library/CherryStudio/Data/Notes', POSIX_ANCHOR]
    expect(gate({ value: `${POSIX_ANCHOR}/2026-01-01/s-1`, targetPlatform: 'linux', targetManagedRoots })).toEqual({
      kind: 'disconnect',
      reason: 'target-managed'
    })
    // A sibling that merely shares a character prefix is genuinely external.
    expect(gate({ value: `${POSIX_ANCHOR}-elsewhere/x`, targetPlatform: 'linux', targetManagedRoots })).toEqual({
      kind: 'probe'
    })
  })

  it('refuses a win32 path when no trusted local anchor is available', () => {
    expect(gate({ value: 'C:\\Users\\me\\code', localAnchorPath: null })).toEqual({
      kind: 'disconnect',
      reason: 'no-local-anchor'
    })
  })

  it('needs no volume anchor on POSIX', () => {
    // An absolute POSIX path addresses this machine's own namespace; there is no
    // volume token to compare and no remote-authentication trigger to gate.
    expect(gate({ value: '/Users/me/code', targetPlatform: 'linux', localAnchorPath: null })).toEqual({
      kind: 'probe'
    })
  })
})

describe('classifyExternalWorkspacePath', () => {
  let workDir = ''

  const TARGET_NOTES = '/target/Data/Notes'
  const TARGET_WORKSPACES = '/target/Data/Agents/system'

  function table(platform: BackupPlatform = 'linux'): ManagedRootRebaseTable {
    const prepared = prepareManagedRootRebase({
      producerPlatform: platform,
      producerRoots: [
        { key: 'feature.notes.data', path: platform === 'win32' ? 'C:\\Producer\\Notes' : '/producer/Data/Notes' },
        {
          key: 'feature.agents.system_workspaces',
          path: platform === 'win32' ? 'C:\\Producer\\Agents\\system' : '/producer/Data/Agents/system'
        }
      ],
      targetPlatform: platform,
      targetRoots: {
        'feature.notes.data': platform === 'win32' ? 'C:\\Target\\Notes' : TARGET_NOTES,
        'feature.agents.system_workspaces': platform === 'win32' ? 'C:\\Target\\Agents\\system' : TARGET_WORKSPACES
      }
    })
    if (!prepared.ok) throw new Error(`fixture table invalid: ${prepared.error.code}`)
    return prepared.table
  }

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'cs-wsprobe-'))
  })

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true })
  })

  it('keeps a real external directory that exists on this device', () => {
    const dir = join(workDir, 'project')
    mkdirSync(dir)

    expect(classifyExternalWorkspacePath(table(), dir)).toEqual({ kind: 'keep' })
  })

  it('disconnects a path that is not there', () => {
    expect(classifyExternalWorkspacePath(table(), join(workDir, 'missing'))).toEqual({
      kind: 'disconnect',
      reason: 'absent'
    })
  })

  it('disconnects a path that exists but is not a directory', () => {
    const file = join(workDir, 'not-a-dir')
    writeFileSync(file, 'x')

    expect(classifyExternalWorkspacePath(table(), file)).toEqual({ kind: 'disconnect', reason: 'absent' })
  })

  it('never probes a path the gate already refused', () => {
    let probed = 0
    const probe = {
      isRealDirectory: () => {
        probed += 1
        return true
      }
    }

    // A UNC path against a win32 table: the one value that must not reach a stat.
    expect(classifyExternalWorkspacePath(table('win32'), '\\\\attacker\\share\\loot', probe)).toEqual({
      kind: 'disconnect',
      reason: 'network-path'
    })
    expect(probed).toBe(0)
  })

  it('anchors the win32 volume proof on the target workspaces root, not on the archive', () => {
    // The anchor comes from the trusted registry-resolved root (C: here), so a
    // path on another drive loses even though the archive declared its own roots.
    expect(classifyExternalWorkspacePath(table('win32'), 'D:\\loot')).toEqual({
      kind: 'disconnect',
      reason: 'foreign-volume'
    })
    expect(
      classifyExternalWorkspacePath(table('win32'), 'C:\\Users\\me\\code', { isRealDirectory: () => true })
    ).toEqual({ kind: 'keep' })
  })
})
