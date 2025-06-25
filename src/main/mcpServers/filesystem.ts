// Refactored filesystem MCP server using service-oriented architecture

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema, ToolSchema } from '@modelcontextprotocol/sdk/types.js'
import { zodToJsonSchema } from 'zod-to-json-schema'

import { FileSystemService } from '../services/filesystem'
import {
  CreateDirectoryArgsSchema,
  DirectoryTreeArgsSchema,
  EditBlockArgsSchema,
  EditFileArgsSchema,
  FileSystemConfig,
  GetFileInfoArgsSchema,
  ListDirectoryArgsSchema,
  MoveFileArgsSchema,
  ReadFileArgsSchema,
  ReadMultipleFilesArgsSchema,
  SearchCodeArgsSchema,
  SearchFilesArgsSchema,
  WriteFileArgsSchema
} from '../services/filesystem/types'

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const ToolInputSchema = ToolSchema.shape.inputSchema
type ToolInput = import('zod').infer<typeof ToolInputSchema>

class FileSystemServer {
  public server: Server
  private fileSystemService: FileSystemService

  constructor(allowedDirs: string[], config?: Partial<FileSystemConfig>) {
    const fsConfig: FileSystemConfig = {
      allowedDirectories: allowedDirs,
      fileWriteLineLimit: config?.fileWriteLineLimit,
      enableAuditLogging: config?.enableAuditLogging ?? false
    }

    this.fileSystemService = new FileSystemService(fsConfig)

    this.server = new Server(
      {
        name: 'secure-filesystem-server',
        version: '0.3.0'
      },
      {
        capabilities: {
          tools: {}
        }
      }
    )

    this.initialize()
  }

  async validateDirectories() {
    await this.fileSystemService.initialize()
  }

