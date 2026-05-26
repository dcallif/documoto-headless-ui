<script setup>
import { onMounted, ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useTocStore } from '../stores/tocStore'
import TocTree from '../components/TocTree.vue'
import {
  getMediaToc,
  getMediaTags,
  getPageDetails as getPageDetailsApi,
  getPageIllustration,
  getPageThumbnail,
  getPageFile,
  getPartThumbnail,
  getMediaThumbnail,
} from '../api/documoto'
import {
  savePageDetails,
  saveIllustrationBlob,
  getIllustrationUrl,
  clearBookForMedia,
  saveBookMetadata,
  isBookCached,
  isBookExplicitlyOffline,
  saveThumbnailBlob,
  getThumbnailUrl,
  savePageThumbnailBlob,
  getPageThumbnailUrl,
  savePageFileBlob,
  getPageFileUrl,
  saveBookToc,
  getBookToc,
  saveBookMediaInfo,
  getBookMediaInfo,
  saveBookTags,
  getBookTags,
  getMediaThumbnailUrl,
  saveBookOfflineData,
  getPageDetails as getPageDetailsOffline,
} from '../offline/offlineStore'

const route = useRoute()
const router = useRouter()
const { setToc, getToc } = useTocStore()
const mediaId = computed(() => route.params.mediaId)

const loading = ref(false)
const error = ref('')
const mediaInfo = ref(null)
const mediaTags = ref([])
const toc = ref([])
const expandedChapters = ref([])

const offlineInProgress = ref(false)
const offlineCompleted = ref(false)
const offlineError = ref('')
const offlineCurrent = ref(0)
const offlineTotal = ref(0)
const isOfflineBook = ref(null) // null = unknown, true = offline, false = online
const offlineApiCalls = ref([])

const mediaThumbnailUrl = ref(null) // Cached media thumbnail URL for offline books
const onlineMediaThumbnailUrl = ref(null) // Blob URL for online media thumbnail

const collapseAllState = ref(false)
const collapseAllVersion = ref(0)
const showAllTags = ref(false)
const showApiCalls = ref(false)

// Load showApiCalls setting
function loadShowApiCalls() {
  showApiCalls.value = localStorage.getItem('showApiCalls') === 'true'
}

// Group tags by name and sum their value counts for display
const groupedTags = computed(() => {
  const groups = {}
  for (const tag of mediaTags.value || []) {
    const name = tag.name || tag.tagName || 'Unknown'
    if (!groups[name]) {
      groups[name] = { name, totalValues: 0, tags: [] }
    }
    groups[name].totalValues += (tag.values || []).length
    groups[name].tags.push(tag)
  }
  return Object.values(groups)
})

// API calls for the current view (not offline preload)
const viewApiCalls = ref([])
const totalPagesInToc = ref(0)

// Count all pages in the TOC (for illustration API call estimation)
function countAllPages(nodes) {
  if (!Array.isArray(nodes)) return 0
  let count = 0
  for (const node of nodes) {
    if (!node) continue
    if (node.type === 'page' || node.pageId) {
      count += 1
    }
    if (Array.isArray(node.children)) {
      count += countAllPages(node.children)
    }
  }
  return count
}

const viewApiCallCount = computed(() => {
  const baseCount = viewApiCalls.value.length
  // Add 1 for media thumbnail if we have a mediaId
  const mediaThumbnailCount = mediaId.value ? 1 : 0
  // Add page thumbnail calls for all pages in the TOC
  const thumbnailCalls = totalPagesInToc.value
  return baseCount + mediaThumbnailCount + thumbnailCalls
})

const viewApiCallSummary = computed(() => {
  const counts = {}
  for (const name of viewApiCalls.value || []) {
    if (!name) continue
    // Map internal API to Documoto API name
    let documotoName = name
    if (name === 'GET /api/media/:mediaId/tags') {
      documotoName = 'GET /library/media/v1/:mediaId/tags'
    }
    counts[documotoName] = (counts[documotoName] || 0) + 1
  }
  // Add media thumbnail call (mapped to Documoto API)
  if (mediaId.value) {
    counts['GET /library/media/v1/:mediaId/thumbnails'] = 1
  }
  // Add page thumbnail calls for all pages (mapped to Documoto API)
  if (totalPagesInToc.value > 0) {
    counts['GET /library/pages/v1/:pageId/thumbnails'] = totalPagesInToc.value
  }
  return Object.entries(counts).map(([name, count]) => ({ name, count }))
})

