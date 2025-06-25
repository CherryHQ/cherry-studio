import { z } from 'zod'

// File operation interfaces
export interface FileInfo {
  size: number
  created: Date
  modified: Date
  accessed: Date
  isDirectory: boolean
  isFile: boolean
  permissions: string
}

export interface TreeEntry {
  name: string
  type: 'file' | 'directory'
  children?: TreeEntry[]
}

export interface EditOperation {
  oldText: string
  newText: string
}

export interface EditResult {
  success: boolean
  diff?: string
  error?: string
}

export interface SearchResult {
  path: string
  lineNumber?: number
  lineContent?: string
  matchCount?: number
}

// Configuration interfaces
export interface FileSystemConfig {
  allowedDirectories: string[]
  fileWriteLineLimit?: number
  enableAuditLogging?: boolean
}

// Service method result types
export interface ServiceResult<T> {
  success: boolean
  data?: T
  error?: string
}

// Schema definitions for validation
export const ReadFileArgsSchema = z.object({
  path: z.string()
})

export const ReadMultipleFilesArgsSchema = z.object({
  paths: z.array(z.string())
})

export const WriteFileArgsSchema = z.object({
  path: z.string(),
  content: z.string()
})

export const EditFileArgsSchema = z.object({
  path: z.string(),
  edits: z.array(
    z.object({
      oldText: z.string().describe('Text to search for - must match exactly'),
      newText: z.string().describe('Text to replace with')
    })
  ),
  dryRun: z.boolean().default(false).describe('Preview changes using git-style diff format')
})

export const EditBlockArgsSchema = z.object({
  path: z.string(),
  search: z.string().describe('Text block to search for'),
  replace: z.string().describe('Text to replace with'),
  fuzzy: z.boolean().default(true).describe('Enable fuzzy matching if exact match not found'),
  dryRun: z.boolean().default(false).describe('Preview changes without applying')
})

export const CreateDirectoryArgsSchema = z.object({
  path: z.string()
})

export const ListDirectoryArgsSchema = z.object({
  path: z.string()
})

export const DirectoryTreeArgsSchema = z.object({
  path: z.string()
})

export const MoveFileArgsSchema = z.object({
  source: z.string(),
  destination: z.string()
})

export const SearchFilesArgsSchema = z.object({
  path: z.string(),
  pattern: z.string(),
  excludePatterns: z.array(z.string()).optional().default([])
})

export const SearchCodeArgsSchema = z.object({
  path: z.string(),
  pattern: z.string(),
  filePattern: z.string().optional(),
  excludePatterns: z.array(z.string()).optional().default([])
})

export const GetFileInfoArgsSchema = z.object({
  path: z.string()
})

// Type exports from schemas
export type ReadFileArgs = z.infer<typeof ReadFileArgsSchema>
export type ReadMultipleFilesArgs = z.infer<typeof ReadMultipleFilesArgsSchema>
export type WriteFileArgs = z.infer<typeof WriteFileArgsSchema>
export type EditFileArgs = z.infer<typeof EditFileArgsSchema>
export type EditBlockArgs = z.infer<typeof EditBlockArgsSchema>
export type CreateDirectoryArgs = z.infer<typeof CreateDirectoryArgsSchema>
export type ListDirectoryArgs = z.infer<typeof ListDirectoryArgsSchema>
export type DirectoryTreeArgs = z.infer<typeof DirectoryTreeArgsSchema>
export type MoveFileArgs = z.infer<typeof MoveFileArgsSchema>
export type SearchFilesArgs = z.infer<typeof SearchFilesArgsSchema>
export type SearchCodeArgs = z.infer<typeof SearchCodeArgsSchema>
export type GetFileInfoArgs = z.infer<typeof GetFileInfoArgsSchema>
