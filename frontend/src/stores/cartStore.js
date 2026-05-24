import { reactive, computed } from 'vue'

// Simple shopping cart shared across pages.
// Items are keyed so we can add/remove parts from different BOMs.
// Cart contents are also persisted in localStorage so they survive reloads.

const STORAGE_KEY = 'documoto-cart-v1'

function loadInitialCart() {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (e) {
    console.warn('Failed to load cart from storage', e)
    return {}
  }
}

function saveCart(itemsByKey) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(itemsByKey || {}))
  } catch (e) {
    console.warn('Failed to save cart to storage', e)
  }
}

const state = reactive({
  itemsByKey: loadInitialCart(),
})

export function useCartStore() {
  function addItem(key, item) {
    if (!key || !item) return
    state.itemsByKey[key] = item
    saveCart(state.itemsByKey)
  }

  function removeItem(key) {
    if (!key) return
    delete state.itemsByKey[key]
    saveCart(state.itemsByKey)
  }

  function isInCart(key) {
    if (!key) return false
    return Boolean(state.itemsByKey[key])
  }

  const items = computed(() => Object.values(state.itemsByKey))
  const itemCount = computed(() => items.value.length)

  return {
    state,
    items,
    itemCount,
    addItem,
    removeItem,
    isInCart,
  }
}
