# Agent Plugins Management - Skills Support Extension

**Date**: 2025-10-22
**Status**: In Progress
**Reviewed by**: Manual Review
**Extends**: 2025-10-22-agent-plugins-management.md

---

## Overview

### Feature Summary
Extend the existing agent plugins management system (agents and commands) to support **skills** as a third plugin type. Skills are folder-based plugins containing `SKILL.md` plus additional files, installed to `.claude/skills/` in the agent's workdir.

### Key Differences from Agents/Commands

| Aspect | Agents/Commands | Skills |
|--------|----------------|--------|
| Structure | Single `.md` file | Folder with `SKILL.md` + other files |
| Source Location | `agents/` or `commands/` subdirectories | `skills/` flat directory |
| Identifier | Filename with `.md` extension | Folder name (no extension) |
| Installation | Copy single file | Copy entire folder recursively |
| Metadata Source | Frontmatter in `.md` file | Frontmatter in `SKILL.md` |
| Overwrite Behavior | Replace file | Replace entire folder |

### Success Criteria
- Users can browse, install, and uninstall skills via the Plugins tab
- Skill folders are correctly copied to `.claude/skills/`
- Folder name consistency maintained (no extensions for skills)
- Existing agents/commands functionality remains unchanged
- Metadata properly stored and retrieved for all three plugin types

---

## Data Model Clarification

### Plugin Identification Consistency

**IMPORTANT**: The `filename` field has different semantics based on plugin type:

```typescript
export interface PluginMetadata {
  // Identification
  sourcePath: string        // Path relative to plugins base directory
  filename: string          // IMPORTANT: Semantics vary by type:
                            //   - For agents/commands: includes .md extension (e.g., "my-agent.md")
                            //   - For skills: folder name only, no extension (e.g., "my-skill")
  name: string              // Display name from frontmatter or derived from filename

  // ... rest of fields unchanged
  type: 'agent' | 'command' | 'skill'  // UPDATED: now includes 'skill'
}
```

**Rationale**:
- Files need extensions to identify file type (`.md`)
- Folders should not have extensions (semantic confusion, filesystem convention)
- This keeps the identifier format natural for each plugin type

### Updated Type Definition

```typescript
// src/renderer/src/types/plugin.ts

export type PluginType = 'agent' | 'command' | 'skill'  // UPDATED

export interface PluginMetadata {
  // Identification
  sourcePath: string        // e.g., "skills/my-skill" or "agents/category/my-agent.md"
  filename: string          // Identifier: "my-skill" (folder) or "my-agent.md" (file)
  name: string              // Display name from frontmatter or filename

  // Content
  description?: string
  allowed_tools?: string[]  // for commands
  tools?: string[]          // for agents and skills

  // Organization
  category: string
  type: PluginType          // UPDATED: now 'agent' | 'command' | 'skill'
  tags?: string[]

  // Versioning
  version?: string
  author?: string

  // Metadata
  size: number              // File size (for files) or folder size (for skills)
  contentHash: string       // Hash of .md file or SKILL.md
  installedAt?: number
  updatedAt?: number
}
```

---

## Backend Implementation

### 1. File Operation Utilities

**File**: `src/main/utils/fileOperations.ts` (NEW)

```typescript
import * as fs from 'fs'
import * as path from 'path'

/**
 * Recursively copy a directory and all its contents
 */
export async function copyDirectoryRecursive(
  source: string,
  destination: string
): Promise<void> {
  // Create destination directory
  await fs.promises.mkdir(destination, { recursive: true })

  // Read source directory
  const entries = await fs.promises.readdir(source, { withFileTypes: true })

  // Copy each entry
  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name)
    const destPath = path.join(destination, entry.name)

    if (entry.isDirectory()) {
      // Recursively copy subdirectory
      await copyDirectoryRecursive(sourcePath, destPath)
    } else {
      // Copy file
      await fs.promises.copyFile(sourcePath, destPath)
    }
  }
}

/**
 * Recursively delete a directory and all its contents
 */
export async function deleteDirectoryRecursive(dirPath: string): Promise<void> {
  // Node.js 14.14+ has fs.rm with recursive option
  await fs.promises.rm(dirPath, { recursive: true, force: true })
}

/**
 * Get total size of a directory (in bytes)
 */
export async function getDirectorySize(dirPath: string): Promise<number> {
  let totalSize = 0

  const entries = await fs.promises.readdir(dirPath, { withFileTypes: true })

  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name)

    if (entry.isDirectory()) {
      totalSize += await getDirectorySize(entryPath)
    } else {
      const stats = await fs.promises.stat(entryPath)
      totalSize += stats.size
    }
  }

  return totalSize
}
```

