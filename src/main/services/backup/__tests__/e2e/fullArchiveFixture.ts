/**
 * Full-preset .cherrybackup fixture builder — workstream B3 (full-restore-plan §10.7).
 *
 * Builds the on-disk archive shapes the resource-planning scenarios need: a
 * well-formed full archive plus the corruption/forgery variants planning must
 * reject (`ARCHIVE_CORRUPT`) or admission must refuse (§9 cross-field
 * invariants). The MANIFEST always declares everything the spec lists; a
 * `corrupt` knob breaks only the archive side, so manifest↔archive divergence
 * is exactly what the consumer must detect.
 *
 * Symlink corruption is intentionally absent: archiver/streamzip don't
 * round-trip symlinks portably, and planning checks the UNPACKED workDir —
 * plant symlinks directly in workDir after admission instead.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { assembleArchive } from '../../archive'
import { BACKUP_FORMAT_VERSION, type BackupManifest } from '../../manifest'
import { resolvePreset } from '../../presets'

export interface FixtureFileSpec {
  readonly id: string
  readonly content?: string
  /**
   * missing-blob: manifest claims the id, archive has no `files/<id>` entry.
   * dir-instead-of-file: `files/<id>` is a directory (type-check target).
   */
  readonly corrupt?: 'missing-blob' | 'dir-instead-of-file'
}

export interface FixtureKnowledgeSpec {
  readonly baseId: string
  /** Relative path → content written under `knowledge/<baseId>/`. */
  readonly files?: Readonly<Record<string, string>>
  /** file-instead-of-dir: `knowledge/<baseId>` is a regular file (type-check target). */
  readonly corrupt?: 'file-instead-of-dir'
}

export interface FixtureSkillSpec {
  readonly folderName: string
  readonly files?: Readonly<Record<string, string>>
}

export interface FixtureNoteSpec {
  readonly relPath: string
  readonly content?: string
  /** missing-body: manifest claims the path, archive has no `notes/<relPath>` entry. */
  readonly corrupt?: 'missing-body'
}

export interface FullArchiveSpec {
  /** Caller-owned scratch dir; the builder stages `<stageRoot>/stage-*` trees inside it. */
  readonly stageRoot: string
  readonly archivePath: string
  /** Schema-valid backup.sqlite (e.g. `dbh.sqlite.backup(...)` + seeded rows). */
  readonly dbCopyPath: string
  readonly files?: readonly FixtureFileSpec[]
  readonly knowledgeBases?: readonly FixtureKnowledgeSpec[]
  readonly skills?: readonly FixtureSkillSpec[]
  readonly notes?: readonly FixtureNoteSpec[]
  /** Forgery knob (§9): e.g. `{ includeFiles: false }` on a full preset. */
  readonly manifestOverrides?: Partial<BackupManifest>
}

/**
 * Stage the resource trees per spec, write the full-preset manifest (declaring
 * everything, including corrupt-omitted entries), and pack the archive.
 * Returns the manifest that went into the archive.
 */
export async function buildFullArchive(spec: FullArchiveSpec): Promise<BackupManifest> {
  const filesDir = join(spec.stageRoot, 'stage-files')
  const knowledgeDir = join(spec.stageRoot, 'stage-knowledge')
  const skillsDir = join(spec.stageRoot, 'stage-skills')
  const notesDir = join(spec.stageRoot, 'stage-notes')
  for (const dir of [filesDir, knowledgeDir, skillsDir, notesDir]) mkdirSync(dir, { recursive: true })

  let totalBytes = 0
  for (const file of spec.files ?? []) {
    if (file.corrupt === 'missing-blob') continue
    const target = join(filesDir, file.id)
    if (file.corrupt === 'dir-instead-of-file') {
      // A child file is required: admission extracts file entries only, so an empty
      // directory entry would silently vanish instead of materializing the wrong type.
      mkdirSync(target, { recursive: true })
      writeFileSync(join(target, 'child'), 'x')
      continue
    }
    const content = file.content ?? `blob-${file.id}`
    writeFileSync(target, content)
    totalBytes += Buffer.byteLength(content)
  }

  for (const base of spec.knowledgeBases ?? []) {
    const target = join(knowledgeDir, base.baseId)
    if (base.corrupt === 'file-instead-of-dir') {
      writeFileSync(target, 'not-a-directory')
      continue
    }
    mkdirSync(target, { recursive: true })
    for (const [rel, content] of Object.entries(base.files ?? { 'doc.md': `kb-${base.baseId}` })) {
      mkdirSync(dirname(join(target, rel)), { recursive: true })
      writeFileSync(join(target, rel), content)
    }
  }

  for (const skill of spec.skills ?? []) {
    const target = join(skillsDir, skill.folderName)
    mkdirSync(target, { recursive: true })
    for (const [rel, content] of Object.entries(skill.files ?? { 'SKILL.md': `skill-${skill.folderName}` })) {
      mkdirSync(dirname(join(target, rel)), { recursive: true })
      writeFileSync(join(target, rel), content)
    }
  }

  for (const note of spec.notes ?? []) {
    if (note.corrupt === 'missing-body') continue
    const target = join(notesDir, note.relPath)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, note.content ?? `note-${note.relPath}`)
  }

  const fileIds = (spec.files ?? []).map((f) => f.id)
  const manifest: BackupManifest = {
    backupFormatVersion: BACKUP_FORMAT_VERSION,
    createdAt: new Date().toISOString(),
    preset: 'full',
    domains: [...resolvePreset('full')],
    includeFiles: true,
    includeKnowledgeFiles: true,
    sensitiveData: { included: true, rotated: false },
    schemaMigrationId: '0',
    producerAppVersion: '0.0.0-test',
    files: { ids: fileIds, total: fileIds.length, totalBytes },
    knowledge: { bases: (spec.knowledgeBases ?? []).map((b) => b.baseId) },
    skills: {
      folders: (spec.skills ?? []).map((s) => ({ folderName: s.folderName, contentHash: 'test-hash' }))
    },
    notes: { paths: (spec.notes ?? []).map((n) => n.relPath) },
    degraded: { resources: [] },
    ...spec.manifestOverrides
  }

  await assembleArchive(spec.archivePath, {
    manifest,
    dbCopyPath: spec.dbCopyPath,
    filesDir,
    knowledgeDir,
    skillsDir,
    notesDir
  })
  return manifest
}
