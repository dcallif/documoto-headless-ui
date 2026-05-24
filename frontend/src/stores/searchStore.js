import { ref } from 'vue'

// Simple singleton store to preserve search state across route navigations.
const query = ref('')
const results = ref([])
const error = ref('')

export function useSearchStore() {
  return {
    query,
    results,
    error,
  }
}
