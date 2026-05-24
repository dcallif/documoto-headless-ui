<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { getBrowseFlows, getBrowseFlowResults, getMediaThumbnail, getBrowseFlowThumbnail, getBrowseFlowItemThumbnail } from '../api/documoto'

const router = useRouter()
const flows = ref([])
const loading = ref(false)
const error = ref('')
const selectedFlow = ref(null)
const flowResults = ref([])
const resultsLoading = ref(false)
const flowHistory = ref([]) // Track navigation history for back button
const thumbnailUrls = ref(new Map()) // Store blob URLs for thumbnails

onMounted(async () => {
  await loadBrowseFlows()

  // Reload browse flows when settings change (e.g., profile switched)
  window.addEventListener('settings-changed', async () => {
    await loadBrowseFlows()
  })
})

async function loadBrowseFlows() {
  loading.value = true
  error.value = ''
  try {
    const data = await getBrowseFlows()
    // Handle root flow or array of flows
    if (data.taxonomy) {
      flows.value = [data]
    } else if (Array.isArray(data)) {
      flows.value = data
    } else {
      flows.value = []
    }
  } catch (e) {
    console.error(e)
    error.value = e.message
  } finally {
    loading.value = false
  }
}

async function selectFlow(flow) {
  // Push current selection to history before navigating to new one
  if (selectedFlow.value) {
    flowHistory.value.push(selectedFlow.value)
  }
  selectedFlow.value = flow
  flowResults.value = [] // Clear previous results
  // If this flow has a resultsUrl, load results
  if (flow.taxonomy?.resultsUrl || flow.resultsUrl) {
    await loadFlowResults(flow.id)
  }
}

function goBack() {
  if (flowHistory.value.length > 0) {
    selectedFlow.value = flowHistory.value.pop()
    flowResults.value = [] // Clear results when going back
  } else {
    // At root level, clear selection
    selectedFlow.value = null
    flowResults.value = []
  }
}

async function loadFlowResults(flowId) {
  resultsLoading.value = true
  try {
    const data = await getBrowseFlowResults(flowId)
    flowResults.value = Array.isArray(data.items) ? data.items : []
  } catch (e) {
    console.error(e)
    flowResults.value = []
  } finally {
    resultsLoading.value = false
  }
}

function openMedia(item) {
  const id = item.entityId || item.id
  if (!id) return
  router.push({ name: 'book', params: { mediaId: id } })
}

function hasChildren(flow) {
  const taxonomy = flow.taxonomy || flow
  return taxonomy.children && taxonomy.children.length > 0
}

function getChildren(flow) {
  const taxonomy = flow.taxonomy || flow
  return taxonomy.children || []
}

function getFlowName(flow) {
  const taxonomy = flow.taxonomy || flow
  return taxonomy.name || flow.name || `Flow ${flow.id}`
}

function getFlowDescription(flow) {
  const taxonomy = flow.taxonomy || flow
  return taxonomy.description || flow.description || ''
}

async function loadThumbnail(id, type = 'media') {
  if (thumbnailUrls.value.has(id)) {
    return thumbnailUrls.value.get(id)
  }

  try {
    console.log('Loading thumbnail for:', id, 'type:', type)
    let blob
    if (type === 'flow') {
      blob = await getBrowseFlowThumbnail(id)
    } else if (type === 'flow-item') {
      blob = await getBrowseFlowItemThumbnail(id)
    } else {
      blob = await getMediaThumbnail(id)
    }
    console.log('Got blob for:', id, 'size:', blob.size, 'type:', blob.type)
    const url = URL.createObjectURL(blob)
    console.log('Created object URL for:', id, url)
    thumbnailUrls.value.set(id, url)
    return url
  } catch (e) {
    console.error('Failed to load thumbnail:', id, e)
    return null
  }
}

function getFlowThumbnail(flow) {
  const taxonomy = flow.taxonomy || flow
  if (taxonomy.thumbnailUrl) {
    const flowId = flow.id || taxonomy.id
    if (flowId && !thumbnailUrls.value.has(flowId)) {
      loadThumbnail(flowId, 'flow')
    }
    return thumbnailUrls.value.get(flowId) || null
  }
  return null
}

function getChildThumbnailUrl(child) {
  if (child.thumbnailUrl && child.id) {
    if (!thumbnailUrls.value.has(child.id)) {
      loadThumbnail(child.id, 'flow-item')
    }
    return thumbnailUrls.value.get(child.id) || null
  }
  return null
}

