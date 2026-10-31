// Runs the unmodified desktop preload in the page. Import it before any renderer module: renderer
// services read `window.api` when they are created.
import '../../../../src/preload/preload'

export { connectCore } from './electron'
