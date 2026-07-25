/**
 * Curated, opt-in presets for BinaryManager's install-only settings. Every URL
 * field also accepts free text; defaults remain empty and preserve current behavior.
 */
export interface InstallSettingPreset {
  url: string
  labelKey: string
}

// Every list opens with an explicit way back to the default (empty value = no
// override, mise talks to the official source) — without it, picking any
// preset was a one-way door unless you knew clearing the field meant "default".
const DEFAULT_PRESET: InstallSettingPreset = {
  url: '',
  labelKey: 'settings.dependencies.installSettings.presetLabels.default'
}

export const GITHUB_MIRROR_PRESETS: readonly InstallSettingPreset[] = [
  DEFAULT_PRESET,
  { url: 'https://ghfast.top', labelKey: 'settings.dependencies.installSettings.presetLabels.ghfast' },
  { url: 'https://ghproxy.net', labelKey: 'settings.dependencies.installSettings.presetLabels.ghproxy' }
]

export const NPM_REGISTRY_PRESETS: readonly InstallSettingPreset[] = [
  DEFAULT_PRESET,
  { url: 'https://registry.npmmirror.com', labelKey: 'settings.dependencies.installSettings.presetLabels.npmmirror' },
  { url: 'https://registry.npmjs.org', labelKey: 'settings.dependencies.installSettings.presetLabels.npmOfficial' }
]

export const PIP_INDEX_PRESETS: readonly InstallSettingPreset[] = [
  DEFAULT_PRESET,
  {
    url: 'https://pypi.tuna.tsinghua.edu.cn/simple',
    labelKey: 'settings.dependencies.installSettings.presetLabels.tsinghua'
  },
  {
    url: 'https://mirrors.aliyun.com/pypi/simple/',
    labelKey: 'settings.dependencies.installSettings.presetLabels.aliyun'
  },
  { url: 'https://pypi.org/simple', labelKey: 'settings.dependencies.installSettings.presetLabels.pypiOfficial' }
]
