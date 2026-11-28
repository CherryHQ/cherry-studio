import type { CodexAppServerClient } from './appServerClient'

type Skill = { name: string; path: string; description: string }

export class CodexSkills {
  private catalog?: Promise<ReadonlyMap<string, Skill>>
  constructor(
    private readonly client: CodexAppServerClient,
    private readonly cwd: string
  ) {}

  invalidate() {
    this.catalog = undefined
  }

  list(): Promise<ReadonlyMap<string, Skill>> {
    if (!this.catalog) {
      const read: Promise<ReadonlyMap<string, Skill>> = this.client.request('skills/list', { cwds: [this.cwd] }).then(
        ({ data }) => {
          if (this.catalog !== read) return this.list()
          const skills = new Map<string, Skill>()
          for (const entry of data) {
            for (const skill of entry.skills) {
              if (skill.enabled !== false)
                skills.set(skill.name, {
                  name: skill.name,
                  path: skill.path,
                  description: (skill.shortDescription || skill.description || '').trim()
                })
            }
          }
          return skills
        },
        () => {
          if (this.catalog !== read) return this.list()
          this.catalog = undefined
          return new Map<string, Skill>()
        }
      )
      this.catalog = read
    }
    return this.catalog
  }
}