function handleImageError(event) {
  if (event.target) {
    event.target.style.display = 'none'
  }
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <h2 class="text-xl font-semibold text-slate-800">Browse by Category</h2>
      <button
        v-if="selectedFlow"
        type="button"
        class="text-sm text-sky-600 hover:underline"
        @click="goBack"
      >
        ← Back{{ flowHistory.length > 0 ? '' : ' to categories' }}
      </button>
    </div>

    <p v-if="loading" class="text-sm text-slate-500">Loading categories...</p>
    <p v-if="error" class="text-sm text-red-600">{{ error }}</p>

    <!-- Flow Tree View -->
    <div v-if="!selectedFlow && flows.length" class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <div
        v-for="flow in flows"
        :key="flow.id"
        class="cursor-pointer rounded border border-slate-200 bg-white p-4 shadow-sm hover:border-sky-400 hover:shadow-md transition-all"
        @click="selectFlow(flow)"
      >
        <div class="flex items-start gap-4">
          <div v-if="getFlowThumbnail(flow)" class="h-16 w-16 flex-shrink-0 overflow-hidden rounded bg-slate-100">
            <img
              :src="getFlowThumbnail(flow)"
              alt=""
              class="h-full w-full object-contain"
              @error="handleImageError"
            />
          </div>
          <div v-else class="h-16 w-16 flex-shrink-0 rounded bg-sky-100 flex items-center justify-center text-sky-600">
            <svg class="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
          </div>
          <div class="min-w-0 flex-1">
            <h3 class="truncate text-base font-medium text-slate-800">{{ getFlowName(flow) }}</h3>
            <p v-if="getFlowDescription(flow)" class="mt-1 line-clamp-2 text-sm text-slate-500">
              {{ getFlowDescription(flow) }}
            </p>
            <p v-if="hasChildren(flow)" class="mt-1 text-xs text-sky-600">
              {{ getChildren(flow).length }} subcategories
            </p>
          </div>
        </div>
      </div>
    </div>

    <!-- Selected Flow Children -->
    <div v-if="selectedFlow && hasChildren(selectedFlow) && !flowResults.length" class="space-y-4">
      <h3 class="font-medium text-slate-700 text-lg">{{ getFlowName(selectedFlow) }} Subcategories</h3>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div
          v-for="child in getChildren(selectedFlow)"
          :key="child.id"
          class="cursor-pointer rounded border border-slate-200 bg-white p-4 shadow-sm hover:border-sky-400 hover:shadow-md transition-all"
          @click="selectFlow(child)"
        >
          <div class="flex items-start gap-4">
            <div v-if="getChildThumbnailUrl(child)" class="h-14 w-14 flex-shrink-0 overflow-hidden rounded bg-slate-100">
              <img
                :src="getChildThumbnailUrl(child)"
                alt=""
                class="h-full w-full object-contain"
                @error="handleImageError"
              />
            </div>
            <div v-else class="h-14 w-14 flex-shrink-0 rounded bg-sky-50 flex items-center justify-center text-sky-500">
              <svg class="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
              </svg>
            </div>
            <div class="min-w-0 flex-1">
              <h4 class="truncate text-base font-medium text-slate-800">{{ child.name || `Category ${child.id}` }}</h4>
              <p v-if="child.description" class="mt-1 line-clamp-2 text-xs text-slate-500">
                {{ child.description }}
              </p>
              <p v-if="child.children?.length" class="mt-1 text-[10px] text-sky-600">
                {{ child.children.length }} more
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Flow Results -->
    <div v-if="flowResults.length || resultsLoading" class="space-y-4">
      <h3 class="font-medium text-slate-700 text-lg">Books in {{ getFlowName(selectedFlow) }}</h3>
      <p v-if="resultsLoading" class="text-sm text-slate-500">Loading books...</p>
      <div v-if="flowResults.length" class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <article
          v-for="item in flowResults"
          :key="item.entityId || item.id"
          @click="openMedia(item)"
          class="cursor-pointer rounded border border-slate-200 bg-white p-4 shadow-sm hover:border-sky-400 hover:shadow-md transition-all"
        >
          <div class="flex items-start gap-4">
            <div class="h-16 w-24 flex-shrink-0 overflow-hidden rounded bg-slate-100">
              <img
                v-if="item.thumbnailUrl"
                :src="item.thumbnailUrl"
                alt=""
                class="h-full w-full object-contain"
                @error="handleImageError"
              />
              <div v-else class="h-full w-full flex items-center justify-center text-slate-400">
                <svg class="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
              </div>
            </div>
            <div class="min-w-0 flex-1">
              <h4 class="truncate font-medium text-slate-800">{{ item.name || item.identifier || `Book ${item.entityId}` }}</h4>
              <p v-if="item.description" class="mt-1 line-clamp-2 text-sm text-slate-600">
                {{ item.description }}
              </p>
              <p class="mt-1 text-xs text-slate-500">
                ID: {{ item.entityId || item.id }}
              </p>
            </div>
          </div>
        </article>
      </div>
      <p v-if="!resultsLoading && !flowResults.length && selectedFlow" class="text-sm text-slate-500">
        No books found in this category.
      </p>
    </div>
  </div>
</template>