const offlineApiCallSummary = computed(() => {
  const source = offlineApiCalls.value || []
  const counts = {}
  
  // Simply count occurrences of each endpoint
  for (const name of source) {
    if (!name) continue
    counts[name] = (counts[name] || 0) + 1
  }
  
  // Sort by count descending
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1])
  return sorted.map(([name, count]) => ({ name, count }))
})

const offlineApiCallCount = computed(() => {
  return offlineApiCallSummary.value.reduce((sum, entry) => sum + entry.count, 0)
})

async function loadToc() {
  const currentMediaId = mediaId.value
  if (!currentMediaId) {
    console.log('loadToc called with no mediaId, skipping')
    return
  }
  
  loading.value = true
  error.value = ''
  mediaInfo.value = null
  toc.value = []
  mediaTags.value = [] // Reset tags when loading new book
  
  // Check if book was explicitly taken offline - if so, NEVER call APIs
  const isExplicitlyOffline = await isBookExplicitlyOffline(currentMediaId)
  console.log('Book offline check for', currentMediaId, ':', isExplicitlyOffline)
  
  if (isExplicitlyOffline) {
    console.log('Book is explicitly offline, loading from cache only', currentMediaId)
    // Load all book data from IndexedDB (persists across reloads)
    const cachedToc = await getBookToc(currentMediaId)
    const cachedMediaInfo = await getBookMediaInfo(currentMediaId)
    const cachedTags = await getBookTags(currentMediaId)
    
    console.log('Cached TOC:', cachedToc)
    console.log('Cached media info:', cachedMediaInfo)
    console.log('Cached tags:', cachedTags)
    
    // Handle different TOC structures - might be { tableOfContents: [...] } or just [...]
    let nodes = []
    if (cachedToc) {
      if (cachedToc.tableOfContents && Array.isArray(cachedToc.tableOfContents)) {
        nodes = cachedToc.tableOfContents
      } else if (Array.isArray(cachedToc)) {
        nodes = cachedToc
      }
    }
    
    if (nodes.length > 0) {
      toc.value = nodes
      totalPagesInToc.value = countAllPages(nodes)
      mediaInfo.value = cachedMediaInfo
      mediaTags.value = cachedTags || []
      // Also cache in memory store for other components
      setToc(currentMediaId, cachedToc)
      isOfflineBook.value = true
      // Load cached media thumbnail for offline display
      console.log('Loading media thumbnail from cache for:', currentMediaId)
      mediaThumbnailUrl.value = await getMediaThumbnailUrl(currentMediaId)
      console.log('Media thumbnail URL:', mediaThumbnailUrl.value ? 'found' : 'not found')
      // Set empty API calls since we're using cached data
      viewApiCalls.value = []
      loading.value = false
      return
    } else {
      // Explicitly offline but no cached data - show error, don't call API
      console.error('Cached TOC is empty or invalid:', cachedToc)
      error.value = 'This book is marked offline but cached data is missing. Please clear offline data and reload.'
      loading.value = false
      return
    }
  } else {
    console.log('Book is NOT explicitly offline, will call API')
  }
  
  try {
    const data = await getMediaToc(mediaId.value)

    // Expecting shape: { mediaInfo, toc: { tableOfContents: [...] } }
    mediaInfo.value = data.mediaInfo || null
    toc.value = data.toc?.tableOfContents || []

    // Load online media thumbnail
    try {
      console.log('Loading online media thumbnail for:', currentMediaId)
      trackApiCall('GET /library/media/v1/:mediaId/thumbnails')
      const blob = await getMediaThumbnail(currentMediaId)
      onlineMediaThumbnailUrl.value = URL.createObjectURL(blob)
      console.log('Online media thumbnail loaded')
    } catch (e) {
      console.warn('Failed to load online media thumbnail:', e)
    }

    // Fetch media tags if tagCount > 0
    const tagCount = mediaInfo.value?.tagCount || 0
    if (tagCount > 0) {
      try {
        const tagsData = await getMediaTags(mediaId.value)
        mediaTags.value = tagsData.tags || []
        // Track all paginated API calls (tagsData.apiCallCount contains actual number of calls made)
        const actualTagCalls = tagsData.apiCallCount || 1
        for (let i = 0; i < actualTagCalls; i++) {
          trackApiCall('GET /library/media/v1/:mediaId/tags')
        }
      } catch (tagsErr) {
        console.error('Failed to fetch media tags:', tagsErr)
        mediaTags.value = []
      }
    } else {
      mediaTags.value = []
    }
    
    const nodes = Array.isArray(data.toc?.tableOfContents)
      ? data.toc.tableOfContents
      : []

    // Cache full TOC payload for this media so PageView and others can reuse it
    // without another network round-trip.
    setToc(mediaId.value, data.toc)
    
    // Also save to IndexedDB for offline persistence (even if not explicitly offline)
    // This helps with refresh scenarios and makes the app more resilient
    const hasExplicitOfflineRecord = await isBookExplicitlyOffline(mediaId.value)
    if (!hasExplicitOfflineRecord) {
      try {
        // Use atomic save to ensure all data is saved together (false = just caching, not explicit offline)
        await saveBookOfflineData(mediaId.value, mediaInfo.value, data.toc, mediaTags.value, false, localStorage.getItem('tenantKey') || '', localStorage.getItem('environment') || 'integration')
      } catch (cacheErr) {
        console.warn('Failed to cache book data to IndexedDB:', cacheErr)
      }
    }

    // API calls are no longer tracked since we're calling Documoto directly
    viewApiCalls.value = []

    // Count total pages in the TOC
    totalPagesInToc.value = countAllPages(nodes)

    // Preserve original order from Documoto TOC
    toc.value = nodes

    // Reflect current offline status for this book (only show badge if explicitly taken offline)
    isOfflineBook.value = await isBookExplicitlyOffline(mediaId.value)
  } catch (e) {
    console.error(e)
    error.value = e.message
  } finally {
    loading.value = false
  }
}

