<script setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useSearchStore } from '../stores/searchStore'
import { getCachedBooks } from '../offline/offlineStore'
import { searchMedia } from '../api/documoto'
import BrowseFlows from '../components/BrowseFlows.vue'

const router = useRouter()
const { query, results, error } = useSearchStore()
const loading = ref(false)
const cachedBooks = ref([])

async function search() {
  if (!query.value.trim()) return
  loading.value = true
  error.value = ''
  results.value = []

  try {
    const data = await searchMedia(query.value.trim())
    // TODO: adjust this once you see real search response shape
    results.value = Array.isArray(data.items || data.results || data)
      ? (data.items || data.results || data)
      : []
  } catch (e) {
    console.error(e)
    error.value = e.message
  } finally {
    loading.value = false
  }
}

function openMedia(media) {
  console.log('Clicked media', media)
  const id = media.id || media.mediaId || media.mediaID || media.entityId
  console.log('Resolved id', id)
  if (!id) return
  router.push({ name: 'book', params: { mediaId: id } })
}

onMounted(async () => {
  try {
    cachedBooks.value = await getCachedBooks()
  } catch (e) {
    console.error('Failed to load cached books', e)
  }
})
</script>

<template>
  <div class="space-y-4">
    <div>
      <label class="block text-sm font-medium text-slate-700 mb-1">Search media</label>
      <div class="flex gap-2">
        <input
          v-model="query"
          @keyup.enter="search"
          class="flex-1 rounded border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:ring-sky-500"
          placeholder="Enter media identifier, title, serial number, etc."
        />
        <button
          @click="search"
          class="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
          :disabled="loading"
        >
          {{ loading ? 'Searching…' : 'Search' }}
        </button>
      </div>
      <p v-if="error" class="mt-2 text-sm text-red-600">{{ error }}</p>
    </div>

    <div v-if="results.length" class="grid gap-3 md:grid-cols-2">
      <article
        v-for="media in results"
        :key="media.id || media.mediaId"
        @click="openMedia(media)"
        class="cursor-pointer rounded border border-slate-200 bg-white p-3 shadow-sm hover:border-sky-500"
      >
        <h2 class="text-sm font-semibold">
          {{ media.title || media.name || media.mediaNumber }}
        </h2>
        <p class="mt-1 text-xs text-slate-500">
          {{ media.description || media.mediaType }}
        </p>
      </article>
    </div>

    <div v-if="cachedBooks.length" class="mt-6 space-y-2">
      <h2 class="text-sm font-semibold text-slate-700">Offline books</h2>
      <div class="grid gap-3 md:grid-cols-2">
        <article
          v-for="book in cachedBooks"
          :key="book.mediaId"
          @click="openMedia(book)"
          class="cursor-pointer rounded border border-emerald-200 bg-emerald-50 p-3 text-sm shadow-sm hover:border-emerald-400"
        >
          <h3 class="font-semibold text-emerald-800">
            {{ book.name }}
          </h3>
          <p v-if="book.description" class="mt-1 text-xs text-emerald-900/80">
            {{ book.description }}
          </p>
          <p class="mt-1 text-[11px] text-emerald-700">
            Cached offline
          </p>
          <div v-if="book.tenantKey || book.environment" class="mt-1 flex gap-2">
            <span v-if="book.environment" class="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800">
              {{ book.environment }}
            </span>
            <span v-if="book.tenantKey" class="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800">
              {{ book.tenantKey }}
            </span>
          </div>
        </article>
      </div>
    </div>

    <!-- Browse Flows Section -->
    <div class="mt-8 border-t border-slate-200 pt-6">
      <BrowseFlows />
    </div>

    <p v-if="!results.length && !loading && !cachedBooks.length" class="text-sm text-slate-500">
      Enter a query and press Search to find media, or browse categories above.
    </p>
  </div>
</template>