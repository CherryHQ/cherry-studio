# Handoff

## Goal

Migrate legacy `agents.db` data into the new central `cherrystudio.sqlite` database. Specifically, two skills tables need correct migration targets:

- `skills` (old global catalog) → **`agents_global_skills`** (new table, rename of current `agents_skills`)
- `agent_skills` (old per-agent junction) → **`agents_agent_skills`** (new junction table, needs to be created)

## Progress

**This session completed:**
- Removed the `agents_agent_skills` Drizzle schema and regenerated migration SQL (file `0011_public_lady_deathstrike.sql`)
- Deleted `AgentSkillRepository.ts` and `migrateSkillsPerAgent.ts`
- Refactored `SkillService` to use global-only `isEnabled` on `agents_skills`
- Fixed `AgentService.deleteAgent()` to not reference the removed junction table
- All 155 test files pass, lint clean, pushed to remote

**The issue identified (not yet fixed):**
V clarified that both skills tables from the old DB need to survive as separate tables in the new DB:
- The global skill catalog (`skills` old) should live in `agents_global_skills`
- The per-agent junction table (`agent_skills` old) should live in `agents_agent_skills`

The current `agents_skills` table name is wrong — it should be `agents_global_skills`. The per-agent junction table was incorrectly removed.

## Key Decisions

- **Two separate tables** — `agents_global_skills` (catalog) and `agents_agent_skills` (junction). The previous session's decision to collapse everything into one global table with `isEnabled` is reversed.
- **Current `agents_skills` → rename to `agents_global_skills`** — schema file is `src/main/data/db/schemas/agentsSkills.ts`; rename both the TS export and the SQLite table name.
- **Restore `agents_agent_skills`** — composite PK on `(agent_id, skill_id)`, FK to `agents_agents` and `agents_global_skills`, columns: `agent_id`, `skill_id`, `is_enabled`, `created_at`, `updated_at`.

## Old DB Schema (source of truth)

```sql
-- Global skill catalog
CREATE TABLE `skills` (
  `id` text PRIMARY KEY,
  `name` text NOT NULL,
  `description` text,
  `folder_name` text NOT NULL,
  `source` text NOT NULL,
  `source_url` text,
  `namespace` text,
  `author` text,
  `tags` text,
  `content_hash` text NOT NULL,
  `is_enabled` integer DEFAULT true NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);

-- Per-agent enablement junction
CREATE TABLE `agent_skills` (
  `agent_id` text NOT NULL,
  `skill_id` text NOT NULL,
  `is_enabled` integer DEFAULT false NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  PRIMARY KEY(`agent_id`, `skill_id`),
  FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON DELETE cascade,
  FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON DELETE cascade
);
```

## Files to Change

### 1. Rename global skills schema
- `src/main/data/db/schemas/agentsSkills.ts`
  - Change table name from `'agents_skills'` → `'agents_global_skills'`
  - Rename export: `agentsSkillsTable` → `agentsGlobalSkillsTable`, types accordingly

### 2. Create junction table schema
- **New file**: `src/main/data/db/schemas/agentsAgentSkills.ts`
  - Table name: `'agents_agent_skills'`
  - Columns: `agentId` (text, not null), `skillId` (text, not null), `isEnabled` (boolean, default false), `createdAt`, `updatedAt`
  - Composite PK on `(agentId, skillId)`
  - FK: `agentId` → `agents_agents.id` ON DELETE CASCADE
  - FK: `skillId` → `agents_global_skills.id` ON DELETE CASCADE

### 3. Regenerate migration
```bash
pnpm agents:generate
```
This will produce a new migration file renaming `agents_skills` → `agents_global_skills` and creating `agents_agent_skills`.

### 4. Update migration mappings
- `src/main/data/migration/v2/migrators/mappings/AgentsDbMappings.ts`
  - Change `agents_skills` target → `agents_global_skills` in source types, target types, migration specs
  - **Add** `agent_skills` → `agents_agent_skills` migration spec with column mapping:
    - `agent_id` → `agentId`, `skill_id` → `skillId`, `is_enabled` → `isEnabled`, `created_at` → `createdAt`, `updated_at` → `updatedAt`
  - Add `agents_agent_skills` to delete order (before `agents_global_skills`)

