<template>
  <div class="min-h-screen bg-slate-50 text-slate-900">
    <header class="border-b bg-white">
      <div class="mx-auto max-w-7xl px-4 py-3 flex items-center justify-between">
        <button
          type="button"
          class="text-2xl hover:text-sky-600"
          @click="goHome"
        >
          🏠
        </button>
        <div class="flex items-center gap-3">
          <EnvironmentCard />
          <router-link to="/settings" class="text-xl hover:text-sky-600">
            ⚙️
          </router-link>
          <button
            type="button"
            class="inline-flex items-center gap-1 rounded-full border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
            @click="goToCart"
          >
            <span>🛒</span>
            <span v-if="cartItemCount > 0">{{ cartItemCount }} item{{ cartItemCount === 1 ? '' : 's' }}</span>
            <span v-else>Cart</span>
          </button>
        </div>
      </div>
    </header>
    <main class="mx-auto max-w-7xl px-4 py-6">
      <router-view />
    </main>
    <footer class="border-t bg-white">
      <div class="mx-auto max-w-7xl px-4 py-4">
        <a
          href="https://documenter.getpostman.com/view/34649711/2sA3JJAPP7"
          target="_blank"
          rel="noopener noreferrer"
          class="text-xs text-slate-500 hover:text-sky-600"
        >
          Powered By Documoto Headless APIs
        </a>
      </div>
    </footer>
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router'
import { useCartStore } from './stores/cartStore'
import { useSearchStore } from './stores/searchStore'
import EnvironmentCard from './components/EnvironmentCard.vue'

const router = useRouter()
const { itemCount: cartItemCount } = useCartStore()
const { query, results, error } = useSearchStore()

function goToCart() {
  router.push({ name: 'cart' })
}

function goHome() {
  // Clear search state
  query.value = ''
  results.value = []
  error.value = ''
  // Navigate to search page
  router.push({ name: 'search' })
}
</script>