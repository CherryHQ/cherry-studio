import type { CodexAppServerClient } from './appServerClient'

type Skill = { name: string; path: string; description: string }

export class CodexSkills {
  private catalog?: { read: Promise<ReadonlyMap<string, Skill>>; refreshing: boolean }
  constructor(
    private readonly client: CodexAppServerClient,
    private readonly cwd: string
  ) {}

  invalidate() {
    this.catalog = undefined
  }

  list(forceReload = false): Promise<ReadonlyMap<string, Skill>> {
    if (this.catalog && (!forceReload || this.catalog.refreshing)) return this.catalog.read
    const read: Promise<ReadonlyMap<string, Skill>> = this.client
      .request('skills/list', { cwds: [this.cwd], ...(forceReload && { forceReload }) })
      .then(
        ({ data }) => {
          if (this.catalog?.read !== read) return this.list()
          this.catalog.refreshing = false
          const skills = new Map<string, Skill>()
          for (const entry of data) {
            for (const skill of entry.skills) {
              if (skill.enabled !== false)
                skills.set(skill.name, {
                  name: skill.name,
                  path: skill.path,
                  description: skill.shortDescription?.trim() || skill.description?.trim() || ''
                })
            }
          }
          return skills
        },
        () => {
          if (this.catalog?.read !== read) return this.list()
          this.catalog = undefined
          return new Map<string, Skill>()
        }
      )
    this.catalog = { read, refreshing: forceReload }
    return read
  }
}