function goBackToSearch() {
  router.push({ name: 'search' })
}

function handleImageError(event) {
  if (event.target) {
    event.target.style.display = 'none'
  }
}

function openPage(page) {
  const pid = page.id || page.pageId
  if (!pid) return
  const mediaName = mediaInfo.value?.title || mediaInfo.value?.name || ''
  const query = mediaName ? { mediaId: mediaId.value, mediaName } : { mediaId: mediaId.value }
  router.push({ name: 'page', params: { pageId: pid }, query })
}

onMounted(() => {
  loadShowApiCalls()
  loadToc()
})

// Reload when mediaId changes (e.g., navigating from search results)
watch(mediaId, (newId, oldId) => {
  if (newId && newId !== oldId) {
    console.log('mediaId changed from', oldId, 'to', newId, '- reloading TOC')
    loadToc()
  }
}, { flush: 'post' })

// Reload when route changes (e.g., profile change) - check offline status again
watch(() => route.fullPath, () => {
  if (mediaId.value) {
    console.log('Route changed, reloading TOC to check offline status')
    loadToc()
  }
}, { flush: 'post' })

function toggleCollapseAll() {
  collapseAllState.value = !collapseAllState.value
  collapseAllVersion.value += 1
}

function toggleChapter(index) {
  expandedChapters.value[index] = !expandedChapters.value[index]
}

function collectPageIds(nodes, out) {
  if (!Array.isArray(nodes)) return
  for (const node of nodes) {
    if (!node) continue

    const hasChildren = Array.isArray(node.children) && node.children.length
    const isChapter = node.type === 'chapter'
    const pid = node.id || node.pageId

    // Treat any non-chapter leaf node with a page id as a page.
    if (!hasChildren && !isChapter && pid) {
      out.push(String(pid))
    }

    if (hasChildren) {
      collectPageIds(node.children, out)
    }
  }
}

