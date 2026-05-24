<template>
  <div class="max-w-3xl mx-auto p-4">
    <h1 class="text-2xl font-bold mb-6">Settings</h1>

    <!-- Profiles List -->
    <div class="bg-white rounded-lg shadow-sm border border-slate-200 p-4 mb-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-semibold">Configuration Profiles</h2>
        <button
          @click="addProfile"
          class="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700"
        >
          Add Profile
        </button>
      </div>

      <div class="space-y-3">
        <div
          v-for="profile in profiles"
          :key="profile.id"
          :class="['border rounded-lg p-4', profile.id === activeProfileId ? 'border-blue-500 bg-blue-50' : 'border-slate-200']"
        >
          <div class="flex flex-col gap-3 mb-3">
            <div class="flex flex-col gap-2">
              <input
                v-model="profile.name"
                type="text"
                placeholder="Profile name"
                class="w-full px-2 py-1.5 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div class="flex items-center gap-2 flex-wrap">
                <span
                  :class="['inline-flex items-center px-2 py-0.5 rounded text-xs font-medium', profile.environment === 'production' ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800']"
                >
                  {{ profile.environment === 'production' ? 'Production' : 'Integration' }}
                </span>
                <span v-if="profile.tenantKey" class="text-xs text-slate-600 truncate">
                  {{ profile.tenantKey }}
                </span>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <button
                @click="setActiveProfile(profile.id)"
                :class="['px-3 py-1.5 text-sm rounded flex-1', profile.id === activeProfileId ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700 hover:bg-slate-300']"
              >
                {{ profile.id === activeProfileId ? 'Active' : 'Activate' }}
              </button>
              <button
                @click="deleteProfile(profile.id)"
                :disabled="profiles.length <= 1"
                class="px-3 py-1.5 text-sm rounded bg-red-100 text-red-700 hover:bg-red-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Delete
              </button>
            </div>
          </div>

          <div class="grid grid-cols-1 gap-3">
            <div>
              <label class="block text-xs font-medium text-slate-700 mb-1">Environment</label>
              <select
                v-model="profile.environment"
                class="w-full px-2 py-1.5 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="integration">Integration</option>
                <option value="production">Production</option>
              </select>
            </div>
            <div>
              <label class="block text-xs font-medium text-slate-700 mb-1">Tenant Key</label>
              <input
                v-model="profile.tenantKey"
                type="text"
                placeholder="Enter tenant key"
                class="w-full px-2 py-1.5 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div class="mt-3">
            <label class="block text-xs font-medium text-slate-700 mb-1">API Key</label>
            <input
              v-model="profile.apiKey"
              type="password"
              placeholder="Enter API key"
              class="w-full px-2 py-1.5 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p class="text-xs text-slate-500 mt-1">API key is stored locally on your device.</p>
          </div>
        </div>
      </div>

      <!-- Save Button -->
      <div class="flex justify-end mt-4">
        <button
          @click="saveSettings"
          :disabled="saving"
          class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {{ saving ? 'Saving...' : 'Save Settings' }}
        </button>
      </div>

      <!-- Status Message -->
      <div v-if="statusMessage" :class="['text-sm mt-3', statusType === 'error' ? 'text-red-600' : 'text-green-600']">
        {{ statusMessage }}
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { getApiUrl } from '../config'

const profiles = ref([])
const activeProfileId = ref('')

const saving = ref(false)
const statusMessage = ref('')
const statusType = ref('success')

// Check if running in browser (not Capacitor)
// More reliable check: verify we're actually in a native Capacitor context
const isBrowser = !(window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform() !== 'web')

onMounted(async () => {
  if (isBrowser) {
    // Load settings from backend API (browser mode)
    try {
      console.log('Loading settings from backend API...')
      const res = await fetch(getApiUrl('/api/settings'))
      console.log('Response status:', res.status)
      if (res.ok) {
        const data = await res.json()
        console.log('Settings data received:', JSON.stringify(data, null, 2))
        profiles.value = data.profiles || []
        activeProfileId.value = data.activeProfileId || ''
        console.log('Profiles set:', profiles.value.length)
      } else {
        console.error('Failed to load settings from backend')
      }
    } catch (e) {
      console.error('Failed to load settings:', e)
    }
  } else {
    // Load settings from localStorage (standalone mode)
    try {
      const profilesJson = localStorage.getItem('profiles')
      const activeProfileIdStored = localStorage.getItem('activeProfileId')
      
      if (profilesJson) {
        profiles.value = JSON.parse(profilesJson)
      } else {
        // Create default profile if none exist
        profiles.value = [{
          id: 'default',
          name: 'Default',
          environment: 'integration',
          tenantKey: '',
          apiKey: ''
        }]
        // Save to localStorage
        localStorage.setItem('profiles', JSON.stringify(profiles.value))
      }
      
      if (activeProfileIdStored) {
        activeProfileId.value = activeProfileIdStored
      } else if (profiles.value.length > 0) {
        activeProfileId.value = profiles.value[0].id
        localStorage.setItem('activeProfileId', activeProfileId.value)
      }
    } catch (e) {
      console.error('Failed to load settings:', e)
    }
  }
})

function addProfile() {
  const newId = `profile-${Date.now()}`
  const activeProfile = profiles.value.find(p => p.id === activeProfileId.value)
  profiles.value.push({
    id: newId,
    name: `Profile ${profiles.value.length + 1}`,
    environment: activeProfile?.environment || 'integration',
    tenantKey: activeProfile?.tenantKey || '',
    apiKey: activeProfile?.apiKey || '' // Copy API key from active profile
  })
}

function deleteProfile(id) {
  if (profiles.value.length <= 1) return
  profiles.value = profiles.value.filter(p => p.id !== id)
  if (activeProfileId.value === id) {
    activeProfileId.value = profiles.value[0].id
  }
}

async function setActiveProfile(id) {
  activeProfileId.value = id
  // Immediately save to backend and localStorage
  await saveSettings()
}

async function saveSettings() {
  saving.value = true
  statusMessage.value = ''

  try {
    if (isBrowser) {
      // Save to backend API (browser mode)
      const res = await fetch(getApiUrl('/api/settings'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profiles: profiles.value,
          activeProfileId: activeProfileId.value
        })
      })
      
      if (!res.ok) {
        throw new Error('Failed to save settings to backend')
      }
    } else {
      // Save to localStorage (standalone mode)
      localStorage.setItem('profiles', JSON.stringify(profiles.value))
      localStorage.setItem('activeProfileId', activeProfileId.value)
      
      // Store active profile details for easy access
      const activeProfile = profiles.value.find(p => p.id === activeProfileId.value)
      if (activeProfile) {
        localStorage.setItem('environment', activeProfile.environment)
        localStorage.setItem('tenantKey', activeProfile.tenantKey)
        localStorage.setItem('currentProfileName', activeProfile.name)
      }
    }
    
    // Emit event to notify EnvironmentCard to reload
    window.dispatchEvent(new CustomEvent('settings-changed'))
    
    statusMessage.value = 'Settings saved successfully!'
    statusType.value = 'success'
  } catch (e) {
    console.error('Failed to save settings:', e)
    statusMessage.value = 'Failed to save settings. Please try again.'
    statusType.value = 'error'
  } finally {
    saving.value = false
  }
}
</script>