### 2. Markdown Parser Extension

**File**: `src/main/utils/markdownParser.ts` (UPDATE)

Add skill metadata parsing:

```typescript
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import matter from 'gray-matter'
import * as yaml from 'js-yaml'
import type { PluginMetadata, PluginError } from '@/types/plugin'
import { getDirectorySize } from './fileOperations'

/**
 * Parse metadata from SKILL.md within a skill folder
 *
 * @param skillFolderPath - Absolute path to skill folder
 * @param sourcePath - Relative path from plugins base (e.g., "skills/my-skill")
 * @param category - Category name (typically "skills" for flat structure)
 * @returns PluginMetadata with folder name as filename (no extension)
 */
export async function parseSkillMetadata(
  skillFolderPath: string,
  sourcePath: string,
  category: string
): Promise<PluginMetadata> {
  // Look for SKILL.md in the folder
  const skillMdPath = path.join(skillFolderPath, 'SKILL.md')

  // Check if SKILL.md exists
  try {
    await fs.promises.stat(skillMdPath)
  } catch (error) {
    throw {
      type: 'FILE_NOT_FOUND',
      path: skillMdPath,
      message: 'SKILL.md not found in skill folder'
    } as PluginError
  }

  // Read and parse SKILL.md
  const content = await fs.promises.readFile(skillMdPath, 'utf8')

  // Parse frontmatter safely
  const { data } = matter(content, {
    engines: {
      yaml: (s) => yaml.load(s, { schema: yaml.FAILSAFE_SCHEMA })
    }
  })

  // Calculate hash of SKILL.md only
  const contentHash = crypto.createHash('sha256').update(content).digest('hex')

  // Get folder name as identifier (NO EXTENSION)
  const folderName = path.basename(skillFolderPath)

  // Get total folder size
  const folderSize = await getDirectorySize(skillFolderPath)

  // Parse tools (skills use 'tools', not 'allowed_tools')
  let tools: string[] | undefined
  if (data.tools) {
    if (Array.isArray(data.tools)) {
      tools = data.tools
    } else if (typeof data.tools === 'string') {
      tools = data.tools.split(',').map(t => t.trim()).filter(Boolean)
    }
  }

  // Parse tags
  let tags: string[] | undefined
  if (data.tags) {
    if (Array.isArray(data.tags)) {
      tags = data.tags
    } else if (typeof data.tags === 'string') {
      tags = data.tags.split(',').map(t => t.trim()).filter(Boolean)
    }
  }

  return {
    sourcePath,               // e.g., "skills/my-skill"
    filename: folderName,     // e.g., "my-skill" (folder name, NO .md extension)
    name: data.name || folderName,
    description: data.description,
    tools,
    category,                 // "skills" for flat structure
    type: 'skill',
    tags,
    version: data.version,
    author: data.author,
    size: folderSize,
    contentHash               // Hash of SKILL.md content only
  }
}
```

### 3. PluginService Updates

**File**: `src/main/services/PluginService.ts` (UPDATE)

Add skill-specific methods:

