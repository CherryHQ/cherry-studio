/**
 * Side Panel Entry Point
 *
 * This loads the window.api shim first, then bootstraps the existing
 * Cherry Studio React application.
 */

// Load the shim FIRST - this sets up window.api before any other code runs
import './shim'

// Now load the existing renderer initialization
import '@renderer/init'
import '@renderer/entryPoint'

// Remove loading spinner once React is ready
const spinner = document.getElementById('spinner')
if (spinner) {
  // Give React a moment to hydrate
  setTimeout(() => {
    spinner.style.opacity = '0'
    spinner.style.transition = 'opacity 0.3s ease'
    setTimeout(() => spinner.remove(), 300)
  }, 100)
}

// Handle pending actions from context menu
async function handlePendingAction() {
  const { pendingAction } = await chrome.storage.session.get('pendingAction')
  if (pendingAction) {
    // Clear it so it doesn't trigger again
    await chrome.storage.session.remove('pendingAction')

    // Wait for app to be ready
    await new Promise((resolve) => setTimeout(resolve, 500))

    // Dispatch custom event that the app can listen to
    window.dispatchEvent(
      new CustomEvent('cherry:action', {
        detail: pendingAction
      })
    )
  }
}

// Check for pending actions when loaded
handlePendingAction()

// Listen for new actions while panel is open
chrome.storage.session.onChanged.addListener((changes) => {
  if (changes.pendingAction?.newValue) {
    handlePendingAction()
  }
})
