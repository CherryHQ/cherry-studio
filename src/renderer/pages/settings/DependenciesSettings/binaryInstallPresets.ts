/**
 * Curated, opt-in presets for BinaryManager's install-only settings. Every URL
 * field also accepts free text; defaults remain empty and preserve current behavior.
 */
export interface InstallSettingPreset {
  url: string
  label: string
}

export const GITHUB_MIRROR_PRESETS: readonly InstallSettingPreset[] = [
  { url: 'https://ghfast.top', label: 'ghfast.top' },
  { url: 'https://ghproxy.net', label: 'ghproxy.net' }
]

export const NPM_REGISTRY_PRESETS: readonly InstallSettingPreset[] = [
  { url: 'https://registry.npmmirror.com', label: 'npmmirror (China)' },
  { url: 'https://registry.npmjs.org', label: 'npmjs (official)' }
]

export const PIP_INDEX_PRESETS: readonly InstallSettingPreset[] = [
  { url: 'https://pypi.tuna.tsinghua.edu.cn/simple', label: 'Tsinghua (China)' },
  { url: 'https://mirrors.aliyun.com/pypi/simple/', label: 'Aliyun (China)' },
  { url: 'https://pypi.org/simple', label: 'PyPI (official)' }
]
