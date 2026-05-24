<template>
  <div class="inline-flex items-center gap-2 bg-white rounded-lg shadow-sm border border-slate-200 px-3 py-2">
    <div class="flex items-center gap-2">
      <span 
        class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
        :class="environmentBadgeClass"
      >
        {{ environmentLabel }}
      </span>
      <span v-if="tenantKey" class="text-xs text-slate-600">
        {{ tenantKey }}
      </span>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { getApiUrl } from '../config'

const route = useRoute()

const environment = ref('integration')
const tenantKey = ref('')

// Check if running in browser (not Capacitor)
// More reliable check: verify we're actually in a native Capacitor context
const isBrowser = !(window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform() !== 'web')

const environmentLabel = computed(() => {
  return environment.value === 'production' ? 'Production' : 'Integration'
})

const environmentBadgeClass = computed(() => {
  return environment.value === 'production'
    ? 'bg-purple-100 text-purple-800'
    : 'bg-blue-100 text-blue-800'
})

async function loadSettings() {
  if (isBrowser) {
    // Load from backend API (browser mode)
    try {
      const res = await fetch(getApiUrl('/api/settings'))
      if (res.ok) {
        const data = await res.json()
        const activeProfile = data.profiles?.find(p => p.id === data.activeProfileId)
        if (activeProfile) {
          environment.value = activeProfile.environment
          tenantKey.value = activeProfile.tenantKey
        }
      }
    } catch (e) {
      console.error('Failed to load settings:', e)
    }
  } else {
    // Load from localStorage (standalone mode)
    environment.value = localStorage.getItem('environment') || 'integration'
    tenantKey.value = localStorage.getItem('tenantKey') || ''

    // Load profiles from localStorage to get active profile
    try {
      const profilesJson = localStorage.getItem('profiles')
      const activeProfileId = localStorage.getItem('activeProfileId') || ''
      
      if (profilesJson && activeProfileId) {
        const profiles = JSON.parse(profilesJson)
        const activeProfile = profiles.find(p => p.id === activeProfileId)
        if (activeProfile) {
          environment.value = activeProfile.environment
          tenantKey.value = activeProfile.tenantKey
        }
      }
    } catch (e) {
      console.error('Failed to load settings:', e)
    }
  }
}

onMounted(() => {
  loadSettings()
})

// Reload settings when route changes (e.g., coming back from Settings page)
watch(() => route.path, () => {
  loadSettings()
})

// Reload settings when localStorage changes (e.g., after saving in Settings)
window.addEventListener('storage', () => {
  loadSettings()
})

// Reload settings when settings are saved (custom event from SettingsView)
window.addEventListener('settings-changed', () => {
  loadSettings()
})
</script>