// Helper to track API calls
function trackApiCall(endpoint) {
  offlineApiCalls.value.push(endpoint)
}

async function preloadPageOffline(pageId) {
  console.log(`=== preloadPageOffline START for page ${pageId} ===`)
  // Get page details (check cache first)
  let data = await getPageDetailsOffline(pageId)
  const fromCache = !!data
  console.log(`Page ${pageId} from cache:`, fromCache)

  if (!data) {
    console.log(`Page ${pageId} not in cache, fetching from API`)
    trackApiCall('GET /library/pages/v1/:pageId')
    const live = await getPageDetailsApi(pageId)
    data = live
    console.log(`Fetched page ${pageId} from API, saving to cache`)
    await savePageDetails(mediaId.value, pageId, data, { preload: true })
    console.log(`Saved page ${pageId} to cache`)
  } else {
    console.log(`Page ${pageId} already in cache, skipping API call`)
  }

  // Normalize BOM lines
  const rawBom = data.bom
  let lines = []
  if (Array.isArray(rawBom)) {
    lines = rawBom.filter(Boolean)
  } else if (rawBom && Array.isArray(rawBom.billOfMaterials)) {
    lines = rawBom.billOfMaterials.filter(Boolean)
  } else if (rawBom && Array.isArray(rawBom.bomLines)) {
    lines = rawBom.bomLines.filter(Boolean)
  } else if (rawBom && Array.isArray(rawBom.lines)) {
    lines = rawBom.lines.filter(Boolean)
  }

  // BOM and hotpoints are already included in getPageDetails response
  // No separate fetch needed

  // Fetch illustration - check cache independently
  const cachedIllustration = await getIllustrationUrl(pageId)
  if (!cachedIllustration) {
    trackApiCall('GET /library/pages/v1/:pageId/page-illustrations')
    try {
      const blob = await getPageIllustration(pageId)
      await saveIllustrationBlob(pageId, blob)
    } catch (e) {
      if (e.message.includes('404') || e.message.includes('400')) {
        console.log(`Page ${pageId} has no illustration`)
      } else {
        console.warn('Failed to prefetch illustration', pageId, e)
      }
    }
  }

  // Fetch page thumbnail if not cached (always check when taking offline)
  const cachedPageThumb = await getPageThumbnailUrl(pageId)
  if (offlineInProgress.value || !cachedPageThumb) {
    console.log(`Fetching page thumbnail for ${pageId}`)
    trackApiCall('GET /library/pages/v1/:pageId/thumbnails')
    try {
      const blob = await getPageThumbnail(pageId)
      await savePageThumbnailBlob(pageId, blob)
      console.log(`Saved page ${pageId} thumbnail, size:`, blob.size)
    } catch (e) {
      console.warn('Failed to prefetch page thumbnail', pageId, e)
    }
  } else {
    console.log(`Page ${pageId} thumbnail already cached`)
  }

  // Fetch page file (PDF or image) if not cached and page has a file (always fetch when taking offline)
  const pageFile = data?.pageInfo?.pageFile || data?.pageFile
  if (pageFile) {
    const cachedPageFile = await getPageFileUrl(pageId)
    if (offlineInProgress.value || !cachedPageFile) {
      trackApiCall('GET /library/pages/v1/:pageId/page-file')
      try {
        const filename = pageFile?.fileName || data?.name || `page-${pageId}`
        const blob = await getPageFile(pageId, filename)
        await savePageFileBlob(pageId, blob)
      } catch (e) {
        console.warn('Failed to prefetch page file', pageId, e)
      }
    }
  }

  // Fetch part thumbnails that aren't cached
  const uniquePartIds = Array.from(
    new Set(
      lines
        .map((line) => line && line.partId)
        .filter((pid) => pid != null && pid !== '')
        .map((pid) => String(pid))
    )
  )

  for (const partId of uniquePartIds) {
    try {
      const cachedThumb = await getThumbnailUrl(partId)
      if (cachedThumb) continue

      trackApiCall('GET /library/parts/v1/:partId/thumbnails')
      const blob = await getPartThumbnail(partId)
      await saveThumbnailBlob(partId, blob)
    } catch (e) {
      console.warn('Failed to prefetch thumbnail for part', partId, pageId, e)
    }
  }
}

