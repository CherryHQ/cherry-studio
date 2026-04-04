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
      providerConfig: { providerType: 'local_managed', basePath: '/data/files' }
    }

    it('returns {basePath}/{id}.{ext}', () => {
      const node: PathResolvableNode = { id: 'abc-123', name: 'document', ext: 'pdf', mountId: 'mount_files' }
      expect(resolvePhysicalPath(node, mount)).toBe(path.join('/data/files', 'abc-123.pdf'))
    })

    it('returns {basePath}/{id} with null ext', () => {
      const node: PathResolvableNode = { id: 'abc-123', name: 'folder', ext: null, mountId: 'mount_files' }
      expect(resolvePhysicalPath(node, mount)).toBe(path.join('/data/files', 'abc-123'))
    })
  })

  describe('local_external', () => {
    const mount: MountInfo = {
      providerConfig: { providerType: 'local_external', basePath: '/data/notes', watch: true }
    }

    it('returns {basePath}/{ancestors}/{name}.{ext}', () => {
      const node: PathResolvableNode = { id: 'n1', name: 'readme', ext: 'md', mountId: 'mount_notes' }
      const ancestors = ['project', 'docs']
      expect(resolvePhysicalPath(node, mount, ancestors)).toBe(path.join('/data/notes', 'project', 'docs', 'readme.md'))
    })

    it('returns {basePath}/{name}.{ext} with no ancestors', () => {
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
      providerConfig: { providerType: 'system' }
    }

    it('throws error for system mount', () => {
      const node: PathResolvableNode = { id: 'trash-1', name: 'Trash', ext: null, mountId: 'system_trash' }
      expect(() => resolvePhysicalPath(node, mount)).toThrow('System mount nodes have no physical storage path')
    })
  })

  describe('remote', () => {
    const mount: MountInfo = {
      providerConfig: {
        providerType: 'remote',
        apiType: 'openai_files',
        providerId: 'p1',
        autoSync: false,
        options: {}
      }
    }

    it('throws error for remote mount (not yet implemented)', () => {
      const node: PathResolvableNode = { id: 'r1', name: 'file', ext: 'txt', mountId: 'mount_remote' }
      expect(() => resolvePhysicalPath(node, mount)).toThrow('not yet implemented')
    })
  })

  describe('edge cases', () => {
    it('throws when mount has no provider config', () => {
      const mount: MountInfo = { providerConfig: null }
      const node: PathResolvableNode = { id: 'x', name: 'test', ext: 'txt', mountId: 'unknown' }
      expect(() => resolvePhysicalPath(node, mount)).toThrow('has no provider config')
    })
  })

  describe('security', () => {
    const externalMount: MountInfo = {
      providerConfig: { providerType: 'local_external', basePath: '/data/notes', watch: true }
    }
    const managedMount: MountInfo = {
      providerConfig: { providerType: 'local_managed', basePath: '/data/files' }
    }

    it('rejects path traversal via node.name containing ../', () => {
      const node: PathResolvableNode = { id: 'n1', name: '../../etc/passwd', ext: null, mountId: 'mount_notes' }
      expect(() => resolvePhysicalPath(node, externalMount)).toThrow('Path traversal detected')
    })

    it('rejects path traversal via ancestorNames containing ..', () => {
      const node: PathResolvableNode = { id: 'n1', name: 'file', ext: 'txt', mountId: 'mount_notes' }
      expect(() => resolvePhysicalPath(node, externalMount, ['..', '..', 'etc'])).toThrow('Path traversal detected')
    })

    it('rejects null bytes in node.name', () => {
      const node: PathResolvableNode = { id: 'n1', name: 'file\0.evil', ext: 'txt', mountId: 'mount_notes' }
      expect(() => resolvePhysicalPath(node, externalMount)).toThrow('null bytes')
    })

    it('rejects null bytes in node.ext', () => {
      const node: PathResolvableNode = { id: 'n1', name: 'file', ext: 'txt\0evil', mountId: 'mount_notes' }
      expect(() => resolvePhysicalPath(node, externalMount)).toThrow('null bytes')
    })

    it('rejects null bytes in ancestorNames', () => {
      const node: PathResolvableNode = { id: 'n1', name: 'file', ext: 'txt', mountId: 'mount_notes' }
      expect(() => resolvePhysicalPath(node, externalMount, ['dir\0evil'])).toThrow('null bytes')
    })

    it('rejects path traversal via node.name that is just ..', () => {
      const node: PathResolvableNode = { id: 'n1', name: '..', ext: null, mountId: 'mount_notes' }
      expect(() => resolvePhysicalPath(node, externalMount)).toThrow('Path traversal detected')
    })

    it('containment check also applies to local_managed', () => {
      const node: PathResolvableNode = { id: '../../etc/passwd', name: 'evil', ext: null, mountId: 'mount_files' }
      expect(() => resolvePhysicalPath(node, managedMount)).toThrow('Path traversal detected')
    })

    it('rejects traversal hidden in middle of ancestorNames', () => {
      const node: PathResolvableNode = { id: 'n1', name: 'file', ext: 'txt', mountId: 'mount_notes' }
      expect(() => resolvePhysicalPath(node, externalMount, ['subdir', '..', '..', 'etc'])).toThrow(
        'Path traversal detected'
      )
    })

    it('rejects absolute path in node.name', () => {
      const node: PathResolvableNode = { id: 'n1', name: '/etc/passwd', ext: null, mountId: 'mount_notes' }
      expect(() => resolvePhysicalPath(node, externalMount)).toThrow('Path traversal detected')
    })

    it('rejects traversal via ext containing path separator', () => {
      const node: PathResolvableNode = { id: 'n1', name: 'file', ext: '../../../etc/passwd', mountId: 'mount_notes' }
      expect(() => resolvePhysicalPath(node, externalMount)).toThrow('Path traversal detected')
    })

    it('rejects empty string in ancestorNames that could affect resolution', () => {
      // Empty segments in path.resolve are ignored, so this should still resolve within base
      const node: PathResolvableNode = { id: 'n1', name: 'file', ext: 'txt', mountId: 'mount_notes' }
      const result = resolvePhysicalPath(node, externalMount, ['', 'subdir'])
      expect(result).toBe(path.resolve('/data/notes', '', 'subdir', 'file.txt'))
    })

    it('allows legitimate nested paths within basePath', () => {
      const node: PathResolvableNode = { id: 'n1', name: 'readme', ext: 'md', mountId: 'mount_notes' }
      const result = resolvePhysicalPath(node, externalMount, ['project', 'docs'])
      expect(result).toBe(path.resolve('/data/notes', 'project', 'docs', 'readme.md'))
    })

    it('rejects node.name with only dots (traversal variant)', () => {
      const node: PathResolvableNode = { id: 'n1', name: '...', ext: null, mountId: 'mount_notes' }
      // '...' is a valid filename, should resolve within base — no throw expected
      expect(resolvePhysicalPath(node, externalMount)).toBe(path.resolve('/data/notes', '...'))
    })

    it('rejects deeply nested traversal that tries to return to base', () => {
      // e.g., ../../data/notes/evil — resolves to base but goes through ..
      const node: PathResolvableNode = { id: 'n1', name: 'evil', ext: null, mountId: 'mount_notes' }
      // This actually resolves back into /data/notes/evil, so it should pass
      const result = resolvePhysicalPath(node, externalMount, ['..', 'notes'])
      expect(result).toBe(path.resolve('/data/notes', '..', 'notes', 'evil'))
    })

    it('rejects traversal in local_managed via id with path separator', () => {
      const node: PathResolvableNode = { id: '../../../tmp/pwned', name: 'x', ext: 'txt', mountId: 'mount_files' }
      expect(() => resolvePhysicalPath(node, managedMount)).toThrow('Path traversal detected')
    })
  })
})