```typescript
import { copyDirectoryRecursive, deleteDirectoryRecursive } from '@/utils/fileOperations'
import { parseSkillMetadata } from '@/utils/markdownParser'

// ... existing imports and class definition ...

export class PluginService {
  // ... existing properties ...

  /**
   * Sanitize folder name for skills
   * Different rules than file names: no extensions allowed
   */
  private sanitizeFolderName(folderName: string): string {
    // Remove path separators
    let sanitized = folderName.replace(/[/\\]/g, '_')
    // Remove null bytes
    sanitized = sanitized.replace(/\0/g, '')
    // Limit to safe characters (alphanumeric, dash, underscore)
    // NOTE: No dots allowed to avoid confusion with file extensions
    sanitized = sanitized.replace(/[^a-zA-Z0-9_-]/g, '_')

    // Validate no extension was provided
    if (folderName.includes('.')) {
      throw {
        type: 'INVALID_METADATA',
        reason: 'Skill folder names should not include extensions',
        path: folderName
      } as PluginError
    }

    return sanitized
  }

  /**
   * Scan skills directory for skill folders
   */
  private async scanSkillDirectory(): Promise<PluginMetadata[]> {
    const basePath = this.getPluginsBasePath()
    const skillsPath = path.join(basePath, 'skills')

    const skills: PluginMetadata[] = []

    try {
      // Check if skills directory exists
      try {
        await fs.promises.access(skillsPath)
      } catch {
        this.logger.warn('Skills directory not found', { skillsPath })
        return []
      }

      // Read all entries in skills directory (flat structure)
      const entries = await fs.promises.readdir(skillsPath, { withFileTypes: true })

      for (const entry of entries) {
        // Skip non-directories
        if (!entry.isDirectory()) continue

        const skillFolderPath = path.join(skillsPath, entry.name)
        const sourcePath = path.join('skills', entry.name)

        try {
          const metadata = await parseSkillMetadata(
            skillFolderPath,
            sourcePath,
            'skills' // Use 'skills' as category for flat structure
          )
          skills.push(metadata)
        } catch (error) {
          this.logger.error('Failed to parse skill folder', { skillFolderPath, error })
          // Continue with other skills
        }
      }
    } catch (error) {
      this.logger.error('Failed to scan skill directory', { skillsPath, error })
      // Return empty array on error
    }

    return skills
  }

  /**
   * Install a skill (copy entire folder)
   */
  private async installSkill(
    agent: AgentEntity,
    sourceAbsolutePath: string,
    destPath: string,
    metadata: PluginMetadata
  ): Promise<void> {
    const logger = this.logger.withContext('installSkill')

    // Step 1: If destination exists, remove it first (overwrite behavior)
    let existingRemoved = false
    try {
      await fs.promises.access(destPath)
      // Exists - remove it
      await deleteDirectoryRecursive(destPath)
      existingRemoved = true
      logger.info('Removed existing skill folder', { destPath })
    } catch {
      // Doesn't exist - nothing to remove
    }

    // Step 2: Copy folder to temporary location
    const tempPath = `${destPath}.tmp`
    let folderCopied = false

    try {
      // Copy to temp location
      await copyDirectoryRecursive(sourceAbsolutePath, tempPath)
      folderCopied = true
      logger.info('Skill folder copied to temp location', { tempPath })

      // Step 3: Update agent configuration in database
      const updatedPlugins = [
        ...(agent.configuration?.installed_plugins || []).filter(
          p => !(p.filename === metadata.filename && p.type === 'skill')
        ),
        {
          sourcePath: metadata.sourcePath,
          filename: metadata.filename,  // Folder name, no extension
          type: metadata.type,
          name: metadata.name,
          description: metadata.description,
          tools: metadata.tools,
          version: metadata.version,
          contentHash: metadata.contentHash,
          installedAt: Date.now()
        }
      ]

      await updateAgent(agent.id, {
        configuration: {
          ...agent.configuration,
          installed_plugins: updatedPlugins
        }
      })

      logger.info('Agent configuration updated', { agentId: agent.id })

      // Step 4: Move temp folder to final location (atomic on same filesystem)
      await fs.promises.rename(tempPath, destPath)
      logger.info('Skill folder moved to final location', { destPath })

    } catch (error) {
      // Rollback: delete temp folder if it exists
      if (folderCopied) {
        try {
          await deleteDirectoryRecursive(tempPath)
          logger.info('Rolled back temp folder', { tempPath })
        } catch (unlinkError) {
          logger.error('Failed to rollback temp folder', { tempPath, error: unlinkError })
        }
      }

      throw {
        type: 'TRANSACTION_FAILED',
        operation: 'install-skill',
        reason: error.message
      } as PluginError
    }
  }

  /**
   * Uninstall a skill (remove entire folder)
   */
  private async uninstallSkill(
    agent: AgentEntity,
    folderName: string
  ): Promise<void> {
    const logger = this.logger.withContext('uninstallSkill')
    const workdir = agent.accessible_paths[0]
    const skillPath = path.join(workdir, '.claude', 'skills', folderName)

    // Step 1: Update database first
    const originalPlugins = agent.configuration?.installed_plugins || []
    const updatedPlugins = originalPlugins.filter(
      p => !(p.filename === folderName && p.type === 'skill')
    )

    let dbUpdated = false

    try {
      await updateAgent(agent.id, {
        configuration: {
          ...agent.configuration,
          installed_plugins: updatedPlugins
        }
      })
      dbUpdated = true
      logger.info('Agent configuration updated', { agentId: agent.id })

      // Step 2: Delete folder
      try {
        await deleteDirectoryRecursive(skillPath)
        logger.info('Skill folder deleted', { skillPath })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error // Folder should exist, re-throw if not ENOENT
        }
        logger.warn('Skill folder already deleted', { skillPath })
      }

    } catch (error) {
      // Rollback: restore database if folder deletion failed
      if (dbUpdated) {
        try {
          await updateAgent(agent.id, {
            configuration: {
              ...agent.configuration,
              installed_plugins: originalPlugins
            }
          })
          logger.info('Rolled back database update', { agentId: agent.id })
        } catch (rollbackError) {
          logger.error('Failed to rollback database', { agentId: agent.id, error: rollbackError })
        }
      }

      throw {
        type: 'TRANSACTION_FAILED',
        operation: 'uninstall-skill',
        reason: error.message
      } as PluginError
    }
  }

  /**
   * Update listAvailable() to include skills
   */
  async listAvailable(): Promise<ListAvailablePluginsResult> {
    const now = Date.now()

    // Return cached data if still valid
    if (
      this.availablePluginsCache &&
      (now - this.cacheTimestamp) < this.config.cacheTimeout
    ) {
      this.logger.debug('Returning cached plugin list')
      return this.availablePluginsCache
    }

    this.logger.info('Rebuilding plugin cache')

    // Scan plugin directories (NOW INCLUDING SKILLS)
    const [agents, commands, skills] = await Promise.all([
      this.scanPluginDirectory('agent'),
      this.scanPluginDirectory('command'),
      this.scanSkillDirectory() // NEW
    ])

    const result: ListAvailablePluginsResult = {
      agents,
      commands,
      skills, // NEW
      total: agents.length + commands.length + skills.length
    }

    // Update cache
    this.availablePluginsCache = result
    this.cacheTimestamp = now

    this.logger.info('Plugin cache rebuilt', {
      total: result.total,
      agents: agents.length,
      commands: commands.length,
      skills: skills.length
    })

    return result
  }

  /**
   * Update install() to handle skills
   */
  async install(options: InstallPluginOptions): Promise<PluginMetadata> {
    const logger = this.logger.withContext('install')

    // Validate source path
    this.validateSourcePath(options.sourcePath)

    // Get agent and validate workdir
    const agent = await getAgentById(options.agentId)
    if (!agent) {
      throw {
        type: 'INVALID_WORKDIR',
        agentId: options.agentId,
        workdir: '',
        message: 'Agent not found'
      } as PluginError
    }

    const workdir = agent.accessible_paths[0]
    await this.validateWorkdir(workdir, options.agentId)

    // Construct absolute source path
    const basePath = this.getPluginsBasePath()
    const sourceAbsolutePath = path.join(basePath, options.sourcePath)

    // BRANCH: Handle skills differently than files
    if (options.type === 'skill') {
      // Validate skill folder exists and is a directory
      try {
        const stats = await fs.promises.stat(sourceAbsolutePath)
        if (!stats.isDirectory()) {
          throw {
            type: 'INVALID_METADATA',
            reason: 'Skill source is not a directory',
            path: options.sourcePath
          } as PluginError
        }
      } catch (error) {
        throw {
          type: 'FILE_NOT_FOUND',
          path: sourceAbsolutePath
        } as PluginError
      }

      // Parse metadata from SKILL.md
      const metadata = await parseSkillMetadata(
        sourceAbsolutePath,
        options.sourcePath,
        'skills'
      )

      // Sanitize folder name (different rules than file names)
      const sanitizedFolderName = this.sanitizeFolderName(metadata.filename)

      // Ensure .claude/skills directory exists
      await this.ensureClaudeDirectory(workdir, 'skill')

      // Construct destination path (folder, not file)
      const destPath = path.join(workdir, '.claude', 'skills', sanitizedFolderName)

      // Update metadata with sanitized folder name
      metadata.filename = sanitizedFolderName

      // Execute skill-specific install
      await this.installSkill(agent, sourceAbsolutePath, destPath, metadata)

      logger.info('Skill installed successfully', {
        agentId: options.agentId,
        sourcePath: options.sourcePath,
        folderName: sanitizedFolderName
      })

      return metadata
    }

    // EXISTING LOGIC for agents/commands (unchanged)
    // Files go through existing validation and sanitization
    await this.validatePluginFile(sourceAbsolutePath)

    const parentDir = path.basename(path.dirname(options.sourcePath))
    const metadata = await parsePluginMetadata(
      sourceAbsolutePath,
      options.sourcePath,
      parentDir,
      options.type
    )

    // Sanitize filename (includes .md extension for files)
    const sanitizedFilename = this.sanitizeFilename(metadata.filename)

    // ... rest of existing file-based install logic ...
  }

  /**
   * Update uninstall() to handle skills
   */
  async uninstall(options: UninstallPluginOptions): Promise<void> {
    const logger = this.logger.withContext('uninstall')

    // Get agent
    const agent = await getAgentById(options.agentId)
    if (!agent) {
      throw {
        type: 'INVALID_WORKDIR',
        agentId: options.agentId,
        workdir: '',
        message: 'Agent not found'
      } as PluginError
    }

    // BRANCH: Handle skills differently than files
    if (options.type === 'skill') {
      // For skills, filename is the folder name (no extension)
      // Use sanitizeFolderName to ensure consistency
      const sanitizedFolderName = this.sanitizeFolderName(options.filename)
      await this.uninstallSkill(agent, sanitizedFolderName)

      logger.info('Skill uninstalled successfully', {
        agentId: options.agentId,
        folderName: sanitizedFolderName
      })

      return
    }

    // EXISTING LOGIC for agents/commands (unchanged)
    // For files, filename includes .md extension
    const sanitizedFilename = this.sanitizeFilename(options.filename)
    await this.uninstallTransaction(agent, sanitizedFilename, options.type)

    logger.info('Plugin uninstalled successfully', {
      agentId: options.agentId,
      filename: sanitizedFilename
    })
  }

  /**
   * Update ensureClaudeDirectory() to handle skills
   */
  private async ensureClaudeDirectory(workdir: string, type: PluginType): Promise<void> {
    const claudeDir = path.join(workdir, '.claude')

    let subDir: string
    if (type === 'agent') {
      subDir = 'agents'
    } else if (type === 'command') {
      subDir = 'commands'
    } else if (type === 'skill') {
      subDir = 'skills' // NEW
    } else {
      throw new Error(`Unknown plugin type: ${type}`)
    }

    const targetDir = path.join(claudeDir, subDir)
    await fs.promises.mkdir(targetDir, { recursive: true })
  }
}
```

