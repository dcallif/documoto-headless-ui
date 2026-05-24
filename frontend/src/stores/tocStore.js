import { reactive } from 'vue'

// Simple in-memory TOC cache keyed by mediaId.
// Shape: { [mediaId: string]: { tableOfContents: any[] } }
const state = reactive({
  byMediaId: {},
})

export function useTocStore() {
  function setToc(mediaId, tocPayload) {
    if (!mediaId || !tocPayload) return
    state.byMediaId[String(mediaId)] = tocPayload
  }

  function getToc(mediaId) {
    if (!mediaId) return null
    return state.byMediaId[String(mediaId)] || null
  }

  return {
    state,
    setToc,
    getToc,
  }
}
