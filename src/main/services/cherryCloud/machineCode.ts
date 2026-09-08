import { createHmac } from 'node:crypto'

import { uuid } from 'systeminformation'

export async function getMachineCode(): Promise<string> {
  const identity = await uuid()
  const machineID = identity.os.trim().toLowerCase()
  if (
    !/^(?:[0-9a-f]{32}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/.test(machineID) ||
    /^(?:0+|f+)$/.test(machineID.replaceAll('-', ''))
  ) {
    throw new Error('A valid system machine ID is required for Cherry Cloud login')
  }

  // Domain separation avoids exposing the system-wide ID to the cloud.
  return createHmac('sha256', 'cherry-studio:cloud-machine-code:v1')
    .update(process.platform)
    .update('\0')
    .update(machineID.replaceAll('-', ''))
    .digest('base64url')
}