### 4. IPC Handler Updates

**File**: `src/main/ipc/pluginHandlers.ts` (UPDATE)

```typescript
interface ListAvailablePluginsResult {
  agents: PluginMetadata[]
  commands: PluginMetadata[]
  skills: PluginMetadata[] // NEW
  total: number
}

// IPC handlers remain unchanged - they already use generic types
// The PluginService methods handle the type-specific logic
```

---

## Frontend Implementation

### 1. Update Hooks

**File**: `src/renderer/src/hooks/usePlugins.ts` (UPDATE)

```typescript
export function useAvailablePlugins() {
  const [agents, setAgents] = useState<PluginMetadata[]>([])
  const [commands, setCommands] = useState<PluginMetadata[]>([])
  const [skills, setSkills] = useState<PluginMetadata[]>([]) // NEW
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchPlugins() {
      try {
        setLoading(true)
        const result = await window.claudeCodePlugin.listAvailable()

        if (result.success) {
          setAgents(result.data.agents)
          setCommands(result.data.commands)
          setSkills(result.data.skills) // NEW
          setError(null)
        } else {
          setError(result.error.message)
        }
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }

    fetchPlugins()
  }, [])

  return { agents, commands, skills, loading, error } // NEW: return skills
}

// useInstalledPlugins and usePluginActions remain unchanged
// They already handle 'skill' type generically
```

