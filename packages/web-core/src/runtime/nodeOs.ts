// Browser `node:os` subset: prompt variables (`{{system}}`, `{{arch}}`) describe the user's machine.
function platform(): string {
  return navigator.platform || 'unknown'
}

function arch(): string {
  return 'unknown'
}

export default { platform, arch }