async function takeBookOffline() {
  if (!toc.value || !toc.value.length || offlineInProgress.value) return

  offlineInProgress.value = true
  offlineCompleted.value = false
  offlineError.value = ''
  offlineCurrent.value = 0
  offlineApiCalls.value = []

  try {
    const ids = []
    collectPageIds(toc.value, ids)
    const uniqueIds = Array.from(new Set(ids))
    offlineTotal.value = uniqueIds.length
    console.log(`Taking book offline: processing ${uniqueIds.length} unique pages`, uniqueIds)

    let failedPages = []
    for (let i = 0; i < uniqueIds.length; i++) {
      const pid = uniqueIds[i]
      offlineCurrent.value = i + 1
      console.log(`Processing page ${i + 1}/${uniqueIds.length}: ${pid}`)
      try {
        await preloadPageOffline(pid)
        console.log(`Successfully cached page ${pid}`)
      } catch (e) {
        console.error('Failed to cache page offline', pid, e)
        failedPages.push(pid)
        // Continue with other pages
      }
    }
    
    if (failedPages.length > 0) {
      console.warn(`Failed to cache ${failedPages.length} pages:`, failedPages)
      offlineError.value = `Failed to cache ${failedPages.length} pages. Some pages may not be available offline.`
    }
    
    console.log('Finished processing all pages for offline')

    offlineCompleted.value = true
    // Save all book data atomically in a single transaction (explicitly offline = true)
    await saveBookOfflineData(mediaId.value, mediaInfo.value, { tableOfContents: toc.value }, mediaTags.value, true, localStorage.getItem('tenantKey') || '', localStorage.getItem('environment') || 'integration')
    // Cache media thumbnail for book header (if not already cached)
    try {
      console.log('Checking media thumbnail cache for:', mediaId.value)
      const existingMediaThumb = await getMediaThumbnailUrl(mediaId.value)
      console.log('Media thumbnail cached:', existingMediaThumb ? 'yes' : 'no')
      if (!existingMediaThumb) {
        console.log('Fetching media thumbnail...')
        trackApiCall('GET /library/media/v1/:mediaId/thumbnails')
        const blob = await getMediaThumbnail(mediaId.value)
        console.log('Saving media thumbnail, size:', blob.size)
        await saveThumbnailBlob(`media-${mediaId.value}`, blob)
        console.log('Media thumbnail saved')
        // Load the cached thumbnail for immediate display
        mediaThumbnailUrl.value = URL.createObjectURL(blob)
      } else {
        console.log('Media thumbnail already cached, skipping fetch')
        // Load the cached thumbnail for display
        mediaThumbnailUrl.value = existingMediaThumb
      }
    } catch (e) {
      console.warn('Failed to cache media thumbnail', e)
    }
    isOfflineBook.value = true
  } catch (e) {
    console.error('takeBookOffline failed', e)
    offlineError.value = e.message || String(e)
  } finally {
    offlineInProgress.value = false
  }
}

async function clearOfflineForBook() {
  if (offlineInProgress.value) return
  offlineInProgress.value = true
  offlineError.value = ''
  offlineCompleted.value = false
  offlineCurrent.value = 0
  offlineTotal.value = 0

  try {
    await clearBookForMedia(mediaId.value)
    isOfflineBook.value = false
  } catch (e) {
    console.error('clearOfflineForBook failed', e)
    offlineError.value = e.message || String(e)
  } finally {
    offlineInProgress.value = false
  }
}
</script>