### 2. Update UI Components

**File**: `src/renderer/src/pages/settings/AgentSettings/components/PluginCard.tsx` (UPDATE)

```typescript
function getPluginTypeBadge(type: PluginType) {
  switch (type) {
    case 'agent':
      return { label: 'Agent', color: 'primary' }
    case 'command':
      return { label: 'Command', color: 'secondary' }
    case 'skill': // NEW
      return { label: 'Skill', color: 'success' }
    default:
      return { label: type, color: 'default' }
  }
}

// Rest of component remains unchanged
```

**File**: `src/renderer/src/pages/settings/AgentSettings/components/PluginBrowser.tsx` (UPDATE)

```typescript
export function PluginBrowser({ agentId }: Props) {
  const { agents, commands, skills, loading, error } = useAvailablePlugins() // NEW: get skills

  // Combine all plugins for display
  const allPlugins = useMemo(
    () => [...agents, ...commands, ...skills], // NEW: include skills
    [agents, commands, skills]
  )

  // Rest of component logic remains the same
  // Search and filtering works on allPlugins automatically
}
```

---

## Session Integration

**File**: Where `GetAgentSessionResponse` is constructed (session handler)

```typescript
// EXISTING logic reads agents and commands
// ADD skills reading:

// Read skills from .claude/skills/
const skillsDir = path.join(workdir, '.claude', 'skills')
if (fs.existsSync(skillsDir)) {
  const skillFolders = await fs.promises.readdir(skillsDir, { withFileTypes: true })

  for (const folder of skillFolders) {
    if (!folder.isDirectory()) continue

    const skillFolderPath = path.join(skillsDir, folder.name)

    try {
      const metadata = await parseSkillMetadata(
        skillFolderPath,
        `skills/${folder.name}`,
        'skills'
      )
      installedPlugins.push({
        filename: folder.name,  // Folder name, no extension
        type: 'skill',
        metadata
      })
    } catch (error) {
      logger.error('Failed to read skill', { skillFolderPath, error })
      // Continue with other skills
    }
  }
}
```

