// Documoto API client
// Supports both browser mode (via backend proxy) and mobile app mode (direct API calls)
import { CapacitorHttp } from '@capacitor/core'
import { getApiUrl } from '../config'

// Check if running in browser (not Capacitor)
// More reliable check: verify we're actually in a native Capacitor context
const isBrowser = !(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform())

// Debug platform detection
console.log('Platform detection:', {
  hasCapacitor: !!window.Capacitor,
  isNative: window.Capacitor?.isNativePlatform?.(),
  platform: window.Capacitor?.getPlatform?.(),
  isBrowser
})

export function getDocumotoBaseUrl(environment = 'integration') {
  if (environment === 'production') {
    return 'https://api.digabit.com/api/ext'
  }
  return 'https://integration.digabit.com/api/ext'
}

export function buildHeaders(apiKey) {
  const headers = {
    'Content-Type': 'application/json',
  }
  if (apiKey) {
    headers['Authorization'] = apiKey
  }
  return headers
}

// Get active profile from localStorage
export function getActiveProfile() {
  console.log('getActiveProfile called')
  
  const activeProfileId = localStorage.getItem('activeProfileId')
  console.log('activeProfileId from localStorage:', activeProfileId)
  
  if (!activeProfileId) {
    console.log('No activeProfileId found')
    return null
  }
  
  const profilesJson = localStorage.getItem('profiles')
  console.log('profiles from localStorage:', profilesJson ? 'found' : 'not found', 'length:', profilesJson?.length)
  
  if (!profilesJson) {
    console.log('No profiles found in localStorage')
    return null
  }
  
  try {
    const profiles = JSON.parse(profilesJson)
    console.log('Parsed profiles count:', profiles.length)
    const profile = profiles.find(p => p.id === activeProfileId)
    console.log('Found matching profile:', !!profile, 'profileId:', profile?.id, 'hasApiKey:', !!profile?.apiKey)
    return profile || null
  } catch (e) {
    console.error('Failed to parse profiles from localStorage:', e)
    return null
  }
}

// Generic API call function
async function documotoFetch(url, options = {}, responseType = 'json') {
  console.log('documotoFetch called:', { url, isBrowser, responseType })
  
  if (isBrowser) {
    // Browser mode: use backend proxy
    const baseUrl = getDocumotoBaseUrl()
    console.log('Base URL:', baseUrl)
    const path = url.replace(baseUrl, '')
    console.log('Path after replacement:', path)
    // Add /api prefix for backend proxy
    const proxyPath = path.startsWith('/api') ? path : `/api${path}`
    const proxyUrl = getApiUrl(proxyPath)
    console.log('Proxy URL:', proxyUrl)
    
    const response = await fetch(proxyUrl, {
      ...options,
      headers: {
        ...options.headers,
        'Content-Type': 'application/json',
      }
    })
    
    if (responseType === 'blob') {
      return response
    }
    
    return response
  } else {
    // Mobile app mode: use Capacitor HTTP (bypasses CORS)
    const profile = getActiveProfile()
    const apiKey = profile?.apiKey || ''
    const tenantKey = profile?.tenantKey || ''
    
    // Debug profile loading
    console.log('Mobile profile loaded:', {
      hasProfile: !!profile,
      hasApiKey: !!apiKey,
      apiKeyLength: apiKey?.length,
      hasTenantKey: !!tenantKey,
      profileId: profile?.id
    })
    
    const headers = buildHeaders(apiKey)
    
    // Add tenant key to headers if available
    if (tenantKey) {
      headers['X-Tenant-Key'] = tenantKey
    }
  
    console.log('API Request:', { url, headers: { ...headers, Authorization: headers.Authorization ? '***' : undefined }, responseType })
  
    // Merge options properly to ensure headers aren't overwritten
    const requestOptions = {
      url,
      method: options.method || 'GET',
      headers: { ...headers, ...(options.headers || {}) },
      responseType,
      ...options,
    }
    // Ensure headers are properly set after spread
    requestOptions.headers = { ...headers, ...(options.headers || {}) }
    
    console.log('CapacitorHttp request:', { 
      url: requestOptions.url, 
      method: requestOptions.method,
      headers: { ...requestOptions.headers, Authorization: requestOptions.headers.Authorization ? '***' : undefined },
      responseType: requestOptions.responseType 
    })
    
    const response = await CapacitorHttp.request(requestOptions)
  
    console.log('API Response:', { status: response.status, ok: response.status >= 200 && response.status < 300 })
  
    if (response.status < 200 || response.status >= 300) {
      console.error('API Error:', response.data)
      throw new Error(`API error ${response.status}: ${JSON.stringify(response.data)}`)
    }
  
    // Return a response-like object with json() method
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      json: async () => response.data,
      text: async () => typeof response.data === 'string' ? response.data : JSON.stringify(response.data),
      blob: async () => {
        // For blob responses, CapacitorHttp returns the data as base64
        if (response.data && typeof response.data === 'string') {
          // Convert base64 to blob
          const byteCharacters = atob(response.data)
          const byteNumbers = new Array(byteCharacters.length)
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i)
          }
          const byteArray = new Uint8Array(byteNumbers)
          const mimeType = response.headers?.['Content-Type'] || 'image/jpeg'
          return new Blob([byteArray], { type: mimeType })
        } else if (response.data && typeof response.data === 'object' && response.data.data) {
          // Capacitor blob format
          const base64 = response.data.data
          const byteCharacters = atob(base64)
          const byteNumbers = new Array(byteCharacters.length)
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i)
          }
          const byteArray = new Uint8Array(byteNumbers)
          const mimeType = response.headers?.['Content-Type'] || 'image/jpeg'
          return new Blob([byteArray], { type: mimeType })
        }
        return new Blob()
      }
    }
  }
}

