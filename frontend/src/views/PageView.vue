<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useTocStore } from '../stores/tocStore'
import { useCartStore } from '../stores/cartStore'
import TocTree from '../components/TocTree.vue'
import PdfViewer from '../components/PdfViewer.vue'
import { getPageDetails as getPageDetailsApi, getPageIllustration, getMediaToc, getPartThumbnail, getDocumotoBaseUrl, getPageFile } from '../api/documoto'
import { savePageDetails, getIllustrationUrl, saveIllustrationBlob, isPageCached, isPagePreloaded, getThumbnailUrl, saveThumbnailBlob, isBookExplicitlyOffline, getBookToc, getBookRecord, getPageFileUrl, getPageDetails as getPageDetailsOffline } from '../offline/offlineStore.js'
import { Filesystem } from '@capacitor/filesystem'

const route = useRoute()
const router = useRouter()
const { getToc, setToc } = useTocStore()
const { addItem: addCartItem, removeItem: removeCartItem, isInCart, items: cartItems, itemCount: cartItemCount } =
  useCartStore()

const loading = ref(false)
const error = ref('')
const pageInfo = ref(null)
const apiCallCount = ref(null)
const apiCalls = ref([])
const bom = ref([])
const illustrations = ref([])
const hotpoints = ref([])
const selectedItem = ref(null)
const illustrationWidth = ref(0)
const illustrationHeight = ref(0)
const zoom = ref(0.75)
const prevPage = ref(null)
const nextPage = ref(null)
const toc = ref([])
const expandedChapters = ref([])
const illustrationLoading = ref(false)
const illustrationContainerRef = ref(null)

const bomSearch = ref('')
const bomPage = ref(1)
const BOM_PAGE_SIZE = 25

const isOfflineAvailable = ref(false)
const isOfflineFromBook = ref(false)
const isBookOffline = ref(null) // null = unknown, true = offline, false = online
const cachedPageFileUrl = ref(null) // Cached page file URL (blob URL)
const onlinePageFileUrl = ref(null) // Online page file URL (blob URL)

