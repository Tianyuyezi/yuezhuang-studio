// The application entry point always enforces account boundaries.
// Standalone workspace routes are composed only behind this authenticated dispatcher.
export { createStudioApp } from './account-app'
export type { StudioAppOptions } from './account-app'
