export function parseManualCompactCommand(content: string): { instructions: string } | undefined {
  const trimmed = content.trim()
  if (!/^\/compact(?:\s|$)/.test(trimmed)) return undefined
  return { instructions: trimmed.slice('/compact'.length).trim() }
}

export function getManualCompactionTurn(agentType: string, content: string, systemReminder: boolean) {
  if (systemReminder || (agentType !== 'pi' && agentType !== 'pi-durable')) return undefined
  return parseManualCompactCommand(content)
}
