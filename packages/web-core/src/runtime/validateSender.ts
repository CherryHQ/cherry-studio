// Browser `core/security/validateSender`: a dedicated Worker only receives messages from the page
// that created it, so every sender is the app page.
export function validateSender(): boolean {
  return true
}
