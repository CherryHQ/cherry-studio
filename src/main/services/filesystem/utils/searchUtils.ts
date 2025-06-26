import fs from 'fs/promises'
import { minimatch } from 'minimatch'
import path from 'path'

import { validatePath } from './pathValidation'

export async function searchFiles(
  allowedDirectories: string[],
  rootPath: string,
  pattern: string,
  excludePatterns: string[] = []
): Promise<string[]> {
  const results: string[] = []

  async function search(currentPath: string) {
    const entries = await fs.readdir(currentPath, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name)

      try {
        // Validate each path before processing
        await validatePath(allowedDirectories, fullPath)

        // Check if path matches any exclude pattern
        const relativePath = path.relative(rootPath, fullPath)
        const shouldExclude = excludePatterns.some((pattern) => {
          const globPattern = pattern.includes('*') ? pattern : `**/${pattern}/**`
          return minimatch(relativePath, globPattern, { dot: true })
        })

        if (shouldExclude) {
          continue
        }

        if (entry.name.toLowerCase().includes(pattern.toLowerCase())) {
          results.push(fullPath)
        }

        if (entry.isDirectory()) {
          await search(fullPath)
        }
      } catch (error) {
        // Skip invalid paths during search
      }
    }
  }

  await search(rootPath)
  return results
}

// Prepare for ripgrep integration
export interface CodeSearchOptions {
  path: string
  pattern: string
  filePattern?: string
  excludePatterns?: string[]
  contextLines?: number
}

export async function searchCode(
  allowedDirectories: string[],
  options: CodeSearchOptions
): Promise<
  Array<{
    file: string
    line: number
    content: string
    match: string
  }>
> {
  const results: Array<{ file: string; line: number; content: string; match: string }> = []

  // First get all files to search through
  let filesToSearch: string[]

  if (options.filePattern) {
    // Search for files matching the file pattern
    filesToSearch = await searchFiles(allowedDirectories, options.path, options.filePattern, options.excludePatterns)
  } else {
    // Get all files recursively
    filesToSearch = await getAllFiles(allowedDirectories, options.path, options.excludePatterns)
  }

  // Filter to text files only to avoid binary files
  const textFileExtensions = new Set([
    // Programming languages
    '.js',
    '.ts',
    '.jsx',
    '.tsx',
    '.mjs',
    '.cjs',
    '.es6',
    '.es',
    '.py',
    '.pyw',
    '.java',
    '.class',
    '.jar',
    '.cpp',
    '.cc',
    '.cxx',
    '.c',
    '.h',
    '.hpp',
    '.hxx',
    '.cs',
    '.vb',
    '.fs',
    '.fsx',
    '.fsi',
    '.ml',
    '.mli',
    '.go',
    '.rs',
    '.php',
    '.rb',
    '.pl',
    '.pm',
    '.swift',
    '.kt',
    '.kts',
    '.dart',
    '.scala',
    '.sc',
    '.clj',
    '.cljs',
    '.cljc',
    '.hs',
    '.lhs',
    '.elm',
    '.erl',
    '.hrl',
    '.ex',
    '.exs',
    '.jl',
    '.nim',
    '.nims',
    '.cr',
    '.zig',
    '.odin',
    '.v',

    // Web technologies
    '.html',
    '.htm',
    '.xhtml',
    '.xml',
    '.xsl',
    '.xslt',
    '.svg',
    '.css',
    '.scss',
    '.sass',
    '.less',
    '.stylus',
    '.styl',
    '.vue',
    '.svelte',
    '.astro',
    '.lit',

    // Data and config
    '.json',
    '.jsonc',
    '.json5',
    '.yaml',
    '.yml',
    '.toml',
    '.ini',
    '.cfg',
    '.conf',
    '.env',
    '.envrc',
    '.properties',
    '.plist',

    // Documentation
    '.md',
    '.mdx',
    '.txt',
    '.rst',
    '.asciidoc',
    '.adoc',
    '.org',

    // Scripts and shell
    '.sh',
    '.bash',
    '.zsh',
    '.fish',
    '.csh',
    '.tcsh',
    '.ksh',
    '.ps1',
    '.psm1',
    '.psd1',
    '.bat',
    '.cmd',

    // Database
    '.sql',
    '.psql',
    '.mysql',
    '.sqlite',
    '.db',

    // Other text formats
    '.log',
    '.logs',
    '.gitignore',
    '.gitattributes',
    '.gitmodules',
    '.gitkeep',
    '.editorconfig',
    '.prettierrc',
    '.eslintrc',
    '.babelrc',
    '.stylelintrc',
    '.dockerignore',
    '.nvmrc',
    '.yarnrc',
    '.npmrc',
    '.license',
    '.copyright',
    '.authors',
    '.contributors',
    '.changelog',
    '.readme',
    '.makefile',
    '.dockerfile',
    '.vagrantfile',
    '.gemfile',
    '.podfile',
    '.cartfile',
    '.procfile',
    '.requirements',
    '.pipfile',
    '.poetry',
    '.cargo',

    // Template files
    '.mustache',
    '.handlebars',
    '.hbs',
    '.ejs',
    '.erb',
    '.haml',
    '.pug',
    '.jade',
    '.twig',
    '.smarty',
    '.velocity',
    '.ftl',
    '.jsp',
    '.asp',
    '.aspx',
    '.php3',
    '.php4',
    '.php5',

    // Configuration files (often without extension)
    '',
    '.config',
    '.conf',
    '.cfg',
    '.ini',
    '.properties'
  ])

  for (const file of filesToSearch) {
    try {
      // Skip binary files more intelligently
      if (!isTextFile(file, textFileExtensions)) {
        continue
      }

      const content = await fs.readFile(file, 'utf-8')
      const lines = content.split('\n')

      // Use regex for better pattern matching with context
      const regex = new RegExp(options.pattern, 'gi')
      const contextLines = options.contextLines || 0

      lines.forEach((line, index) => {
        const matches = line.match(regex)
        if (matches) {
          // Get context lines if requested
          let contextContent = line.trim()
          if (contextLines > 0) {
            const startIdx = Math.max(0, index - contextLines)
            const endIdx = Math.min(lines.length - 1, index + contextLines)
            const contextArr = []

            for (let i = startIdx; i <= endIdx; i++) {
              const prefix = i === index ? '>' : ' '
              contextArr.push(`${prefix} ${i + 1}: ${lines[i]}`)
            }
            contextContent = contextArr.join('\n')
          }

          results.push({
            file,
            line: index + 1,
            content: contextContent,
            match: matches[0]
          })
        }
      })
    } catch (error) {
      // Skip files that can't be read (binary files, permission errors, etc.)
      continue
    }
  }

  return results
}