### 5. Update AgentsMigrator
- `src/main/data/migration/v2/migrators/AgentsMigrator.ts`
  - Add `agent_skills` to the tables that are checked for empty counts

### 6. Update compat re-exports in agents service schema
- `src/main/services/agents/database/schema/skills.schema.ts`
  - Update re-export alias: `agentsSkillsTable as skillsTable` → import from `agentsGlobalSkills`
- **Restore** `src/main/services/agents/database/schema/agentSkills.schema.ts`
  - Re-export `agentsAgentSkillsTable as agentSkillsTable` and types from the new schema file
- `src/main/services/agents/database/schema/index.ts`
  - Add `export * from './agentSkills.schema'` back

### 7. Restore AgentSkillRepository
- **Restore** `src/main/services/agents/skills/AgentSkillRepository.ts`
  - Same logic as before: queries against `agentSkillsTable` with `agentId`/`skillId`/`isEnabled` columns
  - These columns now correctly exist on `agents_agent_skills`

### 8. Restore SkillService per-agent logic
- `src/main/services/agents/skills/SkillService.ts`
  - Restore `agentSkillRepository` field and constructor init
  - `list(agentId?)` — with `agentId` return per-agent `isEnabled` from junction; without return global
  - `toggle()` — upsert into `agents_agent_skills` and manage symlink for that agent only
  - `initSkillsForAgent()` — upsert builtin skills into junction and link to workspace
  - `enableForAllAgents()` — fan out junction upserts across all agents + symlinks
  - `reconcileAgentSkills()` — reconcile from junction table rows for that agent
  - `uninstall()` — query junction by skillId to find agents that had it enabled, remove symlinks

### 9. Fix AgentService.deleteAgent()
- `src/main/services/agents/services/AgentService.ts`
  - Restore `tx.delete(agentSkillsTable).where(eq(agentSkillsTable.agentId, id))` in the builtin-agent soft-delete transaction
  - Restore `agentSkillsTable` import

### 10. Update tests
- `src/main/services/agents/services/__tests__/AgentService.test.ts`
  - Revert `txDelete` expected count back to 3
- `src/main/data/migration/v2/migrators/__tests__/AgentsMigrator.test.ts`
  - Add `agent_skills` expectations
- `src/main/data/migration/v2/migrators/mappings/__tests__/AgentsDbMappings.test.ts`
  - Add `agent_skills` → `agents_agent_skills` test case

## Current State

- Branch: `feat/agents-main-db-migration`
- All tests pass, lint clean, pushed to remote
- Current `agents_skills` table holds the global skill catalog — needs renaming to `agents_global_skills`
- No `agents_agent_skills` table exists yet — needs creating + migrating `agent_skills` data into it
- `SkillService` is currently in global-only mode (per-agent logic stripped) — needs restoring
- `AgentSkillRepository` is deleted — needs restoring

## Blockers / Gotchas

- Renaming `agents_skills` → `agents_global_skills` means all existing production data in that table must be preserved via an `ALTER TABLE RENAME` in the new migration — Drizzle should generate this automatically.
- The junction table FKs reference `agents_global_skills.id` (after rename), not `agents_skills.id` — make sure schema file is updated before running `pnpm agents:generate`.
- `SkillRepository` and all its callers use the `skillsTable` alias from the compat re-export — updating the compat re-export to point to `agentsGlobalSkillsTable` is the minimal-blast-radius fix.
- Run `pnpm agents:generate` only after both schema files are correct, then verify the generated SQL before committing.

## Next Steps

1. Update `src/main/data/db/schemas/agentsSkills.ts` — rename table to `agents_global_skills`, rename TS exports
2. Create `src/main/data/db/schemas/agentsAgentSkills.ts` — junction table schema
3. Run `pnpm agents:generate` and verify the migration SQL
4. Update `AgentsDbMappings.ts` — add `agent_skills` migration, fix `agents_skills` → `agents_global_skills`
5. Update `AgentsMigrator.ts` — add `agent_skills` to checked tables
6. Restore `AgentSkillRepository.ts`, compat re-exports, `schema/index.ts`
7. Restore `SkillService.ts` per-agent logic
8. Restore `AgentService.deleteAgent()` junction table delete + revert test count
9. Run `pnpm test && pnpm lint` to verify everything