async function loadPage() {
  console.log('=== loadPage START ===')
  loading.value = true
  error.value = ''
  try {
    zoom.value = 0.75
    const currentPageId = route.params.pageId
    const mediaId = route.query.mediaId

    console.log('loadPage - mediaId:', mediaId, 'pageId:', currentPageId)

    // Check if the book is explicitly offline (regardless of current profile)
    const bookIsOffline = await isBookExplicitlyOffline(mediaId)
    isBookOffline.value = bookIsOffline
    console.log('Book offline check for page load:', bookIsOffline)

    console.log('About to call getPageDetailsOffline')
    // Try offline cache first
    let data = await getPageDetailsOffline(currentPageId)
    console.log('Cached page data found:', !!data)

    if (!data) {
      // If book is offline and no cached data, show error (don't try to fetch)
      if (bookIsOffline) {
        console.log('Book is offline but page not cached, showing error')
        error.value = 'This page is not cached offline. Please take the book offline again to cache all pages.'
        loading.value = false
        return
      }

      // If book is not offline, try API with current credentials
      console.log('Book is not offline, calling API for page data')
      const liveData = await getPageDetailsApi(currentPageId)
      data = liveData

      // Persist JSON details offline
      savePageDetails(mediaId, currentPageId, data)

      // Also cache illustration image blob for offline usage (only if not already cached)
      const cachedIllustration = await getIllustrationUrl(currentPageId)
      if (!cachedIllustration) {
        try {
          const blob = await getPageIllustration(currentPageId)
          saveIllustrationBlob(currentPageId, blob)
        } catch (e) {
          if (e.message.includes('404') || e.message.includes('400')) {
            console.log(`Page ${currentPageId} has no illustration`)
          } else {
            console.warn('Failed to prefetch illustration for offline use', e)
          }
        }
      }
    }

    console.log('Processing cached data, data:', data)
    pageInfo.value = data.pageInfo || null
    apiCallCount.value = typeof data.apiCallCount === 'number' ? data.apiCallCount : null
    apiCalls.value = Array.isArray(data.apiCalls) ? data.apiCalls : []

    // Normalize BOM to a flat array of lines. Documoto often returns an object
    // like { billOfMaterials: [...] } or similar; fall back to an array directly.
    const rawBom = data.bom
    if (Array.isArray(rawBom)) {
      bom.value = rawBom.filter(Boolean)
    } else if (rawBom && Array.isArray(rawBom.billOfMaterials)) {
      bom.value = rawBom.billOfMaterials.filter(Boolean)
    } else if (rawBom && Array.isArray(rawBom.bomLines)) {
      bom.value = rawBom.bomLines.filter(Boolean)
    } else if (rawBom && Array.isArray(rawBom.lines)) {
      bom.value = rawBom.lines.filter(Boolean)
    } else {
      bom.value = []
    }
    // Illustration: prefer offline blob URL if available, otherwise load via API
    let offlineIllustrationUrl = await getIllustrationUrl(currentPageId)
    if (offlineIllustrationUrl) {
      illustrations.value = [
        {
          imageUrl: offlineIllustrationUrl,
        },
      ]
    } else if (!isBookOffline.value) {
      // Load illustration via API for online mode
      try {
        const blob = await getPageIllustration(currentPageId)
        const url = URL.createObjectURL(blob)
        illustrations.value = [
          {
            imageUrl: url,
          },
        ]
      } catch (e) {
        console.warn('Failed to load illustration:', e)
        illustrations.value = Array.isArray(data.illustrations) ? data.illustrations : []
      }
    } else {
      illustrations.value = Array.isArray(data.illustrations) ? data.illustrations : []
    }
    illustrationLoading.value = illustrations.value.length > 0

    // Mark whether this page is now available offline and if it came from book preload
    isOfflineAvailable.value = await isPageCached(currentPageId)
    isOfflineFromBook.value = await isPagePreloaded(currentPageId)

    // Check if the book was explicitly taken offline (to skip thumbnail API calls)
    isBookOffline.value = mediaId ? await isBookExplicitlyOffline(mediaId) : false

    // Load cached page file if offline, or load via API if online
    if (isBookOffline.value) {
      cachedPageFileUrl.value = await getPageFileUrl(currentPageId)
      onlinePageFileUrl.value = null
    } else {
      cachedPageFileUrl.value = null
      // Load page file via API for online mode
      const pageFile = data?.pageInfo?.pageFile || data?.pageFile
      if (pageFile) {
        try {
          const filename = pageFile?.fileName || data?.name || `page-${currentPageId}`
          const blob = await getPageFile(currentPageId, filename)
          onlinePageFileUrl.value = URL.createObjectURL(blob)
        } catch (e) {
          console.warn('Failed to load page file:', e)
          onlinePageFileUrl.value = null
        }
      } else {
        onlinePageFileUrl.value = null
      }
    }

    // Normalize hotpoints from shape { id, sheets: [{ hotpoints: [...] }] }.
    const rawHotpoints = data.hotpoints
    if (rawHotpoints && Array.isArray(rawHotpoints.sheets) && rawHotpoints.sheets.length) {
      const sheetHotpoints = Array.isArray(rawHotpoints.sheets[0].hotpoints)
        ? rawHotpoints.sheets[0].hotpoints
        : []

      if (sheetHotpoints.length) {
        hotpoints.value = sheetHotpoints.map((h) => ({
          ...h,
          item: String(h.item),
        }))
      } else {
        hotpoints.value = []
      }
    } else {
      hotpoints.value = []
    }

    // Compute previous/next pages from the media TOC when mediaId is available.
    prevPage.value = null
    nextPage.value = null
    if (mediaId) {
      try {
        // Check if book is explicitly offline first
        const isOffline = await isBookExplicitlyOffline(mediaId)
        
        // Prefer cached TOC if available.
        let tocPayload = getToc(mediaId)
        
        // If offline and not in memory, try IndexedDB
        if (!tocPayload && isOffline) {
          tocPayload = await getBookToc(mediaId)
          if (tocPayload) {
            setToc(mediaId, tocPayload)
          }
        }
        
        // If still not available, fetch from API (only when not offline)
        if (!tocPayload && !isOffline) {
          const tocData = await getMediaToc(mediaId)
          tocPayload = tocData.toc || null
          setToc(mediaId, tocPayload)
        }

        if (tocPayload) {
          const chapters = Array.isArray(tocPayload.tableOfContents)
            ? tocPayload.tableOfContents
            : []

          toc.value = chapters
          expandedChapters.value = chapters.map(() => true)

          const currentIdNum = Number(currentPageId)
          let foundPrev = null
          let foundNext = null
          let found = false
          let allPages = []

          // Collect all pages from all chapters AND pages outside chapters
          for (const item of chapters) {
            // Check if this is a chapter (has children) or a page (has id/pageId)
            if (item.children && Array.isArray(item.children)) {
              // This is a chapter, collect its pages
              for (const p of item.children) {
                allPages.push(p)
              }
            } else if (item.id || item.pageId) {
              // This is a page outside a chapter
              allPages.push(item)
            }
          }

          console.log('Total pages in TOC:', allPages.length)
          console.log('Current page ID:', currentPageId, 'as number:', currentIdNum)

          // Find current page and get previous/next
          for (let i = 0; i < allPages.length; i++) {
            const p = allPages[i]
            const pid = Number(p.id || p.pageId)
            console.log(`Page ${i}: id=${p.id || p.pageId}, pid=${pid}, current=${currentIdNum}`)
            if (pid === currentIdNum) {
              console.log('Found current page at index:', i)
              if (i > 0) {
                const prev = allPages[i - 1]
                foundPrev = {
                  id: prev.id || prev.pageId,
                  name: prev.title || prev.name || `Page ${prev.pageNumber || ''}`,
                }
                console.log('Previous page:', foundPrev)
              }
              if (i < allPages.length - 1) {
                const nxt = allPages[i + 1]
                foundNext = {
                  id: nxt.id || nxt.pageId,
                  name: nxt.title || nxt.name || `Page ${nxt.pageNumber || ''}`,
                }
                console.log('Next page:', foundNext)
              }
              found = true
              break
            }
          }

          if (!found) {
            console.warn('Current page not found in TOC')
          }

          prevPage.value = foundPrev
          nextPage.value = foundNext
        }
      } catch (e) {
        console.error('Error computing previous/next page from TOC:', e)
      }
    }

    // Auto-open PDF modal for document pages
    const fileType = pageInfo.value?.pageFile?.fileType?.toUpperCase?.() || ''
    if (fileType === 'DOCUMENT') {
      showPdfModal.value = true
    }
  } catch (e) {
    console.error(e)
    error.value = e.message
  } finally {
    loading.value = false
  }
}