---

## Implementation Steps

### Step 1: Backend Foundation (2-3 hours)

1. **Create file utilities** (`src/main/utils/fileOperations.ts`):
   - Implement `copyDirectoryRecursive()`
   - Implement `deleteDirectoryRecursive()`
   - Implement `getDirectorySize()`

2. **Update markdown parser** (`src/main/utils/markdownParser.ts`):
   - Add `parseSkillMetadata()` function
   - Handle SKILL.md parsing with folder semantics
   - Calculate folder size

3. **Update PluginService** (`src/main/services/PluginService.ts`):
   - Add `sanitizeFolderName()` method (new, different from `sanitizeFilename()`)
   - Add `scanSkillDirectory()`
   - Add `installSkill()`
   - Add `uninstallSkill()`
   - Update `listAvailable()` to include skills
   - Update `install()` to branch on type and use appropriate sanitization
   - Update `uninstall()` to branch on type
   - Update `ensureClaudeDirectory()` for skills

4. **Update IPC handlers** (`src/main/ipc/pluginHandlers.ts`):
   - Update `ListAvailablePluginsResult` interface to include skills

### Step 2: Type System Updates (30 minutes)

1. **Update plugin types** (`src/renderer/src/types/plugin.ts`):
   - Change `PluginType` to include `'skill'`
   - Add documentation about filename semantics