async function getAllFiles(
  allowedDirectories: string[],
  rootPath: string,
  excludePatterns: string[] = []
): Promise<string[]> {
  const results: string[] = []

  async function traverse(currentPath: string) {
    try {
      const entries = await fs.readdir(currentPath, { withFileTypes: true })

      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name)

        try {
          // Validate each path before processing
          await validatePath(allowedDirectories, fullPath)

          // Check if path matches any exclude pattern
          const relativePath = path.relative(rootPath, fullPath)
          const shouldExclude = excludePatterns.some((pattern) => {
            const globPattern = pattern.includes('*') ? pattern : `**/${pattern}/**`
            return minimatch(relativePath, globPattern, { dot: true })
          })

          if (shouldExclude) {
            continue
          }

          if (entry.isFile()) {
            results.push(fullPath)
          } else if (entry.isDirectory()) {
            await traverse(fullPath)
          }
        } catch (error) {
          // Skip invalid paths during traversal
          continue
        }
      }
    } catch (error) {
      // Skip directories we can't read
      return
    }
  }

  await traverse(rootPath)
  return results
}

// Helper function to determine if a file is likely a text file
function isTextFile(filePath: string, textFileExtensions: Set<string>): boolean {
  const ext = path.extname(filePath).toLowerCase()
  const fileName = path.basename(filePath).toLowerCase()

  // Check by extension
  if (textFileExtensions.has(ext)) {
    return true
  }

  // Check files without extension by name patterns
  if (!ext) {
    const textFilePatterns = [
      /^readme$/i,
      /^license$/i,
      /^changelog$/i,
      /^authors$/i,
      /^contributors$/i,
      /^copyright$/i,
      /^makefile$/i,
      /^dockerfile$/i,
      /^vagrantfile$/i,
      /^gemfile$/i,
      /^podfile$/i,
      /^cartfile$/i,
      /^procfile$/i,
      /^requirements$/i,
      /^pipfile$/i,
      /\.lock$/i,
      /\.config$/i,
      /\.env/i
    ]

    return textFilePatterns.some((pattern) => pattern.test(fileName))
  }

  // Some files with uncommon extensions but are text
  const uncommonTextExtensions = [
    '.gradle',
    '.sbt',
    '.mvn',
    '.pom',
    '.cmake',
    '.bazel',
    '.buck',
    '.nix',
    '.cabal',
    '.stack',
    '.clang-format',
    '.clang-tidy'
  ]

  return uncommonTextExtensions.includes(ext)
}