<template>
  <div class="space-y-4 overflow-x-hidden">
    <button class="text-sm text-sky-600 hover:underline" @click="goBackToSearch">
      ← Back to search
    </button>
    <div class="space-y-1 overflow-x-hidden">
      <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 overflow-x-hidden">
        <div class="flex items-center gap-4 w-full sm:w-auto overflow-x-hidden">
          <!-- Media Thumbnail -->
          <div v-if="mediaId && isOfflineBook !== null" class="h-16 w-24 flex-shrink-0 overflow-hidden rounded border border-slate-200 bg-slate-100">
            <!-- Use cached thumbnail when offline, otherwise use API -->
            <img
              v-if="isOfflineBook && mediaThumbnailUrl"
              :src="mediaThumbnailUrl"
              alt=""
              class="h-full w-full object-contain"
            />
            <img
              v-else-if="!isOfflineBook && onlineMediaThumbnailUrl"
              :src="onlineMediaThumbnailUrl"
              alt=""
              class="h-full w-full object-contain"
              @error="handleImageError"
            />
            <!-- Fallback placeholder when offline but no cached thumbnail -->
            <div
              v-if="isOfflineBook && !mediaThumbnailUrl"
              class="h-full w-full flex items-center justify-center text-slate-400"
            >
              📚
            </div>
          </div>
          <div class="min-w-0 flex-1">
            <h1 class="text-lg font-semibold truncate">
              {{ mediaInfo?.title || mediaInfo?.name || mediaId }}
            </h1>
            <p v-if="mediaInfo?.description" class="text-sm text-slate-600 truncate">
              {{ mediaInfo.description }}
            </p>
            <p class="text-xs text-slate-500 truncate">
              Media ID: {{ mediaId }}
            </p>
            <!-- Media Tags -->
            <div v-if="mediaTags.length" class="mt-2 overflow-x-hidden">
              <div class="flex items-center gap-2">
                <span class="text-[10px] font-medium text-slate-500">Tags ({{ mediaTags.length }}):</span>
                <button
                  type="button"
                  class="text-[10px] text-sky-600 hover:underline flex-shrink-0"
                  @click="showAllTags = !showAllTags"
                >
                  {{ showAllTags ? 'Show less' : 'Show all' }}
                </button>
              </div>
              <!-- Collapsed view: grouped tag names with total counts -->
              <div v-if="!showAllTags" class="mt-1 flex flex-wrap gap-1">
                <span
                  v-for="group in groupedTags.slice(0, 3)"
                  :key="group.name"
                  class="inline-flex items-center rounded bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600"
                >
                  {{ group.name }}
                  <span class="ml-1 text-slate-400">({{ group.totalValues }})</span>
                </span>
                <span v-if="groupedTags.length > 3" class="text-[10px] text-slate-400">+{{ groupedTags.length - 3 }} more</span>
              </div>
              <!-- Expanded view: scrollable area with all tags -->
              <div v-else class="mt-1 max-h-32 overflow-y-auto rounded border border-slate-200 bg-slate-50 p-2">
                <div
                  v-for="tag in mediaTags"
                  :key="tag.id || tag.tagId || tag.name"
                  class="mb-1 flex flex-wrap items-center gap-1"
                >
                  <span class="text-[10px] font-medium text-slate-600">{{ tag.name || tag.tagName }}:</span>
                  <span
                    v-for="(val, idx) in (tag.values || []).slice(0, 5)"
                    :key="idx"
                    class="inline-flex items-center rounded-full bg-sky-100 px-2 py-0.5 text-[10px] text-sky-700"
                  >
                    {{ val.value }}
                  </span>
                  <span v-if="(tag.values || []).length > 5" class="text-[10px] text-slate-400">+{{ (tag.values || []).length - 5 }} more</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="flex flex-col items-start gap-2 text-xs w-full">
          <div
            v-if="isOfflineBook"
            class="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700"
          >
            <span>✅ Book available offline</span>
          </div>
          <div class="flex flex-wrap gap-2 w-full">
            <button
              v-if="!isOfflineBook"
              type="button"
              class="inline-flex items-center gap-1 rounded border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              :disabled="loading || offlineInProgress || !toc || !toc.length"
              @click="takeBookOffline"
            >
              <span>📥 Take Book Offline</span>
            </button>
            <button
              type="button"
              class="inline-flex items-center gap-1 rounded border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              :disabled="offlineInProgress"
              @click="clearOfflineForBook"
            >
              <span>🗑 Clear Offline Data</span>
            </button>
          </div>
          <div v-if="offlineInProgress" class="text-slate-500">
            Caching pages {{ offlineCurrent }} / {{ offlineTotal || '?' }}
          </div>
          <div v-if="showApiCalls && offlineApiCallCount" class="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-600 shadow-sm">
            <span class="font-medium uppercase tracking-wide text-slate-500">API Calls</span>
            <span class="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-800">
              {{ offlineApiCallCount }}
            </span>
          </div>
          <div v-else-if="offlineCompleted && offlineTotal" class="text-emerald-600">
            Cached {{ offlineTotal }} page{{ offlineTotal === 1 ? '' : 's' }} for offline use
          </div>
          <div
            v-if="showApiCalls && offlineApiCallSummary.length"
            class="mt-1 w-full text-[11px] text-slate-500"
          >
            <p class="mb-0.5 font-medium">Calls for this offline preload:</p>
            <ul class="space-y-0.5">
              <li
                v-for="call in offlineApiCallSummary"
                :key="call.name"
                class="flex items-center justify-between gap-2"
              >
                <span class="font-mono truncate flex-1">{{ call.name }}</span>
                <span class="text-slate-700 font-semibold whitespace-nowrap">{{ call.count }}</span>
              </li>
            </ul>
          </div>
          <div v-if="offlineError" class="text-red-600">
            {{ offlineError }}
          </div>
        </div>
      </div>
    </div>

    <p v-if="loading" class="text-sm text-slate-500">Loading TOC…</p>
    <div v-if="error" class="rounded border border-red-200 bg-red-50 p-4">
      <p class="text-sm text-red-700">{{ error }}</p>
      <button
        type="button"
        class="mt-2 text-sm text-sky-600 hover:underline"
        @click="goBackToSearch"
      >
        ← Back to search
      </button>
    </div>

    <!-- Document without TOC -->
    <div v-if="!loading && !error && (!toc || !toc.length)" class="rounded border border-slate-200 bg-white p-6">
      <h2 class="text-lg font-semibold text-slate-700 mb-2">{{ mediaInfo?.title || mediaInfo?.name || 'Document' }}</h2>
      <p v-if="mediaInfo?.description" class="text-sm text-slate-600 mb-4">{{ mediaInfo.description }}</p>
      <p class="text-sm text-slate-500 mb-4">This media does not have a table of contents. It may be a standalone document.</p>
      <button
        type="button"
        class="text-sm text-sky-600 hover:underline"
        @click="goBackToSearch"
      >
        ← Back to search
      </button>
    </div>

    <div v-if="!loading && toc && toc.length" class="space-y-4">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <h2 class="text-sm font-semibold text-slate-700">Contents</h2>
          <div
            v-if="showApiCalls && viewApiCallCount > 0"
            class="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-600 shadow-sm"
            title="API calls needed to display this view"
          >
            <span class="font-medium uppercase tracking-wide text-slate-500">API Calls</span>
            <span class="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-800">
              {{ viewApiCallCount }}
            </span>
          </div>
        </div>
        <button
          type="button"
          class="text-xs text-slate-600 hover:text-sky-600 underline"
          @click="toggleCollapseAll"
        >
          {{ collapseAllState ? 'Expand All' : 'Collapse All' }}
        </button>
      </div>

      <!-- API call breakdown for current view -->
      <div
        v-if="showApiCalls && viewApiCallSummary.length"
        class="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600"
      >
        <p class="mb-1 font-medium text-slate-700">Calls to render this view:</p>
        <ul class="space-y-0.5">
          <li
            v-for="call in viewApiCallSummary"
            :key="call.name"
            class="flex items-center justify-between gap-4"
          >
            <span class="font-mono truncate">{{ call.name }}</span>
            <span class="text-slate-700 font-semibold">{{ call.count }}</span>
          </li>
        </ul>
      </div>

      <!-- Nested chapter/page tree in original TOC order -->
      <TocTree
        :nodes="toc"
        :depth="0"
        :collapse-all-version="collapseAllVersion"
        :collapse-all-collapsed="collapseAllState"
        :is-offline-book="isOfflineBook"
        @open-page="openPage"
      />
    </div>
  </div>
</template>