2. **Update agent types** (`src/renderer/src/types/agent.ts`):
   - Verify `installed_plugins` schema supports skill type

### Step 3: Frontend Updates (1-2 hours)

1. **Update hooks** (`src/renderer/src/hooks/usePlugins.ts`):
   - Add `skills` state to `useAvailablePlugins`
   - Return skills in hook result

2. **Update PluginCard** component:
   - Add skill type badge (green/success color)

3. **Update PluginBrowser** component:
   - Include skills in `allPlugins` array
   - Verify search/filter works for skills

### Step 4: Session Integration (1 hour)

1. **Update session handler**:
   - Add skill reading logic from `.claude/skills/`
   - Parse SKILL.md for each folder
   - Add to installedPlugins array

### Step 5: Testing (2-3 hours)

**Unit Tests**:
- `fileOperations.ts` - recursive copy/delete/size
- `markdownParser.ts` - `parseSkillMetadata()` with various folder structures
- `PluginService.ts` - skill methods, sanitizeFolderName()

**Integration Tests**:
- End-to-end skill install flow
- End-to-end skill uninstall flow
- Overwrite behavior (reinstall existing skill)
- Verify folder name consistency (no extensions)
- Test with folders containing multiple files and subdirectories

**Edge Cases**:
- Skill folder with special characters in name
- Empty skill folder (only SKILL.md)
- Missing SKILL.md
- Skill with nested subdirectories
- Concurrent operations

### Step 6: Build Verification (30 minutes)

1. **Run build check**: `yarn build:check`
2. **Manual testing**:
   - Test in development mode
   - Test in production build
   - Verify resource paths work for skills directory

---

## Testing Strategy

### Unit Tests

**sanitizeFolderName()**:
- Valid folder names: "my-skill", "ai_assistant", "test-123"
- Invalid: "my.skill" (contains dot), "my/skill" (path separator)
- Special characters: "my skill" → "my_skill"

**parseSkillMetadata()**:
- Valid SKILL.md with all fields
- Missing SKILL.md in folder
- Invalid frontmatter
- Large folder with many files
- Folder with nested subdirectories

**Skill Install/Uninstall**:
- Success cases
- Overwrite existing skill
- Database update failure → rollback
- Filesystem operation failure → rollback
- Concurrent installs

### Integration Tests

**Complete Skill Lifecycle**:
1. List available skills
2. Install skill → verify folder copied, DB updated
3. Modify installed skill manually
4. Reinstall → verify complete overwrite
5. Uninstall → verify folder removed, DB updated
6. Verify session can't access removed skill

**Mixed Plugin Types**:
- Install agents, commands, and skills on same agent
- Verify all types coexist properly
- Verify uninstalling one type doesn't affect others

---

## Key Design Decisions

### Why Separate Sanitization Methods?

**Decision**: Use `sanitizeFolderName()` for skills, `sanitizeFilename()` for agents/commands.

**Rationale**:
- Files need extensions → `.md` appended by `sanitizeFilename()`
- Folders should not have extensions → error if dot found in `sanitizeFolderName()`
- Different validation rules make semantic difference clear
- Prevents accidental misuse (type safety)

### Why No Extension in Skill Identifier?

**Decision**: Skills use folder name without extension as `filename` field.

**Rationale**:
- Folders don't have extensions in filesystem conventions
- Adding artificial `.skill` extension would be confusing
- Keeps identifier format natural for each storage type
- Type field already distinguishes skills from agents/commands