  initialize() {
    // Tool handlers
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'read_file',
            description:
              'Read the complete contents of a file from the file system. ' +
              'Handles various text encodings and provides detailed error messages ' +
              'if the file cannot be read. Use this tool when you need to examine ' +
              'the contents of a single file. Only works within allowed directories.',
            inputSchema: zodToJsonSchema(ReadFileArgsSchema) as ToolInput
          },
          {
            name: 'read_multiple_files',
            description:
              'Read the contents of multiple files simultaneously. This is more ' +
              'efficient than reading files one by one when you need to analyze ' +
              "or compare multiple files. Each file's content is returned with its " +
              "path as a reference. Failed reads for individual files won't stop " +
              'the entire operation. Only works within allowed directories.',
            inputSchema: zodToJsonSchema(ReadMultipleFilesArgsSchema) as ToolInput
          },
          {
            name: 'write_file',
            description:
              'Create a new file or completely overwrite an existing file with new content. ' +
              'Use with caution as it will overwrite existing files without warning. ' +
              'Handles text content with proper encoding. Only works within allowed directories.',
            inputSchema: zodToJsonSchema(WriteFileArgsSchema) as ToolInput
          },
          {
            name: 'edit_file',
            description:
              'Make line-based edits to a text file. Each edit replaces exact line sequences ' +
              'with new content. Returns a git-style diff showing the changes made. ' +
              'Only works within allowed directories.',
            inputSchema: zodToJsonSchema(EditFileArgsSchema) as ToolInput
          },
          {
            name: 'edit_block',
            description:
              'Make targeted text replacements in a file by searching for specific text blocks. ' +
              'Supports fuzzy matching when exact matches are not found. Perfect for code editing ' +
              'and surgical text modifications. Returns a git-style diff showing changes.',
            inputSchema: zodToJsonSchema(EditBlockArgsSchema) as ToolInput
          },
          {
            name: 'create_directory',
            description:
              'Create a new directory or ensure a directory exists. Can create multiple ' +
              'nested directories in one operation. If the directory already exists, ' +
              'this operation will succeed silently. Perfect for setting up directory ' +
              'structures for projects or ensuring required paths exist. Only works within allowed directories.',
            inputSchema: zodToJsonSchema(CreateDirectoryArgsSchema) as ToolInput
          },
          {
            name: 'list_directory',
            description:
              'Get a detailed listing of all files and directories in a specified path. ' +
              'Results clearly distinguish between files and directories with [FILE] and [DIR] ' +
              'prefixes. This tool is essential for understanding directory structure and ' +
              'finding specific files within a directory. Only works within allowed directories.',
            inputSchema: zodToJsonSchema(ListDirectoryArgsSchema) as ToolInput
          },
          {
            name: 'directory_tree',
            description:
              'Get a recursive tree view of files and directories as a JSON structure. ' +
              "Each entry includes 'name', 'type' (file/directory), and 'children' for directories. " +
              'Files have no children array, while directories always have a children array (which may be empty). ' +
              'The output is formatted with 2-space indentation for readability. Only works within allowed directories.',
            inputSchema: zodToJsonSchema(DirectoryTreeArgsSchema) as ToolInput
          },
          {
            name: 'move_file',
            description:
              'Move or rename files and directories. Can move files between directories ' +
              'and rename them in a single operation. If the destination exists, the ' +
              'operation will fail. Works across different directories and can be used ' +
              'for simple renaming within the same directory. Both source and destination must be within allowed directories.',
            inputSchema: zodToJsonSchema(MoveFileArgsSchema) as ToolInput
          },
          {
            name: 'search_files',
            description:
              'Recursively search for files and directories matching a pattern. ' +
              'Searches through all subdirectories from the starting path. The search ' +
              'is case-insensitive and matches partial names. Returns full paths to all ' +
              "matching items. Great for finding files when you don't know their exact location. " +
              'Only searches within allowed directories.',
            inputSchema: zodToJsonSchema(SearchFilesArgsSchema) as ToolInput
          },
          {
            name: 'search_code',
            description:
              'Search for text patterns within files using fast text search. ' +
              'Supports file pattern filtering and exclude patterns. Returns matching lines ' +
              'with line numbers and context. Perfect for finding specific code patterns ' +
              'or text across multiple files.',
            inputSchema: zodToJsonSchema(SearchCodeArgsSchema) as ToolInput
          },
          {
            name: 'get_file_info',
            description:
              'Retrieve detailed metadata about a file or directory. Returns comprehensive ' +
              'information including size, creation time, last modified time, permissions, ' +
              'and type. This tool is perfect for understanding file characteristics ' +
              'without reading the actual content. Only works within allowed directories.',
            inputSchema: zodToJsonSchema(GetFileInfoArgsSchema) as ToolInput
          },
          {
            name: 'list_allowed_directories',
            description:
              'Returns the list of directories that this server is allowed to access. ' +
              'Use this to understand which directories are available before trying to access files.',
            inputSchema: {
              type: 'object',
              properties: {},
              required: []
            }
          }
        ]
      }
    })

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const { name, arguments: args } = request.params

        switch (name) {
          case 'read_file': {
            const parsed = ReadFileArgsSchema.safeParse(args)
            if (!parsed.success) {
              throw new Error(`Invalid arguments for read_file: ${parsed.error}`)
            }
            const result = await this.fileSystemService.readFile(parsed.data.path)
            if (!result.success) {
              throw new Error(result.error)
            }
            return {
              content: [{ type: 'text', text: result.data! }]
            }
          }

          case 'read_multiple_files': {
            const parsed = ReadMultipleFilesArgsSchema.safeParse(args)
            if (!parsed.success) {
              throw new Error(`Invalid arguments for read_multiple_files: ${parsed.error}`)
            }
            const result = await this.fileSystemService.readMultipleFiles(parsed.data.paths)
            if (!result.success) {
              throw new Error(result.error)
            }
            const fileContents = Array.from(result.data!.entries())
              .map(([path, content]) => `${path}:\n${content}\n`)
              .join('\n---\n')
            return {
              content: [{ type: 'text', text: fileContents }]
            }
          }

          case 'write_file': {
            const parsed = WriteFileArgsSchema.safeParse(args)
            if (!parsed.success) {
              throw new Error(`Invalid arguments for write_file: ${parsed.error}`)
            }
            const result = await this.fileSystemService.writeFile(parsed.data.path, parsed.data.content)
            if (!result.success) {
              throw new Error(result.error)
            }
            return {
              content: [{ type: 'text', text: `Successfully wrote to ${parsed.data.path}` }]
            }
          }

          case 'edit_file': {
            const parsed = EditFileArgsSchema.safeParse(args)
            if (!parsed.success) {
              throw new Error(`Invalid arguments for edit_file: ${parsed.error}`)
            }
            const result = await this.fileSystemService.editFile(
              parsed.data.path,
              parsed.data.edits,
              parsed.data.dryRun
            )
            if (!result.success) {
              throw new Error(result.error)
            }
            return {
              content: [{ type: 'text', text: result.data! }]
            }
          }

          case 'edit_block': {
            const parsed = EditBlockArgsSchema.safeParse(args)
            if (!parsed.success) {
              throw new Error(`Invalid arguments for edit_block: ${parsed.error}`)
            }
            const result = await this.fileSystemService.editBlock(
              parsed.data.path,
              parsed.data.search,
              parsed.data.replace,
              { fuzzy: parsed.data.fuzzy, dryRun: parsed.data.dryRun }
            )
            if (!result.success) {
              throw new Error(result.error)
            }

            const editResult = result.data!
            if (!editResult.success) {
              return {
                content: [{ type: 'text', text: `Edit failed: ${editResult.error}` }]
              }
            }

            return {
              content: [{ type: 'text', text: editResult.diff! }]
            }
          }

          case 'create_directory': {
            const parsed = CreateDirectoryArgsSchema.safeParse(args)
            if (!parsed.success) {
              throw new Error(`Invalid arguments for create_directory: ${parsed.error}`)
            }
            const result = await this.fileSystemService.createDirectory(parsed.data.path)
            if (!result.success) {
              throw new Error(result.error)
            }
            return {
              content: [{ type: 'text', text: `Successfully created directory ${parsed.data.path}` }]
            }
          }

          case 'list_directory': {
            const parsed = ListDirectoryArgsSchema.safeParse(args)
            if (!parsed.success) {
              throw new Error(`Invalid arguments for list_directory: ${parsed.error}`)
            }
            const result = await this.fileSystemService.listDirectory(parsed.data.path)
            if (!result.success) {
              throw new Error(result.error)
            }
            const formatted = result
              .data!.map((entry) => `${entry.type === 'directory' ? '[DIR]' : '[FILE]'} ${entry.name}`)
              .join('\n')
            return {
              content: [{ type: 'text', text: formatted }]
            }
          }

          case 'directory_tree': {
            const parsed = DirectoryTreeArgsSchema.safeParse(args)
            if (!parsed.success) {
              throw new Error(`Invalid arguments for directory_tree: ${parsed.error}`)
            }
            const result = await this.fileSystemService.getDirectoryTree(parsed.data.path)
            if (!result.success) {
              throw new Error(result.error)
            }
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result.data, null, 2)
                }
              ]
            }
          }

          case 'move_file': {
            const parsed = MoveFileArgsSchema.safeParse(args)
            if (!parsed.success) {
              throw new Error(`Invalid arguments for move_file: ${parsed.error}`)
            }
            const result = await this.fileSystemService.moveFile(parsed.data.source, parsed.data.destination)
            if (!result.success) {
              throw new Error(result.error)
            }
            return {
              content: [
                { type: 'text', text: `Successfully moved ${parsed.data.source} to ${parsed.data.destination}` }
              ]
            }
          }

          case 'search_files': {
            const parsed = SearchFilesArgsSchema.safeParse(args)
            if (!parsed.success) {
              throw new Error(`Invalid arguments for search_files: ${parsed.error}`)
            }
            const result = await this.fileSystemService.searchFiles(
              parsed.data.path,
              parsed.data.pattern,
              parsed.data.excludePatterns
            )
            if (!result.success) {
              throw new Error(result.error)
            }
            return {
              content: [{ type: 'text', text: result.data!.length > 0 ? result.data!.join('\n') : 'No matches found' }]
            }
          }

          case 'search_code': {
            const parsed = SearchCodeArgsSchema.safeParse(args)
            if (!parsed.success) {
              throw new Error(`Invalid arguments for search_code: ${parsed.error}`)
            }
            const result = await this.fileSystemService.searchCode({
              path: parsed.data.path,
              pattern: parsed.data.pattern,
              filePattern: parsed.data.filePattern,
              excludePatterns: parsed.data.excludePatterns
            })
            if (!result.success) {
              throw new Error(result.error)
            }

            const formatted =
              result.data!.length > 0
                ? result.data!.map((r) => `${r.path}:${r.lineNumber}: ${r.lineContent}`).join('\n')
                : 'No matches found'

            return {
              content: [{ type: 'text', text: formatted }]
            }
          }

          case 'get_file_info': {
            const parsed = GetFileInfoArgsSchema.safeParse(args)
            if (!parsed.success) {
              throw new Error(`Invalid arguments for get_file_info: ${parsed.error}`)
            }
            const result = await this.fileSystemService.getFileInfo(parsed.data.path)
            if (!result.success) {
              throw new Error(result.error)
            }
            return {
              content: [
                {
                  type: 'text',
                  text: Object.entries(result.data!)
                    .map(([key, value]) => `${key}: ${value}`)
                    .join('\n')
                }
              ]
            }
          }

          case 'list_allowed_directories': {
            const allowedDirs = this.fileSystemService.getAllowedDirectories()
            return {
              content: [
                {
                  type: 'text',
                  text: `Allowed directories:\n${allowedDirs.join('\n')}`
                }
              ]
            }
          }

          default:
            throw new Error(`Unknown tool: ${name}`)
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        return {
          content: [{ type: 'text', text: `Error: ${errorMessage}` }],
          isError: true
        }
      }
    })
  }
}

export default FileSystemServer
