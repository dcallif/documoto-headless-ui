// Simple IndexedDB-based offline cache for page details and illustrations.
// This is intentionally minimal and synchronous usage is wrapped in Promises.

const DB_NAME = 'documoto-offline'
const DB_VERSION = 3
const PAGES_STORE = 'pages'
const ILLUSTRATIONS_STORE = 'illustrations'
const BOOKS_STORE = 'books'
const THUMBNAILS_STORE = 'thumbnails'

let dbPromise = null

function openDb() {
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = (event) => {
      const db = event.target.result
      if (!db.objectStoreNames.contains(PAGES_STORE)) {
        db.createObjectStore(PAGES_STORE, { keyPath: 'pageId' })
      }
      if (!db.objectStoreNames.contains(ILLUSTRATIONS_STORE)) {
        db.createObjectStore(ILLUSTRATIONS_STORE, { keyPath: 'pageId' })
      }
      if (!db.objectStoreNames.contains(BOOKS_STORE)) {
        db.createObjectStore(BOOKS_STORE, { keyPath: 'mediaId' })
      }
      if (!db.objectStoreNames.contains(THUMBNAILS_STORE)) {
        db.createObjectStore(THUMBNAILS_STORE, { keyPath: 'partId' })
      }
    }

    request.onsuccess = () => {
      resolve(request.result)
    }

    request.onerror = () => {
      console.error('Failed to open offline DB', request.error)
      reject(request.error)
    }
  })

  return dbPromise
}

export async function savePageDetails(mediaId, pageId, payload, options = {}) {
  try {
    const db = await openDb()
    const tx = db.transaction(PAGES_STORE, 'readwrite')
    const store = tx.objectStore(PAGES_STORE)
    const record = {
      mediaId: String(mediaId || ''),
      pageId: String(pageId),
      payload,
      preload: options.preload === true,
    }
    store.put(record)
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } catch (e) {
    console.error('savePageDetails failed', e)
  }
}

async function getPageRecord(pageId) {
  try {
    const db = await openDb()
    const tx = db.transaction(PAGES_STORE, 'readonly')
    const store = tx.objectStore(PAGES_STORE)
    const req = store.get(String(pageId))
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result || null)
      req.onerror = () => reject(req.error)
    })
  } catch (e) {
    console.error('getPageRecord failed', e)
    return null
  }
}

export async function getPageDetails(pageId) {
  const record = await getPageRecord(pageId)
  return record ? record.payload : null
}

export async function isPageCached(pageId) {
  const record = await getPageRecord(pageId)
  return !!record
}

export async function isPagePreloaded(pageId) {
  const record = await getPageRecord(pageId)
  return !!(record && record.preload)
}

export async function saveIllustrationBlob(pageId, blob) {
  try {
    const db = await openDb()
    const tx = db.transaction(ILLUSTRATIONS_STORE, 'readwrite')
    const store = tx.objectStore(ILLUSTRATIONS_STORE)
    const record = { pageId: String(pageId), blob }
    store.put(record)
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } catch (e) {
    console.error('saveIllustrationBlob failed', e)
  }
}

const illustrationUrlCache = new Map()

export async function getIllustrationUrl(pageId) {
  const key = String(pageId)
  if (illustrationUrlCache.has(key)) {
    return illustrationUrlCache.get(key)
  }

  try {
    const db = await openDb()
    const tx = db.transaction(ILLUSTRATIONS_STORE, 'readonly')
    const store = tx.objectStore(ILLUSTRATIONS_STORE)
    const req = store.get(key)
    const record = await new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result || null)
      req.onerror = () => reject(req.error)
    })
    if (!record || !record.blob) return null

    const url = URL.createObjectURL(record.blob)
    illustrationUrlCache.set(key, url)
    return url
  } catch (e) {
    console.error('getIllustrationUrl failed', e)
    return null
  }
}

const thumbnailUrlCache = new Map()

export async function saveThumbnailBlob(partId, blob) {
  try {
    const db = await openDb()
    const tx = db.transaction(THUMBNAILS_STORE, 'readwrite')
    const store = tx.objectStore(THUMBNAILS_STORE)
    const record = { partId: String(partId), blob }
    store.put(record)
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } catch (e) {
    console.error('saveThumbnailBlob failed', e)
  }
}

