import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import * as fileUtils from '@main/utils/file'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  AgentDevPreviewRequestPolicy,
  AgentHtmlArtifactRequestPolicy,
  isCanonicalPathInside,
  parseLocalArtifactFileUrl
} from '../agentWebviewRequest'

const request = (url: string, resourceType: string, webContentsId = 7) => ({
  resourceType,
  url,
  webContentsId
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('parseLocalArtifactFileUrl', () => {
  it('accepts a local pathToFileURL result', () => {
    const localUrl = pathToFileURL(path.resolve('artifact', 'index.html')).toString()

    expect(parseLocalArtifactFileUrl(localUrl)).toBe(path.normalize(fileURLToPath(localUrl)))
  })

  it.each([
    'file://attacker/share/index.html',
    'file:////attacker/share/index.html',
    'file://user:password@attacker/share/index.html'
  ])('rejects non-local file URL %s', (url) => {
    expect(parseLocalArtifactFileUrl(url)).toBeUndefined()
  })
})

describe('isCanonicalPathInside', () => {
  const volumeRoot = path.parse(process.cwd()).root
  const root = path.join(volumeRoot, 'workspace', 'artifact')

  it('accepts the exact root and native-separator descendants', () => {
    expect(isCanonicalPathInside(root, root)).toBe(true)
    expect(isCanonicalPathInside(path.join(root, 'assets', 'app.js'), root)).toBe(true)
    expect(isCanonicalPathInside(path.join(volumeRoot, 'workspace'), volumeRoot)).toBe(true)
  })

  it('rejects a sibling that differs only by case', () => {
    const candidate = path.join(path.dirname(root), 'Artifact', 'secret.js')

    expect(isCanonicalPathInside(candidate, root)).toBe(false)
  })

  it('rejects a sibling whose name starts with the root name', () => {
    const candidate = path.join(path.dirname(root), 'artifact-copy', 'secret.js')

    expect(isCanonicalPathInside(candidate, root)).toBe(false)
  })
})

describe('AgentDevPreviewRequestPolicy', () => {
  it('binds the first non-blank main frame to one canonical loopback origin', async () => {
    const policy = new AgentDevPreviewRequestPolicy()

    await expect(policy.isAllowed(request('about:blank', 'mainFrame'))).resolves.toBe(true)
    await expect(policy.isAllowed(request('http://0.0.0.0:5173/', 'mainFrame'))).resolves.toBe(true)
    await expect(policy.isAllowed(request('http://localhost:5173/dashboard', 'mainFrame'))).resolves.toBe(true)
    await expect(policy.isAllowed(request('http://127.0.0.1:5173/', 'mainFrame'))).resolves.toBe(false)
    await expect(policy.isAllowed(request('http://localhost:4173/', 'mainFrame'))).resolves.toBe(false)
    await expect(policy.isAllowed(request('https://example.com/', 'mainFrame'))).resolves.toBe(false)
  })

  it('limits loopback and websocket subresources to the bound origin', async () => {
    const policy = new AgentDevPreviewRequestPolicy()
    await policy.isAllowed(request('http://localhost:5173/', 'mainFrame'))

    await expect(policy.isAllowed(request('http://localhost:5173/app.js', 'script'))).resolves.toBe(true)
    await expect(policy.isAllowed(request('ws://localhost:5173/hmr', 'webSocket'))).resolves.toBe(true)
    await expect(policy.isAllowed(request('http://localhost:4173/app.js', 'script'))).resolves.toBe(false)
    await expect(policy.isAllowed(request('ws://127.0.0.1:5173/hmr', 'webSocket'))).resolves.toBe(false)
  })

  it('allows public HTTPS dependencies but rejects local, private, file, and insecure public resources', async () => {
    const policy = new AgentDevPreviewRequestPolicy()
    await policy.isAllowed(request('http://localhost:5173/', 'mainFrame'))

    await expect(policy.isAllowed(request('https://cdn.example.com/app.js', 'script'))).resolves.toBe(true)
    await expect(policy.isAllowed(request('wss://cdn.example.com/live', 'webSocket'))).resolves.toBe(true)
    await expect(policy.isAllowed(request('http://example.com/app.js', 'script'))).resolves.toBe(false)
    await expect(policy.isAllowed(request('https://10.0.0.1/app.js', 'script'))).resolves.toBe(false)
    await expect(policy.isAllowed(request('file:///etc/passwd', 'script'))).resolves.toBe(false)
  })

  it('does not authorize loopback subresources before a main frame binds the guest', async () => {
    const policy = new AgentDevPreviewRequestPolicy()

    await expect(policy.isAllowed(request('http://localhost:5173/app.js', 'script'))).resolves.toBe(false)
  })
})

describe('AgentHtmlArtifactRequestPolicy', () => {
  let tempRoot: string
  let artifactDirectory: string
  let artifactUrl: string
  let nestedAssetUrl: string
  let outsideFileUrl: string
  let symlinkEscapeUrl: string

  beforeAll(async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), 'cherry-agent-artifact-'))
    artifactDirectory = path.join(tempRoot, 'artifact')
    const nestedDirectory = path.join(artifactDirectory, 'assets')
    const outsideDirectory = path.join(tempRoot, 'outside')
    await mkdir(nestedDirectory, { recursive: true })
    await mkdir(outsideDirectory)
    const artifactPath = path.join(artifactDirectory, 'index.html')
    const nestedAssetPath = path.join(nestedDirectory, 'app.js')
    const outsideFilePath = path.join(outsideDirectory, 'secret.txt')
    await writeFile(artifactPath, '<script src="assets/app.js"></script>')
    await writeFile(nestedAssetPath, 'document.body.dataset.ready = "true"')
    await writeFile(outsideFilePath, 'secret')
    await symlink(outsideDirectory, path.join(artifactDirectory, 'escaped-assets'), 'junction')

    artifactUrl = pathToFileURL(artifactPath).toString()
    nestedAssetUrl = pathToFileURL(nestedAssetPath).toString()
    outsideFileUrl = pathToFileURL(outsideFilePath).toString()
    symlinkEscapeUrl = pathToFileURL(path.join(artifactDirectory, 'escaped-assets', 'secret.txt')).toString()
  })

  afterAll(async () => {
    await rm(tempRoot, { recursive: true, force: true })
  })

  it('binds file access to the canonical initial HTML directory', async () => {
    const policy = new AgentHtmlArtifactRequestPolicy()

    await expect(policy.isAllowed(request(artifactUrl, 'mainFrame'))).resolves.toBe(true)
    await expect(policy.isAllowed(request(nestedAssetUrl, 'script'))).resolves.toBe(true)
    await expect(policy.isAllowed(request(outsideFileUrl, 'script'))).resolves.toBe(false)
  })

  it('rejects lexical root escapes before filesystem access', async () => {
    const lstatSpy = vi.spyOn(fileUtils, 'lstat')
    const realpathSpy = vi.spyOn(fileUtils, 'realpath')
    const policy = new AgentHtmlArtifactRequestPolicy()
    await policy.isAllowed(request(artifactUrl, 'mainFrame'))
    expect(realpathSpy).toHaveBeenCalled()
    lstatSpy.mockClear()
    realpathSpy.mockClear()

    await expect(policy.isAllowed(request(outsideFileUrl, 'script'))).resolves.toBe(false)
    expect(lstatSpy).not.toHaveBeenCalled()
    expect(realpathSpy).not.toHaveBeenCalled()
  })

  it('blocks both parent traversal and symlink escapes from the artifact directory', async () => {
    const realpathSpy = vi.spyOn(fileUtils, 'realpath')
    const policy = new AgentHtmlArtifactRequestPolicy()
    await policy.isAllowed(request(artifactUrl, 'mainFrame'))
    realpathSpy.mockClear()

    const traversalUrl = new URL('../outside/secret.txt', `${pathToFileURL(artifactDirectory).toString()}/`).toString()
    await expect(policy.isAllowed(request(traversalUrl, 'script'))).resolves.toBe(false)
    await expect(policy.isAllowed(request(symlinkEscapeUrl, 'script'))).resolves.toBe(false)
    expect(realpathSpy).not.toHaveBeenCalled()
  })

  it('rejects an initial artifact root link before following it', async () => {
    const targetDirectory = path.join(tempRoot, 'initial-root-target')
    const linkedDirectory = path.join(tempRoot, 'initial-root-link')
    await mkdir(targetDirectory)
    await writeFile(path.join(targetDirectory, 'index.html'), '<h1>linked root</h1>')
    await symlink(targetDirectory, linkedDirectory, 'junction')
    const realpathSpy = vi.spyOn(fileUtils, 'realpath')
    const policy = new AgentHtmlArtifactRequestPolicy()

    await expect(
      policy.isAllowed(request(pathToFileURL(path.join(linkedDirectory, 'index.html')).toString(), 'mainFrame'))
    ).resolves.toBe(false)
    expect(realpathSpy).not.toHaveBeenCalled()
  })

  it('rejects an initial HTML link before following it', async () => {
    const artifactRoot = path.join(tempRoot, 'initial-file-link')
    const targetPath = path.join(tempRoot, 'initial-file-target.html')
    await mkdir(artifactRoot)
    await writeFile(targetPath, '<h1>linked file</h1>')
    await symlink(targetPath, path.join(artifactRoot, 'index.html'))
    const realpathSpy = vi.spyOn(fileUtils, 'realpath')
    const policy = new AgentHtmlArtifactRequestPolicy()

    await expect(
      policy.isAllowed(request(pathToFileURL(path.join(artifactRoot, 'index.html')).toString(), 'mainFrame'))
    ).resolves.toBe(false)
    expect(realpathSpy).not.toHaveBeenCalled()
  })

  it('rejects remote file authorities without filesystem access', async () => {
    const lstatSpy = vi.spyOn(fileUtils, 'lstat')
    const realpathSpy = vi.spyOn(fileUtils, 'realpath')
    const unboundPolicy = new AgentHtmlArtifactRequestPolicy()

    await expect(unboundPolicy.isAllowed(request('file://attacker/share/index.html', 'mainFrame'))).resolves.toBe(false)
    await expect(unboundPolicy.isAllowed(request('file:////attacker/share/index.html', 'mainFrame'))).resolves.toBe(
      false
    )
    expect(lstatSpy).not.toHaveBeenCalled()
    expect(realpathSpy).not.toHaveBeenCalled()

    const boundPolicy = new AgentHtmlArtifactRequestPolicy()
    await expect(boundPolicy.isAllowed(request(artifactUrl, 'mainFrame'))).resolves.toBe(true)
    lstatSpy.mockClear()
    realpathSpy.mockClear()
    await expect(boundPolicy.isAllowed(request('file://attacker/share/app.js', 'script'))).resolves.toBe(false)
    expect(lstatSpy).not.toHaveBeenCalled()
    expect(realpathSpy).not.toHaveBeenCalled()
  })

  it('allows inline resources but blocks all remote network access', async () => {
    const policy = new AgentHtmlArtifactRequestPolicy()
    await policy.isAllowed(request(artifactUrl, 'mainFrame'))

    await expect(policy.isAllowed(request('data:text/javascript,void%200', 'script'))).resolves.toBe(true)
    await expect(policy.isAllowed(request('blob:null/12345678-1234-1234-1234-123456789abc', 'script'))).resolves.toBe(
      true
    )
    await expect(policy.isAllowed(request('https://cdn.example.com/app.js', 'script'))).resolves.toBe(false)
    await expect(policy.isAllowed(request('http://cdn.example.com/legacy.js', 'script'))).resolves.toBe(false)
    await expect(policy.isAllowed(request('wss://cdn.example.com/live', 'webSocket'))).resolves.toBe(false)
    await expect(policy.isAllowed(request('ws://cdn.example.com/live', 'webSocket'))).resolves.toBe(false)
    await expect(policy.isAllowed(request('http://127.0.0.1:5173/private', 'script'))).resolves.toBe(false)
  })

  it('requires each guest to establish its own initial file root', async () => {
    const policy = new AgentHtmlArtifactRequestPolicy()

    await expect(policy.isAllowed(request(nestedAssetUrl, 'script', 8))).resolves.toBe(false)
    await expect(policy.isAllowed(request('https://example.com/', 'mainFrame', 8))).resolves.toBe(false)
    await expect(policy.isAllowed(request(outsideFileUrl, 'mainFrame', 8))).resolves.toBe(false)
  })
})
