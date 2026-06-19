import { loggerService } from '@logger'

// Side-effect module: sets this window's logger source. App modules (PreferenceService,
// CacheService, databases) log at import time, so the source must be set BEFORE the SubWindowApp
// import runs — otherwise those first lines log with no source ("window source not initialized" →
// 'UNKNOWN'). Static imports execute in source order, so entryPoint.tsx imports this before
// SubWindowApp. Keep it a side-effect import (no bindings) so that ordering is explicit.
loggerService.initWindowSource('SubWindow')
