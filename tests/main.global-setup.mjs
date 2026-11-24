import { prepareTools, TOOLS } from '../scripts/download-binaries.js'

export default async function setup() {
  if (!process.env.CI) return

  await prepareTools(process.platform, process.arch, { tools: TOOLS.filter((tool) => tool.name === 'rg') })
}
