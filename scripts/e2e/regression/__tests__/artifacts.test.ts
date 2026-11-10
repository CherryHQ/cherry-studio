import { selectReleaseAsset } from '../artifacts'

const assets = [
  'Cherry-Studio-2.0.8-arm64-portable.exe',
  'Cherry-Studio-2.0.8-arm64-setup.exe',
  'Cherry-Studio-2.0.8-x64-portable.exe',
  'Cherry-Studio-2.0.8-x64-setup.exe',
  'Cherry-Studio-2.0.8-arm64.dmg',
  'Cherry-Studio-2.0.8-x64.dmg'
]

describe('release asset selection', () => {
  it('selects an installer for the exact runner platform and architecture', () => {
    expect(selectReleaseAsset(assets, 'windows', 'x64')).toBe('Cherry-Studio-2.0.8-x64-setup.exe')
    expect(selectReleaseAsset(assets, 'windows', 'arm64')).toBe('Cherry-Studio-2.0.8-arm64-setup.exe')
    expect(selectReleaseAsset(assets, 'macos', 'x64')).toBe('Cherry-Studio-2.0.8-x64.dmg')
    expect(selectReleaseAsset(assets, 'macos', 'arm64')).toBe('Cherry-Studio-2.0.8-arm64.dmg')
  })

  it('never treats a Windows portable executable as the installed release', () => {
    expect(() => selectReleaseAsset(['Cherry-Studio-2.0.8-x64-portable.exe'], 'windows', 'x64')).toThrow(
      'No windows x64 installer asset found'
    )
  })

  it('rejects ambiguous matching assets', () => {
    expect(() => selectReleaseAsset([...assets, 'Cherry-Studio-2.0.8-hotfix-x64.dmg'], 'macos', 'x64')).toThrow(
      'Multiple macos x64 installer assets found'
    )
  })
})
