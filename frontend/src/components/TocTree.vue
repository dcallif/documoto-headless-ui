<script setup>
import { defineProps, defineEmits, ref, watch, reactive } from 'vue'
import { getPageThumbnailUrl } from '../offline/offlineStore'
import { getDocumotoBaseUrl, getPageThumbnail } from '../api/documoto'

// Define name explicitly for recursive component rendering
defineOptions({ name: 'TocTree' })

const props = defineProps({
  nodes: {
    type: Array,
    default: () => [],
  },
  depth: {
    type: Number,
    default: 0,
  },
  activePageId: {
    type: [String, Number, null],
    default: null,
  },
  collapseAllVersion: {
    type: Number,
    default: 0,
  },
  collapseAllCollapsed: {
    type: Boolean,
    default: false,
  },
  isOfflineBook: {
    type: Boolean,
    default: false,
  },
})

// Cache for offline page thumbnail URLs (use Map in ref for proper reactivity)
const offlineThumbnailUrls = ref(new Map())
const onlineThumbnailUrls = ref(new Map()) // Store blob URLs for online thumbnails
const thumbnailsLoaded = ref(false)

// Pre-load all offline thumbnails when component mounts
async function loadOfflineThumbnails() {
  if (!props.isOfflineBook) {
    console.log('loadOfflineThumbnails: not offline, skipping')
    return
  }
  console.log('loadOfflineThumbnails: loading for', props.nodes?.length, 'nodes')
  let loadedCount = 0
  let missingCount = 0
  
  const newUrls = new Map(offlineThumbnailUrls.value)
  
  for (const node of props.nodes || []) {
    if (isPage(node)) {
      const pageId = node.id || node.pageId
      if (pageId && !newUrls.has(pageId)) {
        const url = await getPageThumbnailUrl(pageId)
        if (url) {
          newUrls.set(pageId, url)
          loadedCount++
          console.log('Loaded thumbnail for page:', pageId)
        } else {
          missingCount++
          console.log('No cached thumbnail for page:', pageId)
        }
      }
    }
    // Also check children recursively
    if (Array.isArray(node.children)) {
      const result = await loadOfflineThumbnailsForNodes(node.children, newUrls)
      loadedCount += result.loaded
      missingCount += result.missing
    }
  }
  
  // Replace entire Map to trigger reactivity
  offlineThumbnailUrls.value = newUrls
  thumbnailsLoaded.value = true
  console.log(`Thumbnail load complete: ${loadedCount} loaded, ${missingCount} missing`)
}

// Load online page thumbnails
async function loadOnlineThumbnails() {
  if (props.isOfflineBook) {
    console.log('loadOnlineThumbnails: offline, skipping')
    return
  }
  console.log('loadOnlineThumbnails: loading for', props.nodes?.length, 'nodes')
  let loadedCount = 0
  
  const newUrls = new Map(onlineThumbnailUrls.value)
  
  for (const node of props.nodes || []) {
    if (isPage(node)) {
      const pageId = node.id || node.pageId
      if (pageId && !newUrls.has(pageId)) {
        try {
          const blob = await getPageThumbnail(pageId)
          const url = URL.createObjectURL(blob)
          newUrls.set(pageId, url)
          loadedCount++
          console.log('Loaded online thumbnail for page:', pageId)
        } catch (e) {
          console.warn('Failed to load online thumbnail for page:', pageId, e)
        }
      }
    }
  }
  
  onlineThumbnailUrls.value = newUrls
  console.log('loadOnlineThumbnails: loaded', loadedCount)
}

async function loadOfflineThumbnailsForNodes(nodes, urlMap) {
  let loaded = 0
  let missing = 0
  for (const node of nodes || []) {
    if (isPage(node)) {
      const pageId = node.id || node.pageId
      if (pageId && !urlMap.has(pageId)) {
        const url = await getPageThumbnailUrl(pageId)
        if (url) {
          urlMap.set(pageId, url)
          loaded++
        } else {
          missing++
          console.log('No cached thumbnail for page:', pageId)
        }
      }
    }
    if (Array.isArray(node.children)) {
      const result = await loadOfflineThumbnailsForNodes(node.children, urlMap)
      loaded += result.loaded
      missing += result.missing
    }
  }
  return { loaded, missing }
}

// Load thumbnails when isOfflineBook changes or nodes update
watch(() => [props.isOfflineBook, props.nodes], () => {
  if (props.isOfflineBook) {
    console.log('Triggering offline thumbnail load, nodes count:', props.nodes?.length)
    thumbnailsLoaded.value = false
    loadOfflineThumbnails()
  } else {
    console.log('Triggering online thumbnail load, nodes count:', props.nodes?.length)
    loadOnlineThumbnails()
  }
}, { immediate: true, deep: true })

// Get offline thumbnail URL (synchronous lookup)
function getOfflineThumbnailUrl(pageId) {
  return offlineThumbnailUrls.value.get(pageId) || null
}

const emit = defineEmits(['open-page'])

