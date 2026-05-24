<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useCartStore } from '../stores/cartStore'
import { Filesystem } from '@capacitor/filesystem'

const router = useRouter()
const { items, itemCount, removeItem, state } = useCartStore()

const hasItems = computed(() => itemCount.value > 0)

function goBack() {
  router.back()
}

function updateQuantity(item, event) {
  const value = Number(event.target.value)
  if (!Number.isFinite(value) || value <= 0) return
  const existing = state.itemsByKey[item.key]
  if (!existing) return
  state.itemsByKey[item.key] = {
    ...existing,
    quantity: value,
  }
}

function remove(item) {
  removeItem(item.key)
}

function goToPageFromCart(item) {
  if (!item.pageId) return
  const query = {}
  if (item.mediaId) query.mediaId = item.mediaId
  if (item.mediaName) query.mediaName = item.mediaName
  router.push({ name: 'page', params: { pageId: item.pageId }, query })
}

function goToBookFromCart(item) {
  if (!item.mediaId) return
  router.push({ name: 'book', params: { mediaId: item.mediaId } })
}

function buildCartCsv(lines) {
  const rows = []
  rows.push(['Part Number', 'Name', 'Qty', 'UOM', 'Page', 'Book'])

  for (const item of lines) {
    if (!item) continue
    const partNumber = item.visible === false ? '' : (item.partNumber || item.partId || '')
    const name = item.name || ''
    const qty = item.quantity ?? ''
    const uom = item.unitOfMeasure || ''
    const page = item.pageName || item.pageId || ''
    const book = item.mediaName || item.mediaId || ''

    const cols = [partNumber, name, qty, uom, page, book].map((value) => {
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

async function exportCartAsCsv() {
  const lines = items.value || []
  if (!lines.length) return
  const csv = buildCartCsv(lines)
  const filename = 'cart.csv'
  await downloadTextFile(filename, 'text/csv;charset=utf-8;', csv)
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between gap-4">
      <div class="flex items-center gap-2">
        <button class="text-sm text-sky-600 hover:underline" @click="goBack">Back</button>
        <h1 class="text-lg font-semibold">Cart</h1>
      </div>
      <div v-if="hasItems" class="flex items-center gap-3 text-xs text-slate-500">
        <span>{{ itemCount }} item{{ itemCount === 1 ? '' : 's' }}</span>
        <button
          type="button"
          class="rounded border border-slate-300 px-2 py-0.5 text-[11px] text-slate-700 hover:bg-slate-50"
          @click="exportCartAsCsv"
        >
          Export CSV
        </button>
      </div>
    </div>

    <div v-if="!hasItems" class="rounded border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
      Your cart is empty. Go to a page and click the 🛒 icon next to a part to add it to your cart.
    </div>

    <div v-else class="overflow-x-auto rounded border border-slate-200 bg-white">
      <table class="min-w-full text-sm">
        <thead class="bg-slate-100">
          <tr>
            <th class="px-2 py-1 text-left font-medium">Part Number</th>
            <th class="px-2 py-1 text-left font-medium">Name</th>
            <th class="px-2 py-1 text-left font-medium">Qty</th>
            <th class="px-2 py-1 text-left font-medium">UOM</th>
            <th class="px-2 py-1 text-left font-medium">Page</th>
            <th class="px-2 py-1 text-left font-medium">Book</th>
            <th class="px-2 py-1 text-left font-medium"></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="item in items"
            :key="item.key"
            class="border-t"
          >
            <td class="px-2 py-1 font-mono text-xs">{{ item.visible === false ? '' : (item.partNumber || item.partId) }}</td>
            <td class="px-2 py-1">{{ item.name }}</td>
            <td class="px-2 py-1">
              <input
                :value="item.quantity"
                type="number"
                min="1"
                class="w-20 rounded border border-slate-300 px-2 py-1 text-xs"
                @change="updateQuantity(item, $event)"
              />
            </td>
            <td class="px-2 py-1 text-xs text-slate-500">{{ item.unitOfMeasure }}</td>
            <td class="px-2 py-1 text-xs text-slate-500">
              <button
                v-if="item.pageId"
                type="button"
                class="underline-offset-2 hover:underline text-sky-700"
                @click="goToPageFromCart(item)"
              >
                {{ item.pageName || item.pageId }}
              </button>
              <span v-else>{{ item.pageName || item.pageId }}</span>
            </td>
            <td class="px-2 py-1 text-xs text-slate-500">
              <button
                v-if="item.mediaId"
                type="button"
                class="underline-offset-2 hover:underline text-sky-700"
                @click="goToBookFromCart(item)"
              >
                {{ item.mediaName || item.mediaId }}
              </button>
              <span v-else>{{ item.mediaName || item.mediaId }}</span>
            </td>
            <td class="px-2 py-1 text-right">
              <button
                type="button"
                class="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50"
                @click="remove(item)"
              >
                Remove
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