export async function getThumbnailUrl(partId) {
  const key = String(partId)
  if (thumbnailUrlCache.has(key)) {
    return thumbnailUrlCache.get(key)
  }

  try {
    const db = await openDb()
    const tx = db.transaction(THUMBNAILS_STORE, 'readonly')
    const store = tx.objectStore(THUMBNAILS_STORE)
    const req = store.get(key)
    const record = await new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result || null)
      req.onerror = () => reject(req.error)
    })
    if (!record || !record.blob) return null

    const url = URL.createObjectURL(record.blob)
    thumbnailUrlCache.set(key, url)
    return url
  } catch (e) {
    console.error('getThumbnailUrl failed', e)
    return null
  }
}

// Aliases for page thumbnails (reuses the same thumbnails store)
export async function savePageThumbnailBlob(pageId, blob) {
  return saveThumbnailBlob(pageId, blob)
}

export async function getPageThumbnailUrl(pageId) {
  return getThumbnailUrl(pageId)
}

// Media thumbnail helpers (reuses the same thumbnails store with media- prefix)
export async function saveMediaThumbnailBlob(mediaId, blob) {
  return saveThumbnailBlob(`media-${mediaId}`, blob)
}

export async function getMediaThumbnailUrl(mediaId) {
  return getThumbnailUrl(`media-${mediaId}`)
}

export async function clearBookForMedia(mediaId) {
  try {
    const db = await openDb()
    const pagesTx = db.transaction([PAGES_STORE, ILLUSTRATIONS_STORE, BOOKS_STORE], 'readwrite')
    const pagesStore = pagesTx.objectStore(PAGES_STORE)
    const illuStore = pagesTx.objectStore(ILLUSTRATIONS_STORE)
    const booksStore = pagesTx.objectStore(BOOKS_STORE)

    const targetMediaId = String(mediaId || '')
    const pageIdsToClear = []

    const getAllReq = pagesStore.openCursor()
    getAllReq.onsuccess = (event) => {
      const cursor = event.target.result
      if (cursor) {
        const record = cursor.value
        if (record && String(record.mediaId || '') === targetMediaId) {
          pageIdsToClear.push(String(record.pageId))
          cursor.delete()
        }
        cursor.continue()
      } else {
        // After we've deleted page records, also attempt to delete illustration blobs
        pageIdsToClear.forEach((pid) => {
          illuStore.delete(pid)
        })

        // Remove the book record itself
        if (targetMediaId) {
          booksStore.delete(targetMediaId)
        }
      }
    }

    return new Promise((resolve, reject) => {
      pagesTx.oncomplete = () => resolve()
      pagesTx.onerror = () => reject(pagesTx.error)
      pagesTx.onabort = () => reject(pagesTx.error)
    })
  } catch (e) {
    console.error('clearBookForMedia failed', e)
  }
}

export async function saveBookMetadata(mediaId, mediaInfo) {
  try {
    const db = await openDb()
    const tx = db.transaction(BOOKS_STORE, 'readwrite')
    const store = tx.objectStore(BOOKS_STORE)
    const record = {
      mediaId: String(mediaId),
      name: mediaInfo?.title || mediaInfo?.name || String(mediaId),
      description: mediaInfo?.description || '',
      updated: new Date().toISOString(),
      explicitlyOffline: true, // Flag to indicate user explicitly took this book offline
    }
    store.put(record)
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } catch (e) {
    console.error('saveBookMetadata failed', e)
  }
}

export async function getCachedBooks() {
  try {
    const db = await openDb()
    const tx = db.transaction(BOOKS_STORE, 'readonly')
    const store = tx.objectStore(BOOKS_STORE)
    const req = store.getAll()
    return new Promise((resolve, reject) => {
      req.onsuccess = () => {
        // Only return books that have been explicitly taken offline
        const offlineBooks = (req.result || []).filter(book => book.explicitlyOffline === true)
        resolve(offlineBooks)
      }
      req.onerror = () => reject(req.error)
    })
  } catch (e) {
    console.error('getCachedBooks failed', e)
    return []
  }
}