const collapsedChapterIds = ref(new Set())

function isChapter(node) {
  return node && (node.type === 'chapter' || (Array.isArray(node.children) && node.children.length))
}

function isPage(node) {
  return node && node.type === 'page' && !Array.isArray(node.children)
}

function chapterKey(node) {
  return String(node.chapterId || node.id || '')
}

function isCollapsed(node) {
  const key = chapterKey(node)
  if (!key) return false
  return collapsedChapterIds.value.has(key)
}

function toggleChapter(node) {
  const key = chapterKey(node)
  if (!key) return
  const next = new Set(collapsedChapterIds.value)
  if (next.has(key)) {
    next.delete(key)
  } else {
    next.add(key)
  }
  collapsedChapterIds.value = next
}

watch(
  () => props.collapseAllVersion,
  () => {
    // When collapseAllVersion changes, either collapse all chapters or expand all
    if (props.collapseAllCollapsed) {
      const ids = new Set()
      function collectChapters(nodes) {
        if (!Array.isArray(nodes)) return
        for (const node of nodes) {
          if (!node) continue
          if (isChapter(node)) {
            const key = chapterKey(node)
            if (key) ids.add(key)
          }
          if (Array.isArray(node.children) && node.children.length) {
            collectChapters(node.children)
          }
        }
      }
      collectChapters(props.nodes)
      collapsedChapterIds.value = ids
    } else {
      collapsedChapterIds.value = new Set()
    }
  }
)

function handlePageClick(node) {
  emit('open-page', node)
}
</script>

<template>
  <ul v-if="nodes && nodes.length" class="space-y-1">
    <li
      v-for="node in nodes"
      :key="node.id || node.chapterId || node.pageId"
      class="space-y-1"
    >
      <!-- Chapter node -->
      <button
        v-if="isChapter(node)"
        type="button"
        class="flex w-full items-center gap-2 rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-left hover:border-sky-500"
        :style="{ marginLeft: depth * 16 + 'px' }"
        @click="toggleChapter(node)"
      >
        <span
          class="inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[10px] text-slate-600"
        >
          {{ isCollapsed(node) ? '+' : '−' }}
        </span>
        <div>
          <p class="text-[10px] font-medium uppercase tracking-wide text-slate-500">Chapter</p>
          <p class="text-xs font-semibold text-slate-900 truncate max-w-xs">
            {{ node.title || node.name || 'Chapter' }}
          </p>
        </div>
      </button>

      <!-- Page node -->
      <button
        v-else-if="isPage(node)"
        type="button"
        class="flex w-full items-center gap-2 rounded border px-2 py-1.5 text-left text-xs shadow-sm transition hover:border-sky-500 hover:shadow-md"
        :class="String(activePageId || '') === String(node.id || node.pageId)
          ? 'border-sky-500 bg-sky-50'
          : 'border-slate-200 bg-white'"
        :style="{ marginLeft: depth * 16 + 'px' }"
        @click="handlePageClick(node)"
      >
        <div class="h-10 w-14 flex items-center justify-center overflow-hidden rounded bg-slate-100">
          <!-- Online: load from API via blob -->
          <img
            v-if="!isOfflineBook && onlineThumbnailUrls.get(node.id || node.pageId)"
            :src="onlineThumbnailUrls.get(node.id || node.pageId)"
            alt=""
            class="h-full w-full object-contain"
            @load="console.log('Thumbnail loaded:', node.id || node.pageId)"
            @error="console.error('Thumbnail failed:', node.id || node.pageId); if($event.target) { $event.target.classList.add('hidden'); const next = $event.target.nextElementSibling; if(next) { next.classList.remove('hidden'); next.classList.add('flex'); } }"
          />
          <!-- Offline: use cached thumbnail if available -->
          <img
            v-else-if="offlineThumbnailUrls.get(node.id || node.pageId)"
            :src="offlineThumbnailUrls.get(node.id || node.pageId)"
            alt=""
            class="h-full w-full object-contain"
          />
          <!-- Fallback placeholder when offline but no cached thumbnail -->
          <div
            v-else
            class="h-full w-full flex items-center justify-center text-[10px] text-slate-400"
          >
            📄
          </div>
        </div>
        <div class="min-w-0">
          <p class="truncate text-xs font-semibold text-slate-900">
            {{ node.title || node.name || `Page ${node.pageNumber || ''}` }}
          </p>
          <p v-if="node.pageNumber" class="text-[10px] text-slate-500">
            Page {{ node.pageNumber }}
          </p>
        </div>
      </button>

      <!-- Children -->
      <TocTree
        v-if="Array.isArray(node.children) && node.children.length && !isCollapsed(node)"
        :nodes="node.children"
        :depth="depth + 1"
        :active-page-id="activePageId"
        :collapse-all-version="collapseAllVersion"
        :collapse-all-collapsed="collapseAllCollapsed"
        :is-offline-book="isOfflineBook"
        @open-page="(event) => $emit('open-page', event)"
      />
    </li>
  </ul>
</template>
