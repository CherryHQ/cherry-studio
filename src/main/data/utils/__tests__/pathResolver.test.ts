import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// Unmock node:fs, node:path, node:os — this test needs real filesystem access
vi.unmock('node:fs')
vi.unmock('node:path')
vi.unmock('node:os')

// Type-only imports (erased at runtime, unaffected by mocks)
import type { MountInfo, PathResolvableNode } from '../pathResolver'

// Dynamic imports after unmock to get real modules
const fs = await import('node:fs')
const os = await import('node:os')
const path = await import('node:path')
const { getExtSuffix, resolvePhysicalPath } = await import('../pathResolver')

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
  // ─── Temp directory for local_external tests (realpathSync requires real paths) ───
  let tmpBase: string
  let externalMount: MountInfo

  beforeAll(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'pathResolver-test-'))
    fs.mkdirSync(path.join(tmpBase, 'project', 'docs'), { recursive: true })
    fs.writeFileSync(path.join(tmpBase, 'readme.md'), '')
    fs.writeFileSync(path.join(tmpBase, 'project', 'docs', 'readme.md'), '')
    fs.writeFileSync(path.join(tmpBase, 'subfolder'), '')
    fs.writeFileSync(path.join(tmpBase, 'notes.md'), '')
    fs.writeFileSync(path.join(tmpBase, '...'), '')

    externalMount = {
      providerConfig: { providerType: 'local_external', basePath: tmpBase, watch: true }
    }
  })

  afterAll(() => {
    fs.rmSync(tmpBase, { recursive: true, force: true })
  })

  describe('local_managed', () => {
    const mount: MountInfo = {
      providerConfig: { providerType: 'local_managed', basePath: '/data/files' }
    }

    it('returns {basePath}/{id}.{ext}', () => {
      const node: PathResolvableNode = { id: 'abc-123', name: 'document', ext: 'pdf', mountId: 'mount_files' }
      expect(resolvePhysicalPath(node, mount)).toBe(path.resolve('/data/files', 'abc-123.pdf'))
    })

    it('returns {basePath}/{id} with null ext', () => {
      const node: PathResolvableNode = { id: 'abc-123', name: 'folder', ext: null, mountId: 'mount_files' }
      expect(resolvePhysicalPath(node, mount)).toBe(path.resolve('/data/files', 'abc-123'))
    })
  })

  describe('local_external', () => {
    it('returns {basePath}/{ancestors}/{name}.{ext}', () => {
      const node: PathResolvableNode = { id: 'n1', name: 'readme', ext: 'md', mountId: 'mount_notes' }
      expect(resolvePhysicalPath(node, externalMount, ['project', 'docs'])).toBe(
        fs.realpathSync(path.join(tmpBase, 'project', 'docs', 'readme.md'))
      )
    })

    it('returns {basePath}/{name}.{ext} with empty ancestors', () => {
      const node: PathResolvableNode = { id: 'n2', name: 'notes', ext: 'md', mountId: 'mount_notes' }
      expect(resolvePhysicalPath(node, externalMount, [])).toBe(fs.realpathSync(path.join(tmpBase, 'notes.md')))
    })

    it('returns path without ext when ext is null', () => {
      const node: PathResolvableNode = { id: 'n3', name: 'subfolder', ext: null, mountId: 'mount_notes' }
      expect(resolvePhysicalPath(node, externalMount, [])).toBe(fs.realpathSync(path.join(tmpBase, 'subfolder')))
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
    const managedMount: MountInfo = {
      providerConfig: { providerType: 'local_managed', basePath: '/data/files' }
    }

    // ─── Null byte rejection (checked before realpathSync) ───

    it('rejects null bytes in node.id', () => {
      const node: PathResolvableNode = { id: 'abc\0evil', name: 'file', ext: 'txt', mountId: 'mount_files' }
      expect(() => resolvePhysicalPath(node, managedMount)).toThrow('null bytes')
    })

    it('rejects null bytes in node.name', () => {
      const node: PathResolvableNode = { id: 'n1', name: 'file\0.evil', ext: 'txt', mountId: 'mount_notes' }
      expect(() => resolvePhysicalPath(node, externalMount, [])).toThrow('null bytes')
    })

    it('rejects null bytes in node.ext', () => {
      const node: PathResolvableNode = { id: 'n1', name: 'file', ext: 'txt\0evil', mountId: 'mount_notes' }
      expect(() => resolvePhysicalPath(node, externalMount, [])).toThrow('null bytes')
    })

    it('rejects null bytes in ancestorNames', () => {
      const node: PathResolvableNode = { id: 'n1', name: 'file', ext: 'txt', mountId: 'mount_notes' }
      expect(() => resolvePhysicalPath(node, externalMount, ['dir\0evil'])).toThrow('null bytes')
    })

    // ─── ancestorNames required for local_external ───

    it('throws when ancestorNames omitted for local_external', () => {
      const node: PathResolvableNode = { id: 'n1', name: 'file', ext: 'txt', mountId: 'mount_notes' }
      expect(() => resolvePhysicalPath(node, externalMount)).toThrow('ancestorNames is required')
    })

    // ─── local_managed containment ───

    it('containment check applies to local_managed', () => {
      const node: PathResolvableNode = { id: '../../etc/passwd', name: 'evil', ext: null, mountId: 'mount_files' }
      expect(() => resolvePhysicalPath(node, managedMount)).toThrow('Path traversal detected')
    })

    it('rejects traversal in local_managed via id with path separator', () => {
      const node: PathResolvableNode = { id: '../../../tmp/pwned', name: 'x', ext: 'txt', mountId: 'mount_files' }
      expect(() => resolvePhysicalPath(node, managedMount)).toThrow('Path traversal detected')
    })

    // ─── local_external path traversal (uses real temp dir) ───

    it('rejects path traversal via node.name containing ../', () => {
      const node: PathResolvableNode = { id: 'n1', name: '../../etc/passwd', ext: null, mountId: 'mount_notes' }
      expect(() => resolvePhysicalPath(node, externalMount, [])).toThrow()
    })

    it('rejects path traversal via ancestorNames containing ..', () => {
      const node: PathResolvableNode = { id: 'n1', name: 'file', ext: 'txt', mountId: 'mount_notes' }
      expect(() => resolvePhysicalPath(node, externalMount, ['..', '..', 'etc'])).toThrow()
    })

    it('rejects path traversal via node.name that is just ..', () => {
      const node: PathResolvableNode = { id: 'n1', name: '..', ext: null, mountId: 'mount_notes' }
      expect(() => resolvePhysicalPath(node, externalMount, [])).toThrow()
    })

    it('allows triple-dot filename (valid, not a traversal)', () => {
      const node: PathResolvableNode = { id: 'n1', name: '...', ext: null, mountId: 'mount_notes' }
      const result = resolvePhysicalPath(node, externalMount, [])
      expect(result).toBe(fs.realpathSync(path.join(tmpBase, '...')))
    })

    // ─── Symlink protection (local_external only) ───

    it('rejects symlink that escapes basePath', () => {
      const symlinkPath = path.join(tmpBase, 'evil-link')
      fs.symlinkSync(os.tmpdir(), symlinkPath)
      try {
        const node: PathResolvableNode = { id: 'n1', name: 'evil-link', ext: null, mountId: 'mount_notes' }
        expect(() => resolvePhysicalPath(node, externalMount, [])).toThrow('Path traversal detected')
      } finally {
        fs.unlinkSync(symlinkPath)
      }
    })

    it('allows symlink that stays within basePath', () => {
      const targetDir = path.join(tmpBase, 'project')
      const symlinkPath = path.join(tmpBase, 'link-to-project')
      fs.symlinkSync(targetDir, symlinkPath)
      try {
        const node: PathResolvableNode = { id: 'n1', name: 'readme', ext: 'md', mountId: 'mount_notes' }
        const result = resolvePhysicalPath(node, externalMount, ['link-to-project', 'docs'])
        expect(result).toBe(fs.realpathSync(path.join(tmpBase, 'project', 'docs', 'readme.md')))
      } finally {
        fs.unlinkSync(symlinkPath)
      }
    })
  })
})
