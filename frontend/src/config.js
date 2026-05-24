// API Configuration
// For browser: use backend proxy at http://localhost:3001
// For mobile app: call Documoto APIs directly (standalone mode)
export const API_BASE_URL = 'http://localhost:3001'

export function getApiUrl(path) {
  // Check if running in Capacitor (mobile app) or browser
  // More reliable check: verify we're actually in a native Capacitor context
  const isCapacitor = window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform() !== 'web'
  
  if (isCapacitor) {
    // Standalone mode: return the path as-is
    // The actual API calls will be handled by the documoto client
    return path
  } else {
    // Browser mode: use backend proxy
    return `${API_BASE_URL}${path}`
  }
}

