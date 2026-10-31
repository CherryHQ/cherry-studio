// Stand-in for the renderer's Sentry setup: desktop renderer events travel to the main process,
// which applies the user's consent and sends them; the Web edition has no such reporter yet.
export function initSentry(): void {}