### Why Hash Only SKILL.md?

**Decision**: `contentHash` only covers SKILL.md content, not entire folder.

**Rationale**:
- Consistent with agents/commands (hash the metadata source)
- Faster computation
- Large binary files in skill would make hashing slow
- SKILL.md changes indicate intent to update
- Future enhancement: add `fullFolderHash` for integrity checking

---

## Backward Compatibility

- ✅ Existing agents/commands code **completely unchanged**
- ✅ Skills are **additive** - no breaking changes
- ✅ Database schema already supports new type via enum extension
- ✅ UI components already handle types generically
- ✅ Agents without skills continue to work normally

---

## Estimated Effort

**Total**: 7-10 hours for a single developer

**Breakdown**:
- Backend utilities and services: 2-3 hours
- Type updates and documentation: 30 minutes
- Frontend updates: 1-2 hours
- Session integration: 1 hour
- Testing: 2-3 hours
- Build verification: 30 minutes

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Breaking existing agents/commands | High | Separate handling preserves existing code |
| Filename semantics confusion | Medium | Clear documentation, different sanitization methods |
| Large skill folders slow install | Medium | Acceptable for MVP, add progress later |
| Recursive operations fail mid-copy | Medium | Transaction rollback with temp folder |
| Missing SKILL.md | Low | Clear error, skip folder during scan |

---

## Future Enhancements (Out of Scope)

1. **Full folder hashing** - Hash all files for integrity checking
2. **Progress indicators** - Show copy progress for large skills
3. **Skill validation** - File type restrictions, size limits
4. **Skill updates** - Detect and prompt for updates
5. **Custom skills** - User-created skills outside resources directory
6. **Skill dependencies** - Skills that require other skills

---

## Implementation Checklist

- [ ] Backend Foundation
  - [ ] Create fileOperations.ts utilities
  - [ ] Add parseSkillMetadata() to markdownParser.ts
  - [ ] Add sanitizeFolderName() to PluginService
  - [ ] Add scanSkillDirectory() to PluginService
  - [ ] Add installSkill() to PluginService
  - [ ] Add uninstallSkill() to PluginService
  - [ ] Update listAvailable() to include skills
  - [ ] Update install() to handle skills
  - [ ] Update uninstall() to handle skills
  - [ ] Update ensureClaudeDirectory() for skills
  - [ ] Update IPC result types
- [ ] Type System
  - [ ] Update PluginType enum
  - [ ] Add documentation for filename semantics
- [ ] Frontend
  - [ ] Update useAvailablePlugins hook
  - [ ] Update PluginCard badge for skills
  - [ ] Update PluginBrowser to include skills
- [ ] Session Integration
  - [ ] Update session handler to read skills
- [ ] Testing
  - [ ] Unit tests for file operations
  - [ ] Unit tests for parseSkillMetadata
  - [ ] Unit tests for sanitizeFolderName
  - [ ] Unit tests for skill install/uninstall
  - [ ] Integration tests for full lifecycle
  - [ ] Edge case tests
- [ ] Build Verification
  - [ ] Run build check
  - [ ] Manual testing in dev mode
  - [ ] Manual testing in production build

---

**Plan Status**: Ready for implementation with clear handling of identifier inconsistency issue.

---

## Implementation Progress

- [x] Create file operation utilities (fileOperations.ts)
- [x] Add skill metadata parsing to markdown parser
- [x] Update plugin types to include 'skill'
- [ ] Add skill scanning to PluginService (scanSkillDirectory, sanitizeFolderName)
- [ ] Add skill installation to PluginService (installSkill)
- [ ] Add skill uninstallation to PluginService (uninstallSkill)
- [ ] Update PluginService methods to support skills (listAvailable, install, uninstall, ensureClaudeDirectory)
- [ ] Update IPC handlers for skills
- [ ] Update frontend hooks for skills
- [ ] Update UI components for skills (PluginCard, PluginBrowser)
- [ ] Add session integration for skills
- [ ] Run build check and verify implementation
