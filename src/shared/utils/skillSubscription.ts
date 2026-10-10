import type { MarketplaceSkill } from '@shared/types/skillMarketplace'

import { parseGithubSkillUrl } from './skillMarketplace'

export function normalizeSubscriptionUrl(value: string): string | null {
  try {
    const url = new URL(value.trim())
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null
    url.hash = ''
    if (url.hostname === 'github.com' || url.hostname === 'www.github.com') {
      url.protocol = 'https:'
      url.hostname = 'github.com'
      url.search = ''
      url.pathname = url.pathname.replace(/\/$/, '').replace(/\.git$/, '')
    }
    return url.href
  } catch {
    return null
  }
}

export function skillInstallIdentity(url: string): string {
  const github = parseGithubSkillUrl(url)
  if (github) {
    const { owner, repo, refNamespace, refAndPath } = github
    return ['github', owner.toLowerCase(), repo.toLowerCase(), refNamespace ?? 'heads', ...refAndPath].join('/')
  }
  return url
}

export function subscriptionMemberSource(skill: MarketplaceSkill, memberPath: string): string {
  const source = skill.subscription!
  return source.kind === 'github' ? source.url : source.url + '#' + encodeURIComponent(memberPath)
}