export async function isBookCached(mediaId) {
  if (!mediaId) return false
  try {
    const db = await openDb()
    const tx = db.transaction(BOOKS_STORE, 'readonly')
    const store = tx.objectStore(BOOKS_STORE)
    const req = store.get(String(mediaId))
    const record = await new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result || null)
      req.onerror = () => reject(req.error)
    })
    return !!record
  } catch (e) {
    console.error('isBookCached failed', e)
    return false
  }
}

// Check if book was explicitly taken offline (user clicked "Take Book Offline")
// This is different from just having cached data from viewing
export async function isBookExplicitlyOffline(mediaId) {
  if (!mediaId) return false
  try {
    const db = await openDb()
    const tx = db.transaction(BOOKS_STORE, 'readonly')
    const store = tx.objectStore(BOOKS_STORE)
    const req = store.get(String(mediaId))
    const record = await new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result || null)
      req.onerror = () => reject(req.error)
    })
    return record?.explicitlyOffline === true
  } catch (e) {
    console.error('isBookExplicitlyOffline failed', e)
    return false
  }
}

// Save page file blob (PDF or image) to cache
export async function savePageFileBlob(pageId, blob) {
  if (!pageId || !blob) return
  try {
    const db = await openDb()
    const tx = db.transaction(THUMBNAILS_STORE, 'readwrite')
    const store = tx.objectStore(THUMBNAILS_STORE)
    const partId = `pagefile-${pageId}`
    store.put({ partId, blob })
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } catch (e) {
    console.error('savePageFileBlob failed', e)
  }
}

// Get page file blob from cache (returns blob URL or null)
export async function getPageFileUrl(pageId) {
  if (!pageId) return null
  try {
    const db = await openDb()
    const tx = db.transaction(THUMBNAILS_STORE, 'readonly')
    const store = tx.objectStore(THUMBNAILS_STORE)
    const partId = `pagefile-${pageId}`
    const req = store.get(partId)
    const record = await new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result || null)
      req.onerror = () => reject(req.error)
    })
    if (record && record.blob) {
      return URL.createObjectURL(record.blob)
    }
    return null
  } catch (e) {
    console.error('getPageFileUrl failed', e)
    return null
  }
}

// Save book TOC to offline cache
export async function saveBookToc(mediaId, toc) {
  try {
    const db = await openDb()
    const tx = db.transaction(BOOKS_STORE, 'readwrite')
    const store = tx.objectStore(BOOKS_STORE)
    const record = {
      mediaId: String(mediaId),
      toc: toc,
      updated: new Date().toISOString(),
    }
    // Use put to update existing record
    const existingReq = store.get(String(mediaId))
    const existing = await new Promise((resolve, reject) => {
      existingReq.onsuccess = () => resolve(existingReq.result || null)
      existingReq.onerror = () => reject(existingReq.error)
    })
    if (existing) {
      existing.toc = toc
      existing.updated = new Date().toISOString()
      store.put(existing)
    } else {
      store.put(record)
    }
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } catch (e) {
    console.error('saveBookToc failed', e)
  }
}

// Get book TOC from offline cache
export async function getBookToc(mediaId) {
  if (!mediaId) return null
  try {
    const db = await openDb()
    const tx = db.transaction(BOOKS_STORE, 'readonly')
    const store = tx.objectStore(BOOKS_STORE)
    const req = store.get(String(mediaId))
    const record = await new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result || null)
      req.onerror = () => reject(req.error)
    })
    return record?.toc || null
  } catch (e) {
    console.error('getBookToc failed', e)
    return null
  }
}

// Get full book record from offline cache (includes tenantKey, environment, etc.)
export async function getBookRecord(mediaId) {
  if (!mediaId) return null
  try {
    const db = await openDb()
    const tx = db.transaction(BOOKS_STORE, 'readonly')
    const store = tx.objectStore(BOOKS_STORE)
    const req = store.get(String(mediaId))
    const record = await new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result || null)
      req.onerror = () => reject(req.error)
    })
    return record || null
  } catch (e) {
    console.error('getBookRecord failed', e)
    return null
  }
}

