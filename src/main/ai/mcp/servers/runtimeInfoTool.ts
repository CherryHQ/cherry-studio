import * as z from 'zod'

export const RUNTIME_INFO_TOOL_NAME = 'runtime_info'

export const runtimeInfoInputSchema = z.object({}).strict()

export const RUNTIME_INFO_DESCRIPTION =
  'Return non-sensitive Cherry Studio runtime metadata: application version, operating system, CPU architecture, ' +
  'and bundled Node.js, Electron, and Chromium versions. This tool does not read user settings or workspace data.'
