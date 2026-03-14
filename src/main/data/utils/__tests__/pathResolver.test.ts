import path from 'node:path'

import { describe, expect, it } from 'vitest'

import type { MountInfo, PathResolvableNode } from '../pathResolver'
import { getExtSuffix, resolvePhysicalPath } from '../pathResolver'

describe('getExtSuffix', () => {
  it('returns dot-prefixed extension for non-null ext', () => {
    expect(getExtSuffix('pdf')).toBe('.pdf')
    expect(getExtSuffix('md')).toBe('.md')
  })

  it('returns empty string for null ext', () => {
    expect(getExtSuffix(null)).toBe('')
  })
})

describe('resolvePhysicalPath', () => {
  describe('local_managed', () => {
    const mount: MountInfo = {
      providerConfig: { provider_type: 'local_managed', base_path: '/data/files' }
    }

    it('returns {base_path}/{id}.{ext}', () => {
      const node: PathResolvableNode = { id: 'abc-123', name: 'document', ext: 'pdf', mountId: 'mount_files' }
      expect(resolvePhysicalPath(node, mount)).toBe(path.join('/data/files', 'abc-123.pdf'))
    })

    it('returns {base_path}/{id} with null ext', () => {
      const node: PathResolvableNode = { id: 'abc-123', name: 'folder', ext: null, mountId: 'mount_files' }
      expect(resolvePhysicalPath(node, mount)).toBe(path.join('/data/files', 'abc-123'))
    })
  })

  describe('local_external', () => {
    const mount: MountInfo = {
      providerConfig: { provider_type: 'local_external', base_path: '/data/notes', watch: true }
    }

    it('returns {base_path}/{ancestors}/{name}.{ext}', () => {
      const node: PathResolvableNode = { id: 'n1', name: 'readme', ext: 'md', mountId: 'mount_notes' }
      const ancestors = ['project', 'docs']
      expect(resolvePhysicalPath(node, mount, ancestors)).toBe(path.join('/data/notes', 'project', 'docs', 'readme.md'))
    })

    it('returns {base_path}/{name}.{ext} with no ancestors', () => {
      const node: PathResolvableNode = { id: 'n2', name: 'notes', ext: 'md', mountId: 'mount_notes' }
      expect(resolvePhysicalPath(node, mount)).toBe(path.join('/data/notes', 'notes.md'))
    })

    it('returns path without ext when ext is null', () => {
      const node: PathResolvableNode = { id: 'n3', name: 'subfolder', ext: null, mountId: 'mount_notes' }
      expect(resolvePhysicalPath(node, mount)).toBe(path.join('/data/notes', 'subfolder'))
    })
  })

  describe('system', () => {
    const mount: MountInfo = {
      providerConfig: { provider_type: 'system' }
    }

    it('throws error for system mount', () => {
      const node: PathResolvableNode = { id: 'trash-1', name: 'Trash', ext: null, mountId: 'system_trash' }
      expect(() => resolvePhysicalPath(node, mount)).toThrow('System mount nodes have no physical storage path')
    })
  })

  describe('edge cases', () => {
    it('throws when mount has no provider config', () => {
      const mount: MountInfo = { providerConfig: null }
      const node: PathResolvableNode = { id: 'x', name: 'test', ext: 'txt', mountId: 'unknown' }
      expect(() => resolvePhysicalPath(node, mount)).toThrow('has no provider config')
    })
  })
})