// Save media info to offline cache
export async function saveBookMediaInfo(mediaId, mediaInfo) {
  try {
    const db = await openDb()
    const tx = db.transaction(BOOKS_STORE, 'readwrite')
    const store = tx.objectStore(BOOKS_STORE)
    const existingReq = store.get(String(mediaId))
    const existing = await new Promise((resolve, reject) => {
      existingReq.onsuccess = () => resolve(existingReq.result || null)
      existingReq.onerror = () => reject(existingReq.error)
    })
    if (existing) {
      existing.mediaInfo = mediaInfo
      existing.updated = new Date().toISOString()
      store.put(existing)
    } else {
      store.put({
        mediaId: String(mediaId),
        mediaInfo: mediaInfo,
        updated: new Date().toISOString(),
      })
    }
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } catch (e) {
    console.error('saveBookMediaInfo failed', e)
  }
}

// Get media info from offline cache
export async function getBookMediaInfo(mediaId) {
  if (!mediaId) return null
  try {
    const db = await openDb()
    const tx = db.transaction(BOOKS_STORE, 'readonly')
    const store = tx.objectStore(BOOKS_STORE)
    const req = store.get(String(mediaId))
    const record = await new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result || null)
      req.onerror = () => reject(req.error)
    })
    return record?.mediaInfo || null
  } catch (e) {
    console.error('getBookMediaInfo failed', e)
    return null
  }
}

// Save media tags to offline cache
export async function saveBookTags(mediaId, tags) {
  try {
    const db = await openDb()
    const tx = db.transaction(BOOKS_STORE, 'readwrite')
    const store = tx.objectStore(BOOKS_STORE)
    const existingReq = store.get(String(mediaId))
    const existing = await new Promise((resolve, reject) => {
      existingReq.onsuccess = () => resolve(existingReq.result || null)
      existingReq.onerror = () => reject(existingReq.error)
    })
    if (existing) {
      existing.tags = tags
      existing.updated = new Date().toISOString()
      store.put(existing)
    } else {
      store.put({
        mediaId: String(mediaId),
        tags: tags,
        updated: new Date().toISOString(),
      })
    }
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } catch (e) {
    console.error('saveBookTags failed', e)
  }
}

// Get media tags from offline cache
export async function getBookTags(mediaId) {
  if (!mediaId) return []
  try {
    const db = await openDb()
    const tx = db.transaction(BOOKS_STORE, 'readonly')
    const store = tx.objectStore(BOOKS_STORE)
    const req = store.get(String(mediaId))
    const record = await new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result || null)
      req.onerror = () => reject(req.error)
    })
    return record?.tags || []
  } catch (e) {
    console.error('getBookTags failed', e)
    return []
  }
}

// Save all book offline data atomically in a single transaction
// isExplicitOffline = true when user clicks "Take Book Offline", false for background caching
export async function saveBookOfflineData(mediaId, mediaInfo, toc, tags, isExplicitOffline = false, tenantKey = '', environment = '') {
  try {
    const db = await openDb()
    const tx = db.transaction(BOOKS_STORE, 'readwrite')
    const store = tx.objectStore(BOOKS_STORE)
    
    // Get existing record or create new one
    const existingReq = store.get(String(mediaId))
    const existing = await new Promise((resolve, reject) => {
      existingReq.onsuccess = () => resolve(existingReq.result || null)
      existingReq.onerror = () => reject(existingReq.error)
    })
    
    const record = existing || {
      mediaId: String(mediaId),
    }
    
    // Update all fields - serialize to ensure data is clonable
    record.name = mediaInfo?.title || mediaInfo?.name || String(mediaId)
    record.description = mediaInfo?.description || ''
    record.updated = new Date().toISOString()
    // Only set explicitlyOffline if this is an explicit offline action (not background caching)
    if (isExplicitOffline) {
      record.explicitlyOffline = true
      // Store tenant key and environment when explicitly taken offline
      record.tenantKey = tenantKey
      record.environment = environment
    }
    // Deep clone to remove any non-serializable data
    record.toc = JSON.parse(JSON.stringify(toc))
    record.mediaInfo = JSON.parse(JSON.stringify(mediaInfo))
    record.tags = JSON.parse(JSON.stringify(tags))
    
    store.put(record)
    
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } catch (e) {
    console.error('saveBookOfflineData failed', e)
  }
}
