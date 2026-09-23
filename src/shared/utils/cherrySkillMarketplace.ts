import type { CherrySkill, MarketplaceSkill, MarketplaceSkillMember } from '@shared/types/skillMarketplace'

export const CHERRY_SKILL_MARKETPLACE_URL = 'https://skills.cherryin.ai'

export function marketplaceSkillNamespace(id: string): string {
  return `cherryin:${id}`
}

export function marketplaceSkillSource(id: string, memberPath: string): string {
  return `${CHERRY_SKILL_MARKETPLACE_URL}/?detail=${encodeURIComponent(id)}${memberPath ? `#${encodeURIComponent(memberPath)}` : ''}`
}

export function localizeMarketplaceText(value: { en: string; zh: string | null }, language: string): string {
  return (language.toLowerCase().startsWith('zh') ? value.zh || value.en : value.en || value.zh) || ''
}

export function summarizeMarketplaceSkill(skill: CherrySkill, members?: MarketplaceSkillMember[]): MarketplaceSkill {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    domain: skill.domain,
    author: skill.author,
    version: skill.version,
    tags: skill.tags,
    githubRepoUrl: skill.githubRepoUrl,
    sourceUrl: skill.sourceUrl,
    icon: skill.icon,
    packageSize: skill.packageSize,
    packageName: skill.packageName,
    downloadUrl: skill.downloadUrl,
    hasPackage: skill.hasPackage,
    downloads: skill.downloads,
    releaseDate: skill.releaseDate,
    isCollection: members ? members.some((member) => member.path !== '') : skill.tags.includes('collection'),
    membersKnown: members !== undefined,
    members: members ?? []
  }
}
