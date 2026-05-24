<script setup>
import { ref, onMounted, watch, nextTick } from 'vue'
import * as pdfjsLib from 'pdfjs-dist'

// Set the worker source - use the ESM build
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.mjs`

const props = defineProps({
  url: {
    type: String,
    required: true
  }
})

const canvasRef = ref(null)
const loading = ref(true)
const error = ref('')
const currentPage = ref(1)
const totalPages = ref(0)
const scale = ref(1.0)

let pdfDoc = null

async function loadPdf() {
  if (!props.url) return
  
  loading.value = true
  error.value = ''
  
  try {
    // Load the PDF document first
    pdfDoc = await pdfjsLib.getDocument(props.url).promise
    totalPages.value = pdfDoc.numPages
    currentPage.value = 1
    
    // Wait for canvas to be available
    await nextTick()
    if (!canvasRef.value) {
      // If still no canvas, wait a bit more
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    
    // Now render if canvas is ready
    if (canvasRef.value) {
      await renderPage(currentPage.value)
    } else {
      console.error('Canvas still not available after wait')
      error.value = 'Failed to initialize PDF viewer'
    }
  } catch (err) {
    console.error('PDF load error:', err)
    error.value = 'Failed to load PDF'
  } finally {
    loading.value = false
  }
}

async function renderPage(pageNum) {
  if (!pdfDoc || !canvasRef.value) return
  
  try {
    const page = await pdfDoc.getPage(pageNum)
    const canvas = canvasRef.value
    const context = canvas.getContext('2d', { alpha: false })
    
    const viewport = page.getViewport({ scale: scale.value })
    
    // Set canvas dimensions
    canvas.height = viewport.height
    canvas.width = viewport.width
    
    // Clear canvas
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    
    const renderTask = page.render({
      canvasContext: context,
      viewport: viewport,
      background: 'white'
    })
    await renderTask.promise
  } catch (err) {
    console.error('PDF render error:', err)
    error.value = 'Failed to render page'
  }
}

function prevPage() {
  if (currentPage.value > 1) {
    currentPage.value--
    renderPage(currentPage.value)
  }
}

function nextPage() {
  if (currentPage.value < totalPages.value) {
    currentPage.value++
    renderPage(currentPage.value)
  }
}

function zoomIn() {
  scale.value = Math.min(scale.value + 0.25, 3.0)
  renderPage(currentPage.value)
}

function zoomOut() {
  scale.value = Math.max(scale.value - 0.25, 0.5)
  renderPage(currentPage.value)
}

onMounted(async () => {
  await nextTick()
  await loadPdf()
})

watch(() => props.url, async (newUrl, oldUrl) => {
  if (newUrl !== oldUrl) {
    // Reset and reload when URL changes
    pdfDoc = null
    currentPage.value = 1
    totalPages.value = 0
    scale.value = 1.0
    await nextTick()
    await loadPdf()
  }
})
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- Toolbar -->
    <div class="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2">
      <div class="flex items-center gap-3">
        <button
          type="button"
          class="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-40"
          :disabled="currentPage <= 1"
          @click="prevPage"
        >
          Prev
        </button>
        <span class="text-xs text-slate-600">
          Page {{ currentPage }} of {{ totalPages }}
        </span>
        <button
          type="button"
          class="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-40"
          :disabled="currentPage >= totalPages"
          @click="nextPage"
        >
          Next
        </button>
      </div>
      
      <div class="flex items-center gap-2">
        <span class="text-xs text-slate-600">Zoom</span>
        <button
          type="button"
          class="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
          @click="zoomOut"
        >
          -
        </button>
        <span class="w-12 text-center text-xs">{{ Math.round(scale * 100) }}%</span>
        <button
          type="button"
          class="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
          @click="zoomIn"
        >
          +
        </button>
      </div>
    </div>
    
    <!-- PDF Canvas -->
    <div class="flex-1 overflow-auto bg-slate-100 p-4 relative">
      <!-- Loading overlay -->
      <div v-if="loading" class="absolute inset-0 flex items-center justify-center bg-slate-100 z-10">
        <p class="text-sm text-slate-500">Loading PDF…</p>
      </div>
      <!-- Error overlay -->
      <div v-else-if="error" class="absolute inset-0 flex items-center justify-center bg-slate-100 z-10">
        <p class="text-sm text-red-600">{{ error }}</p>
      </div>
      <!-- Canvas always present in DOM -->
      <div class="flex justify-center min-h-full">
        <canvas
          ref="canvasRef"
          class="shadow-lg"
        />
      </div>
    </div>
  </div>
</template>