// API endpoints
export async function searchMedia(query) {
  const profile = getActiveProfile()
  const baseUrl = getDocumotoBaseUrl(profile?.environment || 'integration')
  const url = `${baseUrl}/library/search/v1?q=${encodeURIComponent(query)}`
  
  const response = await documotoFetch(url)
  const data = await response.json()
  
  if (!response.ok) {
    throw new Error(data?.error || 'Search failed')
  }
  
  return data
}

export async function getMediaToc(mediaId) {
  const profile = getActiveProfile()
  const baseUrl = getDocumotoBaseUrl(profile?.environment || 'integration')
  
  const tocUrl = `${baseUrl}/library/media/v1/${encodeURIComponent(mediaId)}/tocs`
  const mediaUrl = `${baseUrl}/library/media/v1/${encodeURIComponent(mediaId)}`
  
  const [tocRes, mediaRes] = await Promise.all([
    documotoFetch(tocUrl),
    documotoFetch(mediaUrl),
  ])
  
  const [toc, mediaInfo] = await Promise.all([
    tocRes.json(),
    mediaRes.json(),
  ])
  
  if (!tocRes.ok || !mediaRes.ok) {
    throw new Error('Failed to load media details')
  }
  
  return { mediaInfo, toc }
}

export async function getMediaTags(mediaId) {
  const profile = getActiveProfile()
  const baseUrl = getDocumotoBaseUrl(profile?.environment || 'integration')
  
  const allTags = []
  let nextUrl = `${baseUrl}/library/media/v1/${encodeURIComponent(mediaId)}/tags`
  let apiCallCount = 0
  
  while (nextUrl) {
    const response = await documotoFetch(nextUrl)
    apiCallCount++
    if (!response.ok) {
      throw new Error('Failed to load media tags')
    }
    
    const data = await response.json()
    if (Array.isArray(data.tags)) {
      allTags.push(...data.tags)
    }
    
    nextUrl = data.nextPage || null
  }
  
  return { tags: allTags, apiCallCount }
}

export async function getPageDetails(pageId) {
  const profile = getActiveProfile()
  const baseUrl = getDocumotoBaseUrl(profile?.environment || 'integration')
  
  const pageUrl = `${baseUrl}/library/pages/v1/${encodeURIComponent(pageId)}`
  const bomUrl = `${baseUrl}/library/pages/v1/${encodeURIComponent(pageId)}/boms`
  const hotpointsUrl = `${baseUrl}/library/pages/v1/${encodeURIComponent(pageId)}/hotpoints`
  
  // Fetch page details first (required)
  const pageRes = await documotoFetch(pageUrl)
  if (!pageRes.ok) {
    throw new Error('Failed to load page details')
  }
  const pageInfo = await pageRes.json()
  
  // BOM and hotpoints are optional (only for parts pages)
  // Fetch them independently and handle 400 errors gracefully
  let bom = null
  let hotpoints = null
  
  try {
    const bomRes = await documotoFetch(bomUrl)
    if (bomRes.ok) {
      bom = await bomRes.json()
    }
  } catch (e) {
    // 400 errors are expected for non-parts pages
    if (!e.message.includes('400') && !e.message.includes('Only Parts Pages')) {
      console.warn('Failed to load BOM:', e)
    }
  }
  
  try {
    const hotpointsRes = await documotoFetch(hotpointsUrl)
    if (hotpointsRes.ok) {
      hotpoints = await hotpointsRes.json()
    }
  } catch (e) {
    // 400 errors are expected for non-parts pages
    if (!e.message.includes('400') && !e.message.includes('Only Parts Pages')) {
      console.warn('Failed to load hotpoints:', e)
    }
  }
  
  return { pageInfo, bom, hotpoints }
}

export async function getPageIllustration(pageId) {
  const profile = getActiveProfile()
  const baseUrl = getDocumotoBaseUrl(profile?.environment || 'integration')
  const url = `${baseUrl}/library/pages/v1/${encodeURIComponent(pageId)}/page-illustrations`
  
  const response = await documotoFetch(url, {}, 'blob')
  
  if (!response.ok) {
    throw new Error('Failed to load illustration')
  }
  
  return response.blob()
}

