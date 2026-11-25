import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { installReleaseArtifact } from '../installation'
import {
  assertArtifactIdentity,
  inspectArtifactIdentity,
  installationEvidencePath,
  InstallationEvidenceError,
  writeSourceCheckoutInstallation
} from '../installationEvidence'
import { ensureRunDirectories, getRunPaths } from '../paths'

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }))

const SHA256 = 'a'.repeat(64)
const COMMIT = '514d3cb0ef7'

function createRunDirectory(prefix: string) {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  const paths = getRunPaths(directory)
  ensureRunDirectories(paths)
  return { directory, paths }
}

it('records a branch run as evidence/<platform>/release/installation.json', () => {
  const { directory, paths } = createRunDirectory('cherry-identity-branch-')
  try {
    writeSourceCheckoutInstallation(
      paths,
      { platform: 'macos', appVersion: 'development-514d3cb', ref: 'main', commitSha: COMMIT },
      { targetRoot: '/workspace/target-app', command: '/usr/local/bin/node' }
    )
    const record = JSON.parse(readFileSync(paths.installation, 'utf8'))
    expect(record).toMatchObject({
      source: 'source-checkout',
      mode: 'branch',
      platform: 'macos',
      commitSha: COMMIT,
      targetRoot: '/workspace/target-app'
    })
    expect(inspectArtifactIdentity(paths.installation, 'macos')).toEqual([])
    expect(installationEvidencePath('macos')).toBe('evidence/macos/release/installation.json')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

// The regression this guards: a run that never writes the record still uploaded a green artifact,
// leaving artifact_identity empty in the ledger.
it('fails when the record was never written', () => {
  const { directory, paths } = createRunDirectory('cherry-identity-missing-')
  try {
    expect(existsSync(paths.installation)).toBe(false)
    expect(inspectArtifactIdentity(paths.installation, 'windows')).toEqual(['the artifact identity record is missing'])
    expect(() => assertArtifactIdentity(paths.installation, 'windows')).toThrow(InstallationEvidenceError)
    expect(() => assertArtifactIdentity(paths.installation, 'windows')).toThrow(
      'Artifact identity evidence is incomplete for windows: evidence/windows/release/installation.json'
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

it('fails when the record is unreadable or truncated', () => {
  const { directory, paths } = createRunDirectory('cherry-identity-truncated-')
  try {
    writeFileSync(paths.installation, '{"source": "release-installer"')
    expect(inspectArtifactIdentity(paths.installation, 'windows')[0]).toContain('not valid JSON')

    writeFileSync(
      paths.installation,
      JSON.stringify({
        schemaVersion: 1,
        source: 'release-installer',
        mode: 'tag',
        platform: 'windows',
        recordedAt: new Date().toISOString(),
        artifactName: 'Cherry-Studio-setup.exe',
        artifactPath: '/tmp/Cherry-Studio-setup.exe',
        artifactSha256: '',
        executablePath: 'C:\\Cherry Studio.exe',
        installedPath: 'C:\\installed'
      })
    )
    expect(inspectArtifactIdentity(paths.installation, 'windows')).toEqual(['artifactSha256 is not a SHA-256 digest'])
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

it('fails when the record identifies another platform', () => {
  const { directory, paths } = createRunDirectory('cherry-identity-platform-')
  try {
    writeSourceCheckoutInstallation(
      paths,
      { platform: 'macos', appVersion: 'development-514d3cb', ref: 'main', commitSha: COMMIT },
      { targetRoot: '/workspace/target-app', command: '/usr/local/bin/node' }
    )
    expect(inspectArtifactIdentity(paths.installation, 'windows')).toContain('platform is macos, expected windows')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

it('accepts the record written by the release installer', () => {
  const { directory, paths } = createRunDirectory('cherry-identity-installer-')
  const executable = join(paths.installed, 'Cherry Studio.exe')
  writeFileSync(executable, '')
  vi.mocked(execFileSync).mockImplementation(() => Buffer.alloc(0))
  try {
    installReleaseArtifact(paths, 'windows', join(paths.artifacts, 'Cherry-Studio-setup.exe'), SHA256)
    expect(inspectArtifactIdentity(paths.installation, 'windows')).toEqual([])
    expect(() => assertArtifactIdentity(paths.installation, 'windows')).not.toThrow()
  } finally {
    vi.resetAllMocks()
    rmSync(directory, { recursive: true, force: true })
  }
})