function buildBomCsv(lines) {
  const rows = []
  rows.push(['Item', 'Part Number', 'Name', 'Qty', 'UOM'])

  for (const line of lines) {
    if (!line) continue
    const item = line.item ?? line.itemNumber ?? ''
    const partNumber = line.partNumber ?? ''
    const name = line.name ?? line.description ?? ''
    const qty = line.quantity ?? ''
    const uom = line.unitOfMeasure ?? ''

    const cols = [item, partNumber, name, qty, uom].map((value) => {
      const s = String(value ?? '')
      const needsQuote = /[",\n]/.test(s)
      const escaped = s.replace(/"/g, '""')
      return needsQuote ? `"${escaped}"` : escaped
    })
    rows.push(cols)
  }

  return rows.map((r) => r.join(',')).join('\n')
}

async function downloadTextFile(filename, mimeType, content) {
  console.log('Starting download:', filename)
  try {
    // Use Capacitor Filesystem for mobile
    const result = await Filesystem.writeFile({
      path: filename,
      data: content,
      directory: 'DOCUMENTS',
      encoding: 'utf8'
    })
    console.log('File saved:', result)
    alert(`File saved to Documents: ${filename}`)
  } catch (e) {
    console.error('Failed to download file with Filesystem:', e)
    // Fallback to browser download for web
    try {
      console.log('Trying fallback download')
      const blob = new Blob([content], { type: mimeType })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      console.log('Fallback download completed')
    } catch (fallbackError) {
      console.error('Fallback download also failed', fallbackError)
      alert('Failed to download file. Check console for details.')
    }
  }
}

async function exportBomAsCsv() {
  const lines = filteredBom.value || []
  if (!lines.length) return
  const csv = buildBomCsv(lines)
  const pageId = route.params.pageId || 'page'
  const filename = `bom-${pageId}.csv`
  await downloadTextFile(filename, 'text/csv;charset=utf-8;', csv)
}

function openPdfModal() {
  showPdfModal.value = true
}

function closePdfModal() {
  showPdfModal.value = false
}

async function downloadPdf() {
  console.log('Starting PDF download')
  if (pageFileUrl.value) {
    const filename = pageInfo.value?.pageFile?.fileName || 'document.pdf'
    
    // Try browser download first (works for blob URLs)
    try {
      console.log('Trying browser download for PDF')
      const link = document.createElement('a')
      link.href = pageFileUrl.value
      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      console.log('Browser PDF download completed')
      alert(`PDF downloaded: ${filename}`)
    } catch (e) {
      console.error('Browser PDF download failed:', e)
      alert('Failed to download PDF. Check console for details.')
    }
  }
}

onMounted(() => {
  loadShowApiCalls()
  loadPage()
})

watch(
  () => route.params.pageId,
  () => {
    loadPage()
  }
)

function selectItem(itemValue) {
  selectedItem.value = itemValue ? String(itemValue) : null
}

function handleIllustrationLoad(event) {
  const img = event?.target
  if (!img) return
  illustrationWidth.value = img.naturalWidth || img.width || 0
  illustrationHeight.value = img.naturalHeight || img.height || 0
  illustrationLoading.value = false

  const container = illustrationContainerRef.value
  if (container) {
    container.scrollTop = 0
    container.scrollLeft = 0
  }
}

function zoomIn() {
  zoom.value = Math.min(zoom.value + 0.25, 3)
}

function zoomOut() {
  zoom.value = Math.max(zoom.value - 0.25, 0.5)
}

const showApiCalls = ref(false)
const showPdfModal = ref(false)

// Load showApiCalls setting
function loadShowApiCalls() {
  showApiCalls.value = localStorage.getItem('showApiCalls') === 'true'
}

// Page type detection based on pageFile.fileType
const pageType = computed(() => {
  const fileType = pageInfo.value?.pageFile?.fileType?.toUpperCase?.() || ''
  if (fileType === 'IMAGE') return 'image'
  if (fileType === 'DOCUMENT') return 'document'
  // Default to interactive (parts page) if it has BOM/hotpoints or no specific fileType
  return 'interactive'
})

const pageFileUrl = computed(() => {
  const pageId = route.params.pageId
  if (!pageId) return null
  // Wait until offline status is determined before rendering
  if (isBookOffline.value === null) return null
  // If offline and cached, use cached URL
  if (isBookOffline.value) {
    return cachedPageFileUrl.value || null
  }
  // If online, use blob URL from API
  return onlinePageFileUrl.value || null
})

const pageFileInlineUrl = computed(() => {
  const pageId = route.params.pageId
  if (!pageId) return null
  // Wait until offline status is determined before rendering
  if (isBookOffline.value === null) return null
  // If offline and cached, use cached URL
  if (isBookOffline.value) {
    return cachedPageFileUrl.value || null
  }
  // If online, use blob URL from API
  return onlinePageFileUrl.value || null
})

function handleThumbnailError(line) {
  if (line) {
    line._thumbError = true
  }
}

async function ensureThumbnailUrl(line) {
  if (!line || !line.partId) return null
  const key = String(line.partId)
  if (line._thumbUrl) return line._thumbUrl

  const cached = await getThumbnailUrl(key)
  if (cached) {
    line._thumbUrl = cached
    return cached
  }

  // If book is offline and thumbnail not cached, don't fetch from API
  if (isBookOffline.value) {
    line._thumbUrl = null
    return null
  }

  // Load thumbnail via API and create blob URL (works on both web and mobile)
  try {
    const blob = await getPartThumbnail(line.partId)
    const url = URL.createObjectURL(blob)
    line._thumbUrl = url
    // Also save to cache for future use
    await saveThumbnailBlob(key, blob)
    return url
  } catch (e) {
    console.warn('Failed to load part thumbnail:', line.partId, e)
    line._thumbError = true
    return null
  }
}

const filteredBom = computed(() => {
  const term = bomSearch.value.trim().toLowerCase()
  const lines = bom.value || []
  if (!term) return lines

  return lines.filter((line) => {
    if (!line) return false
    const fields = [
      line.partNumber,
      line.partId,
      line.item,
      line.itemNumber,
      line.name,
      line.description,
    ]
      .filter(Boolean)
      .map((v) => String(v).toLowerCase())

    return fields.some((f) => f.includes(term))
  })
})

const totalBomPages = computed(() => {
  const total = filteredBom.value.length
  if (!total) return 1
  return Math.max(1, Math.ceil(total / BOM_PAGE_SIZE))
})

const pagedBom = computed(() => {
  const current = Math.min(Math.max(bomPage.value, 1), totalBomPages.value)
  const start = (current - 1) * BOM_PAGE_SIZE
  return filteredBom.value.slice(start, start + BOM_PAGE_SIZE)
})

watch(
  () => [bom.value, bomSearch.value],
  () => {
    bomPage.value = 1
  }
)

watch(
  () => [pagedBom.value, isBookOffline.value],
  ([lines, isOffline]) => {
    if (!Array.isArray(lines)) return
    if (isOffline === null) return // Wait until offline status is determined
    lines.forEach((line) => {
      // Fire-and-forget; URL will update reactively when ready.
      ensureThumbnailUrl(line)
    })
  },
  { immediate: true }
)

function goToPage(target) {
  if (!target || !target.id) return
  const mediaId = route.query.mediaId
  router.push({ name: 'page', params: { pageId: target.id }, query: mediaId ? { mediaId } : {} })
}

function cartKeyForLine(line) {
  const partId = line?.partId
  const partNumber = line?.partNumber
  const pageId = route.params.pageId
  if (!partId && !partNumber) return null
  return `${pageId || ''}:${partId || ''}:${partNumber || ''}`
}

function toggleCartForLine(line) {
  const key = cartKeyForLine(line)
  if (!key) return

  if (isInCart(key)) {
    removeCartItem(key)
  } else {
    const pageName = pageInfo.value?.title || pageInfo.value?.name || `Page ${pageInfo.value?.pageNumber || route.params.pageId}`
    const mediaName = route.query.mediaName || ''
    const partNumber = line?.visible === false ? null : line?.partNumber || null
    addCartItem(key, {
      key,
      partId: line?.partId || null,
      partNumber,
      name: line?.name || line?.description || '',
      quantity: line?.quantity || 1,
      unitOfMeasure: line?.unitOfMeasure || '',
      pageId: route.params.pageId,
      pageName,
      mediaId: route.query.mediaId || null,
      mediaName,
      visible: line?.visible,
    })
  }
}

function goBackToSearch() {
  router.push({ name: 'search' })
}

function goBackToBook() {
  const mediaId = route.query.mediaId
  if (!mediaId) {
    router.push({ name: 'search' })
    return
  }
  router.push({ name: 'book', params: { mediaId } })
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between gap-4">
      <div class="flex items-center gap-2">
        <button class="text-sm text-sky-600 hover:underline" @click="goBackToSearch">
          ← Back to search
        </button>
        <button
          v-if="route.query.mediaId"
          class="text-sm text-sky-600 hover:underline"
          @click="goBackToBook"
        >
          ← Back to book
        </button>
      </div>

      <div class="flex items-center gap-2">
        <div
          v-if="showApiCalls && apiCallCount !== null"
          class="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] text-slate-600 shadow-sm"
        >
          <span class="font-medium uppercase tracking-wide text-slate-500">API Calls</span>
          <span class="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-800">
            {{ apiCallCount }}
          </span>
        </div>

      </div>
    </div>

    <div class="flex items-center justify-between gap-4">
      <h1 class="text-lg font-semibold">
        {{ pageInfo?.name || pageInfo?.title || `Page ${route.params.pageId}` }}
      </h1>
      <div class="flex items-center gap-2">
        <div v-if="isOfflineAvailable" class="flex items-center gap-2">
          <div
            v-if="isOfflineFromBook"
            class="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700"
          >
            <span>✅ Preloaded with book</span>
          </div>
          <div
            v-else
            class="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-700"
          >
            <span>💾 Cached from view</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Page Navigation -->
    <div v-if="prevPage || nextPage" class="flex items-center justify-between gap-4 rounded border border-slate-200 bg-white p-3">
      <button
        v-if="prevPage"
        type="button"
        class="flex items-center gap-2 rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
        @click="goToPage({ id: prevPage.id, mediaId: route.query.mediaId })"
      >
        <span>←</span>
        <span>{{ prevPage.name }}</span>
      </button>
      <div v-else class="flex-1"></div>
      
      <button
        v-if="nextPage"
        type="button"
        class="flex items-center gap-2 rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
        @click="goToPage({ id: nextPage.id, mediaId: route.query.mediaId })"
      >
        <span>{{ nextPage.name }}</span>
        <span>→</span>
      </button>
      <div v-else class="flex-1"></div>
    </div>

    <p v-if="loading" class="text-sm text-slate-500">Loading page…</p>
    <p v-if="error" class="text-sm text-red-600">{{ error }}</p>

    <div v-if="showApiCalls && apiCalls && apiCalls.length" class="text-[11px] text-slate-500">
      <p class="mb-1 font-medium">Calls for this page:</p>
      <ul class="space-y-0.5">
        <li v-for="call in apiCalls" :key="call" class="font-mono">{{ call }}</li>
      </ul>
    </div>

    <div class="space-y-4 lg:flex lg:items-start lg:gap-6">
      <aside class="hidden space-y-2 rounded border border-slate-200 bg-white text-xs shadow-sm lg:flex lg:h-[640px] lg:w-56 lg:flex-shrink-0 lg:flex-col">
        <div class="border-b border-slate-100 px-3 py-2">
          <h2 class="text-xs font-semibold uppercase tracking-wide text-slate-600">Contents</h2>
        </div>
        <div v-if="toc && toc.length" class="flex-1 overflow-y-auto px-2 py-2">
          <TocTree
            :nodes="toc"
            :depth="0"
            :active-page-id="route.params.pageId"
            :is-offline-book="isBookOffline"
            @open-page="goToPage"
          />
        </div>
      </aside>

      <div class="space-y-4 flex-1">
        <!-- Image Page Display -->
        <div v-if="pageType === 'image'" class="space-y-2">
          <div class="flex items-center justify-between">
            <h2 class="text-sm font-semibold">Image</h2>
          </div>
          <div
            v-if="loading"
            class="flex h-[260px] items-center justify-center rounded border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-500"
          >
            Loading image…
          </div>
          <div v-else-if="pageFileUrl" class="rounded border border-slate-200 bg-white p-4">
            <img
              :src="pageFileUrl"
              alt="Page image"
              class="max-h-[640px] w-auto mx-auto"
            />
          </div>
          <p v-else class="text-xs text-slate-500">No image available.</p>
        </div>

        <!-- Document Page Display -->
        <div v-else-if="pageType === 'document'" class="space-y-2">
          <div class="flex items-center justify-between">
            <h2 class="text-sm font-semibold">Document</h2>
            <div class="flex items-center gap-2">
              <button
                v-if="pageFileInlineUrl"
                type="button"
                class="rounded bg-sky-600 px-3 py-1 text-xs text-white hover:bg-sky-700"
                @click="openPdfModal"
              >
                View PDF
              </button>
              <button
                v-if="pageFileUrl"
                type="button"
                class="rounded border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
                @click="downloadPdf"
              >
                Download
              </button>
            </div>
          </div>
          <div
            v-if="loading"
            class="flex h-[260px] items-center justify-center rounded border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-500"
          >
            Loading document…
          </div>
          <div
            v-else-if="pageFileInlineUrl"
            class="flex h-[260px] items-center justify-center rounded border border-slate-200 bg-slate-50"
          >
            <p class="text-sm text-slate-600">
              PDF loaded. Use the buttons above to view or download.
            </p>
          </div>
          <p v-else class="text-xs text-slate-500">No document available.</p>
        </div>

        <!-- Interactive Page Display (default, with BOM/hotpoints) -->
        <div v-else class="space-y-4">
          <div class="flex items-center justify-between">
            <h2 class="text-sm font-semibold">Illustration</h2>
            <div
              v-if="cartItemCount > 0"
              class="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700"
            >
              <span>🛒 {{ cartItemCount }} item{{ cartItemCount === 1 ? '' : 's' }}</span>
            </div>
          </div>
          <div
            v-if="loading && !illustrations.length"
            class="flex h-[260px] items-center justify-center rounded border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-500"
          >
            Loading illustration and hotpoints…
          </div>
          <div
            v-else-if="illustrations && illustrations.length"
            class="relative border border-slate-200 bg-white"
          >
            <div class="flex items-center justify-end gap-2 border-b border-slate-100 px-3 py-1 text-[11px] text-slate-500">
              <span>Zoom</span>
              <button
                type="button"
                class="rounded border border-slate-300 px-2 py-0.5 hover:bg-slate-50"
                @click="zoomOut"
              >
                -
              </button>
              <span class="w-10 text-center">{{ Math.round(zoom * 100) }}%</span>
              <button
                type="button"
                class="rounded border border-slate-300 px-2 py-0.5 hover:bg-slate-50"
                @click="zoomIn"
              >
                +
              </button>
            </div>

            <div
              ref="illustrationContainerRef"
              class="relative flex h-[520px] items-center justify-center overflow-auto md:h-[640px]"
            >
              <div
                class="relative inline-block origin-top-left"
                :style="{ transform: `scale(${zoom})` }"
              >
                <img
                  :src="illustrations[0].imageUrl || illustrations[0].url"
                  alt="Illustration"
                  class="block h-auto max-w-full"
                  @load="handleIllustrationLoad"
                />

                <button
                  v-for="hp in hotpoints"
                  :key="`${hp.item}-${hp.x}-${hp.y}`"
                  type="button"
                  class="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-sky-500 text-[11px] font-semibold shadow-md transition cursor-pointer"
                  :class="selectedItem === hp.item ? 'bg-sky-600 text-white' : 'bg-white text-sky-700'"
                  :style="{
                    left: illustrationWidth ? (hp.x / illustrationWidth) * 100 + '%' : '0%',
                    top: illustrationHeight ? (hp.y / illustrationHeight) * 100 + '%' : '0%',
                    width: '26px',
                    height: '26px',
                  }"
                  @click.stop="selectItem(hp.item)"
                >
                  {{ hp.item }}
                </button>
              </div>
            </div>
          </div>
          <p v-else class="text-xs text-slate-500">No illustration found.</p>
        </div>
      </div>
    </div>

    <!-- PDF Modal for Document Pages -->
    <div
      v-if="showPdfModal && pageType === 'document'"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      @click.self="closePdfModal"
    >
      <div class="relative flex h-[90vh] w-full max-w-5xl flex-col rounded-lg bg-white shadow-xl">
        <div class="flex items-center justify-between border-b px-4 py-3">
          <h3 class="text-sm font-semibold">{{ pageInfo?.name || 'Document' }}</h3>
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="rounded border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
              @click="downloadPdf"
            >
              Download
            </button>
            <button
              type="button"
              class="rounded-full p-1 hover:bg-slate-100"
              @click="closePdfModal"
            >
              <svg class="h-5 w-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        <div class="flex-1 overflow-hidden">
          <PdfViewer
            v-if="pageFileInlineUrl"
            :key="pageFileInlineUrl"
            :url="pageFileInlineUrl"
          />
        </div>
      </div>
    </div>

    <!-- BOM Section - only for interactive pages -->
    <div v-if="pageType === 'interactive'" class="space-y-2">
      <h2 class="text-sm font-semibold">BOM</h2>
      <div class="flex items-center justify-between gap-2 text-xs">
        <div class="flex-1">
          <input
            v-model="bomSearch"
            type="text"
            class="w-full max-w-xs rounded border border-slate-300 px-2 py-1 text-xs"
            placeholder="Filter BOM by part, item, or name"
          />
        </div>
        <div v-if="filteredBom.length" class="flex items-center gap-3 text-slate-500">
          <span>Page {{ Math.min(bomPage, totalBomPages) }} of {{ totalBomPages }}</span>
          <div class="flex items-center gap-1">
            <button
              type="button"
              class="rounded border border-slate-300 px-2 py-0.5 text-[11px] text-slate-700 hover:bg-slate-50"
              @click.stop="exportBomAsCsv"
            >
              Export CSV
            </button>
          </div>
        </div>
      </div>
      <div v-if="loading" class="rounded border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-xs text-slate-500">
        Loading BOM…
      </div>
      <div v-else class="overflow-x-auto rounded border border-slate-200 bg-white">
        <table class="min-w-full text-sm">
          <thead class="bg-slate-100">
            <tr>
              <th class="w-12 px-1 py-1 text-left font-medium"></th>
              <th class="w-10 px-1 py-1 text-left font-medium"></th>
              <th class="px-2 py-1 text-left font-medium">Item</th>
              <th class="px-2 py-1 text-left font-medium">Part Number</th>
              <th class="px-2 py-1 text-left font-medium">Name</th>
              <th class="px-2 py-1 text-left font-medium">Qty</th>
              <th class="px-2 py-1 text-left font-medium">UOM</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(line, index) in pagedBom || []"
              :key="(line && (line.id || line.lineId)) || index"
              class="border-t cursor-pointer"
              :class="selectedItem === String(line?.item || line?.itemNumber) ? 'bg-sky-50' : ''"
              @click="selectItem(line?.item || line?.itemNumber)"
            >
              <td class="w-12 px-1 py-1">
                <div v-if="line?.partId && !line._thumbError" class="relative inline-block group">
                  <img
                    v-if="line._thumbUrl"
                    :src="line._thumbUrl"
                    alt=""
                    class="h-8 w-8 rounded border border-slate-200 object-contain"
                    @error.stop="handleThumbnailError(line)"
                  />
                  <div
                    class="pointer-events-none absolute left-full top-1/2 z-20 ml-2 hidden -translate-y-1/2 rounded border border-slate-200 bg-white p-1 shadow-lg group-hover:block"
                  >
                    <img
                      v-if="line._thumbUrl"
                      :src="line._thumbUrl"
                      alt=""
                      class="max-h-40 max-w-xs object-contain"
                    />
                  </div>
                </div>
                <div
                  v-else
                  class="flex h-8 w-8 items-center justify-center rounded border border-dashed border-slate-300 bg-slate-50 text-[12px] text-slate-400"
                >
                  ⚙️
                </div>
              </td>
              <td class="w-10 px-1 py-1">
                <div class="flex items-center justify-center gap-0.5 text-[10px] text-slate-500">
                  <span
                    v-if="(Number(line?.partTagCount) || 0) + (Number(line?.pagePartTagCount) || 0) > 0"
                    class="inline-flex items-center rounded border border-amber-300 bg-amber-50 px-1 py-0.5 font-semibold text-amber-700"
                  >
                    🏷️
                  </span>
                  <button
                    v-if="line?.partId && line?.orderable !== false"
                    type="button"
                    class="inline-flex items-center rounded border px-1 py-0.5 font-semibold"
                    :class="isInCart(cartKeyForLine(line))
                      ? 'border-emerald-400 bg-emerald-50 text-emerald-700'
                      : 'border-emerald-300 bg-white text-emerald-600'"
                    @click.stop="toggleCartForLine(line)"
                  >
                    🛒
                  </button>
                </div>
              </td>
              <td class="px-2 py-1">{{ line?.item || line?.itemNumber }}</td>
              <td class="px-2 py-1">
                <span v-if="line?.visible !== false">{{ line?.partNumber }}</span>
              </td>
              <td class="px-2 py-1">{{ line?.name || line?.description }}</td>
              <td class="px-2 py-1">{{ line?.quantity }}</td>
              <td class="px-2 py-1">{{ line?.unitOfMeasure }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div
        v-if="!loading && filteredBom.length > BOM_PAGE_SIZE"
        class="mt-2 flex items-center justify-between text-xs text-slate-600"
      >
        <div>
          Showing
          <span class="font-medium">
            {{ (Math.min(bomPage, totalBomPages) - 1) * BOM_PAGE_SIZE + 1 }}
          </span>
          –
          <span class="font-medium">
            {{ Math.min(
              filteredBom.length,
              (Math.min(bomPage, totalBomPages) - 1) * BOM_PAGE_SIZE + BOM_PAGE_SIZE
            ) }}
          </span>
          of
          <span class="font-medium">{{ filteredBom.length }}</span>
          items
        </div>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="rounded border border-slate-300 px-2 py-0.5 disabled:opacity-40"
            :disabled="bomPage <= 1"
            @click="bomPage = Math.max(1, bomPage - 1)"
          >
            Prev
          </button>
          <button
            type="button"
            class="rounded border border-slate-300 px-2 py-0.5 disabled:opacity-40"
            :disabled="bomPage >= totalBomPages"
            @click="bomPage = Math.min(totalBomPages, bomPage + 1)"
          >
            Next
          </button>
        </div>
      </div>
    </div>

    <!-- Non-interactive page notice -->
    <div v-else-if="pageType !== 'interactive' && !loading" class="rounded border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
      <p v-if="pageType === 'image'">This is an image page. No BOM or hotpoints available.</p>
      <p v-else-if="pageType === 'document'">This is a document page. No BOM or hotpoints available.</p>
    </div>
  </div>
</template>