export async function getPageThumbnail(pageId) {
  const profile = getActiveProfile()
  const baseUrl = getDocumotoBaseUrl(profile?.environment || 'integration')
  const url = `${baseUrl}/library/pages/v1/${encodeURIComponent(pageId)}/thumbnails`
  
  const response = await documotoFetch(url, {}, 'blob')
  
  if (!response.ok) {
    throw new Error('Failed to load thumbnail')
  }
  
  return response.blob()
}

export async function getPageFile(pageId, filename) {
  const profile = getActiveProfile()
  const baseUrl = getDocumotoBaseUrl(profile?.environment || 'integration')
  const url = `${baseUrl}/library/pages/v1/${encodeURIComponent(pageId)}/page-files`
  
  const response = await documotoFetch(url, {}, 'blob')
  
  if (!response.ok) {
    throw new Error('Failed to load page file')
  }
  
  return response.blob()
}

export async function getPartThumbnail(partId) {
  const profile = getActiveProfile()
  const baseUrl = getDocumotoBaseUrl(profile?.environment || 'integration')
  const url = `${baseUrl}/library/parts/v1/${encodeURIComponent(partId)}/thumbnails`
  
  const response = await documotoFetch(url, {}, 'blob')
  
  if (!response.ok) {
    throw new Error('Failed to load part thumbnail')
  }
  
  return response.blob()
}

export async function getMediaThumbnail(mediaId) {
  const profile = getActiveProfile()
  const baseUrl = getDocumotoBaseUrl(profile?.environment || 'integration')
  const url = `${baseUrl}/library/media/v1/${encodeURIComponent(mediaId)}/thumbnails`
  
  const response = await documotoFetch(url, {}, 'blob')
  
  if (!response.ok) {
    throw new Error('Failed to load media thumbnail')
  }
  
  return response.blob()
}

export async function getMediaFile(mediaId) {
  const profile = getActiveProfile()
  const baseUrl = getDocumotoBaseUrl(profile?.environment || 'integration')
  const url = `${baseUrl}/library/media/v1/${encodeURIComponent(mediaId)}/media-files`
  
  const response = await documotoFetch(url, {}, 'blob')
  
  if (!response.ok) {
    throw new Error('Failed to load media file')
  }
  
  return response.blob()
}

export async function getBrowseFlows() {
  const profile = getActiveProfile()
  const baseUrl = getDocumotoBaseUrl(profile?.environment || 'integration')
  const url = `${baseUrl}/library/browse-flows/v1`
  
  const response = await documotoFetch(url)
  const data = await response.json()
  
  if (!response.ok) {
    throw new Error('Failed to load browse flows')
  }
  
  return data
}

export async function getBrowseFlow(flowId) {
  const profile = getActiveProfile()
  const baseUrl = getDocumotoBaseUrl(profile?.environment || 'integration')
  const url = `${baseUrl}/library/browse-flows/v1/${encodeURIComponent(flowId)}`
  
  const response = await documotoFetch(url)
  const data = await response.json()
  
  if (!response.ok) {
    throw new Error('Failed to load browse flow')
  }
  
  return data
}

export async function getBrowseFlowResults(flowId, params = {}) {
  const profile = getActiveProfile()
  const baseUrl = getDocumotoBaseUrl(profile?.environment || 'integration')
  const queryParams = new URLSearchParams({ offset: 0, limit: 100, ...params })
  const url = `${baseUrl}/library/browse-flows/v1/${encodeURIComponent(flowId)}/results?${queryParams}`
  
  const response = await documotoFetch(url)
  const data = await response.json()
  
  if (!response.ok) {
    throw new Error('Failed to load browse flow results')
  }
  
  return data
}

export async function getBrowseFlowThumbnail(flowId) {
  const profile = getActiveProfile()
  const baseUrl = getDocumotoBaseUrl(profile?.environment || 'integration')
  const url = `${baseUrl}/library/browse-flows/v1/${encodeURIComponent(flowId)}/thumbnails`
  
  const response = await documotoFetch(url, {}, 'blob')
  
  if (!response.ok) {
    throw new Error('Failed to load browse flow thumbnail')
  }
  
  return response.blob()
}

export async function getBrowseFlowItemThumbnail(itemId) {
  const profile = getActiveProfile()
  const baseUrl = getDocumotoBaseUrl(profile?.environment || 'integration')
  const url = `${baseUrl}/library/browse-flows/v1/${encodeURIComponent(itemId)}/thumbnails`
  
  const response = await documotoFetch(url, {}, 'blob')
  
  if (!response.ok) {
    throw new Error('Failed to load browse flow item thumbnail')
  }
  
  return response.blob()
}
