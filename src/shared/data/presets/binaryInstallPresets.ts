/**
 * Curated, opt-in presets for the binary install settings UI. Convenience picks
 * only — every field also accepts free-text, and the default is empty (no
 * override, i.e. today's behavior).
 *
 * GitHub mirror entries are in **proxy-prefix** form: BinaryManager appends
 * `/https://github.com` at env-build time, matching the ghproxy-family usage
 * `https://<mirror>/https://github.com/owner/repo/...` (asset downloads only —
 * api.github.com is left direct since these mirrors 403 the GitHub API).
 * Mirror availability rots — treat this list as cheaply updatable, not a
 * guarantee, and verify a candidate proxies both release downloads before
 * adding it. Cherry never routes downloads through a mirror unless the user
 * explicitly picks or types one.
 */
export interface InstallSettingPreset {
  /** Value written into the preference (a URL). */
  url: string
  /** Short human label for the dropdown. */
  label: string
}

export const GITHUB_MIRROR_PRESETS: InstallSettingPreset[] = [
  { url: 'https://ghfast.top', label: 'ghfast.top' },
  { url: 'https://ghproxy.net', label: 'ghproxy.net' }
]

export const NPM_REGISTRY_PRESETS: InstallSettingPreset[] = [
  { url: 'https://registry.npmmirror.com', label: 'npmmirror (China)' },
  { url: 'https://registry.npmjs.org', label: 'npmjs (official)' }
]

export const PIP_INDEX_PRESETS: InstallSettingPreset[] = [
  { url: 'https://pypi.tuna.tsinghua.edu.cn/simple', label: 'Tsinghua (China)' },
  { url: 'https://mirrors.aliyun.com/pypi/simple/', label: 'Aliyun (China)' },
  { url: 'https://pypi.org/simple', label: 'PyPI (official)' }
]
