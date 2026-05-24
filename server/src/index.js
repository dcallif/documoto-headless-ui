const express = require('express');
const dotenv = require('dotenv');
const fetch = require('node-fetch');
const fs = require('fs');
const cors = require('cors');

dotenv.config();

const SETTINGS_FILE = '.settings.json';

const app = express();
const PORT = process.env.PORT || 3001;

// Enable CORS for all routes
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000'],
  credentials: true
}));

// Load settings on startup
let settings = loadSettings();

// Build Documoto base URL based on environment
function getDocumotoBaseUrl() {
  const activeProfile = getActiveProfile();
  const env = activeProfile?.environment || 'integration';
  if (env === 'production') {
    return 'https://api.digabit.com/api/ext';
  }
  return 'https://integration.digabit.com/api/ext';
}

const DOCUMOTO_TOKEN = process.env.DOCUMOTO_TOKEN;

if (!DOCUMOTO_TOKEN && !getActiveProfile()?.apiKey) {
  console.warn('Warning: No API key configured. Please set DOCUMOTO_TOKEN environment variable or configure API key in Settings.');
}

app.use(express.json());

function buildHeaders() {
  const activeProfile = getActiveProfile();
  const apiKey = activeProfile?.apiKey || DOCUMOTO_TOKEN;
  const headers = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers['Authorization'] = apiKey;
  }
  return headers;
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/media/search', async (req, res) => {
  const { q } = req.query;
  if (!q) {
    return res.status(400).json({ error: 'Missing query parameter q' });
  }

  try {
    const url = `${getDocumotoBaseUrl()}/library/search/v1?q=${encodeURIComponent(q)}&type=book`;
    const response = await fetch(url, {
      headers: buildHeaders(),
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: 'Documoto search error', details: data });
    }

    // Log first few results to see ID structure
    const results = data.results || data.entities || [];
    if (results.length > 0) {
      console.log('Search results sample:', results.slice(0, 3).map(r => ({ 
        id: r.id, 
        entityId: r.entityId, 
        entityType: r.entityType,
        name: r.name 
      })));
    }

    res.json(data);
  } catch (err) {
    console.error('Error searching media:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/parts/:partId/thumbnail', async (req, res) => {
  const { partId } = req.params;

  try {
    const headers = buildHeaders();
    const thumbnailUrl = `${getDocumotoBaseUrl()}/library/parts/v1/${encodeURIComponent(partId)}/thumbnails`;

    const response = await fetch(thumbnailUrl, { headers });
    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      return res.status(response.status).send(bodyText || 'Failed to fetch part thumbnail');
    }

    const contentType = response.headers.get('content-type') || 'image/png';
    const buffer = await response.buffer();

    res.set('Content-Type', contentType);
    res.send(buffer);
  } catch (err) {
    console.error('Error fetching part thumbnail:', err);
    res.status(500).send('Internal server error');
  }
});

app.get('/api/media/:mediaId/toc', async (req, res) => {
  const { mediaId } = req.params;
  try {
    const headers = buildHeaders();

    const tocUrl = `${getDocumotoBaseUrl()}/library/media/v1/${encodeURIComponent(mediaId)}/tocs`;
    const mediaUrl = `${getDocumotoBaseUrl()}/library/media/v1/${encodeURIComponent(mediaId)}`;

    const [tocRes, mediaRes] = await Promise.all([
      fetch(tocUrl, { headers }),
      fetch(mediaUrl, { headers }),
    ]);

    const [toc, mediaInfo] = await Promise.all([
      tocRes.json(),
      mediaRes.json(),
    ]);

    if (!tocRes.ok || !mediaRes.ok) {
      console.error('Documoto media details/TOC error:', {
        mediaId,
        toc: { status: tocRes.status, ok: tocRes.ok },
        media: { status: mediaRes.status, ok: mediaRes.ok },
      });
      
      // Check if media was not found (likely stale search index)
      const mediaNotFound = mediaInfo?.message?.includes('not found') || 
                           mediaInfo?.error === 'NOT_FOUND';
      const tocNotFound = toc?.message?.includes('not found') || 
                         toc?.error === 'NOT_FOUND';
      
      if (mediaNotFound || tocNotFound) {
        return res.status(404).json({
          error: 'Media not found',
          message: `Media ID ${mediaId} does not exist. It may have been deleted or the search index is stale.`,
        });
      }
      
      return res.status(502).json({
        error: 'Documoto media details/TOC error',
        details: {
          toc: { status: tocRes.status, body: toc },
          media: { status: mediaRes.status, body: mediaInfo },
        },
      });
    }

    // API calls made to render the TOC view
    const apiCalls = [
      'GET /library/media/v1/:mediaId/tocs',
      'GET /library/media/v1/:mediaId',
    ];
    const apiCallCount = apiCalls.length;

    res.json({ mediaInfo, toc, apiCalls, apiCallCount });
  } catch (err) {
    console.error('Error fetching media TOC/details:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/pages/:pageId/details', async (req, res) => {
  const { pageId } = req.params;

  try {
    const headers = buildHeaders();

    const pageUrl = `${getDocumotoBaseUrl()}/library/pages/v1/${encodeURIComponent(pageId)}`;
    const bomUrl = `${getDocumotoBaseUrl()}/library/pages/v1/${encodeURIComponent(pageId)}/boms`;
    const hotpointsUrl = `${getDocumotoBaseUrl()}/library/pages/v1/${encodeURIComponent(pageId)}/hotpoints`;

    const [pageRes, bomRes, hotpointsRes] = await Promise.all([
      fetch(pageUrl, { headers }),
      fetch(bomUrl, { headers }),
      fetch(hotpointsUrl, { headers }),
    ]);

    const [pageInfo, bom, hotpoints] = await Promise.all([
      pageRes.json(),
      bomRes.json(),
      hotpointsRes.json(),
    ]);

    if (!pageRes.ok) {
      return res.status(502).json({
        error: 'Documoto page details error',
        details: {
          page: { status: pageRes.status, body: pageInfo },
        },
      });
    }

    // For BOM and hotpoints, treat missing/invalid responses as "no data" instead of fatal.
    const safeBom = bomRes.ok ? bom : null;
    const safeHotpoints = hotpointsRes.ok ? hotpoints : null;

    // Expose a proxy URL for the illustration image so the frontend can load it
    // without needing Documoto auth headers in the browser.
    const illustrations = [
      {
        imageUrl: `/api/pages/${encodeURIComponent(pageId)}/illustration`,
      },
    ];

    // Upstream Documoto calls required to render a page:
    // 1) page details
    // 2) BOM
    // 3) hotpoints
    // 4) illustration (via the proxy endpoint)
    // 5+) part thumbnails (one per BOM line that has a partId)
    const baseApiCalls = [
      'GET /library/pages/v1/:pageId',
      'GET /library/pages/v1/:pageId/boms',
      'GET /library/pages/v1/:pageId/hotpoints',
      'GET /library/pages/v1/:pageId/page-illustrations',
    ];

    let thumbnailCallCount = 0;
    if (safeBom && Array.isArray(safeBom.billOfMaterials)) {
      thumbnailCallCount = safeBom.billOfMaterials.filter((line) => line && line.partId).length;
    }

    const apiCalls = [
      ...baseApiCalls,
      `GET /library/parts/v1/:partId/thumbnails x${thumbnailCallCount}`,
    ];

    const apiCallCount = baseApiCalls.length + thumbnailCallCount;

    res.json({ pageInfo, bom: safeBom, illustrations, hotpoints: safeHotpoints, apiCallCount, apiCalls });
  } catch (err) {
    console.error('Error fetching page details:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/pages/:pageId/illustration', async (req, res) => {
  const { pageId } = req.params;

  try {
    const headers = buildHeaders();
    const illustrationsUrl = `${getDocumotoBaseUrl()}/library/pages/v1/${encodeURIComponent(pageId)}/page-illustrations`;

    const response = await fetch(illustrationsUrl, { headers });
    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      return res.status(response.status).send(bodyText || 'Failed to fetch illustration');
    }

    const contentType = response.headers.get('content-type') || 'image/png';
    const buffer = await response.buffer();

    res.set('Content-Type', contentType);
    res.send(buffer);
  } catch (err) {
    console.error('Error fetching page illustration:', err);
    res.status(500).send('Internal server error');
  }
});

app.get('/api/pages/:pageId/page-file', async (req, res) => {
  const { pageId } = req.params;
  // Get optional filename from query param, fallback to pageId
  const filename = req.query.filename || `page-${pageId}`;
  // inline=true for browser viewing, download for saving
  const inline = req.query.inline === 'true';

  try {
    const headers = buildHeaders();
    const pageFileUrl = `${getDocumotoBaseUrl()}/library/pages/v1/${encodeURIComponent(pageId)}/page-files`;

    const response = await fetch(pageFileUrl, { headers });
    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      return res.status(response.status).send(bodyText || 'Failed to fetch page file');
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const buffer = await response.buffer();

    res.set('Content-Type', contentType);
    // Include filename in Content-Disposition
    const encodedFilename = encodeURIComponent(filename).replace(/['()]/g, escape);
    const disposition = inline ? 'inline' : 'attachment';
    res.set('Content-Disposition', `${disposition}; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`);
    res.send(buffer);
  } catch (err) {
    console.error('Error fetching page file:', err);
    res.status(500).send('Internal server error');
  }
});

app.get('/api/pages/:pageId/thumbnail', async (req, res) => {
  const { pageId } = req.params;

  try {
    const headers = buildHeaders();
    const thumbnailUrl = `${getDocumotoBaseUrl()}/library/pages/v1/${encodeURIComponent(pageId)}/thumbnails`;

    const response = await fetch(thumbnailUrl, { headers });
    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      return res.status(response.status).send(bodyText || 'Failed to fetch thumbnail');
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const buffer = await response.buffer();

    res.set('Content-Type', contentType);
    res.send(buffer);
  } catch (err) {
    console.error('Error fetching page thumbnail:', err);
    res.status(500).send('Internal server error');
  }
});

app.get('/api/media/:mediaId/thumbnail', async (req, res) => {
  const { mediaId } = req.params;

  try {
    const headers = buildHeaders();
    const thumbnailUrl = `${getDocumotoBaseUrl()}/library/media/v1/${encodeURIComponent(mediaId)}/thumbnails`;

    const response = await fetch(thumbnailUrl, { headers });
    if (!response.ok) {
      return res.status(response.status).send('Failed to fetch media thumbnail');
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const buffer = await response.buffer();

    res.set('Content-Type', contentType);
    res.send(buffer);
  } catch (err) {
    console.error('Error fetching media thumbnail:', err);
    res.status(500).send('Internal server error');
  }
});

app.get('/api/media/:mediaId/tags', async (req, res) => {
  const { mediaId } = req.params;

  try {
    const headers = buildHeaders();
    const allTags = [];
    let nextUrl = `${getDocumotoBaseUrl()}/library/media/v1/${encodeURIComponent(mediaId)}/tags`;
    let apiCallCount = 0;

    // Fetch all pages of tags
    while (nextUrl) {
      apiCallCount++;
      const response = await fetch(nextUrl, { headers });
      if (!response.ok) {
        const bodyText = await response.text().catch(() => '');
        return res.status(response.status).send(bodyText || 'Failed to fetch media tags');
      }

      const data = await response.json();
      if (Array.isArray(data.tags)) {
        allTags.push(...data.tags);
      }

      // Check for next page
      nextUrl = data.nextPage || null;
    }

    res.json({ tags: allTags, apiCallCount });
  } catch (err) {
    console.error('Error fetching media tags:', err);
    res.status(500).send('Internal server error');
  }
});

// Browse Flows endpoints
app.get('/api/browse-flows', async (req, res) => {
  try {
    const headers = buildHeaders();
    const url = `${getDocumotoBaseUrl()}/library/browse-flows/v1`;
    const response = await fetch(url, { headers });
    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch browse flows', details: data });
    }
    res.json(data);
  } catch (err) {
    console.error('Error fetching browse flows:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Also support the full path for compatibility
app.get('/api/library/browse-flows/v1', async (req, res) => {
  try {
    const headers = buildHeaders();
    const url = `${getDocumotoBaseUrl()}/library/browse-flows/v1`;
    const response = await fetch(url, { headers });
    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch browse flows', details: data });
    }
    res.json(data);
  } catch (err) {
    console.error('Error fetching browse flows:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Browse flow thumbnails endpoint
app.get('/api/library/browse-flows/v1/:flowId/thumbnails', async (req, res) => {
  const { flowId } = req.params;
  try {
    const headers = buildHeaders();
    const url = `${getDocumotoBaseUrl()}/library/browse-flows/v1/${encodeURIComponent(flowId)}/thumbnails`;
    const response = await fetch(url, { headers });
    
    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch browse flow thumbnail' });
    }
    
    // Stream the image data
    response.body.pipe(res);
  } catch (err) {
    console.error('Error fetching browse flow thumbnail:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Browse flow results endpoint
app.get('/api/library/browse-flows/v1/:flowId/results', async (req, res) => {
  const { flowId } = req.params;
  const { offset, limit } = req.query;
  try {
    const headers = buildHeaders();
    const queryParams = new URLSearchParams();
    if (offset) queryParams.append('offset', offset);
    if (limit) queryParams.append('limit', limit);
    
    const url = `${getDocumotoBaseUrl()}/library/browse-flows/v1/${encodeURIComponent(flowId)}/results?${queryParams.toString()}`;
    const response = await fetch(url, { headers });
    const data = await response.json();
    
    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch browse flow results', details: data });
    }
    res.json(data);
  } catch (err) {
    console.error('Error fetching browse flow results:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Media API endpoints
app.get('/api/library/media/v1/:mediaId', async (req, res) => {
  const { mediaId } = req.params;
  try {
    const headers = buildHeaders();
    const url = `${getDocumotoBaseUrl()}/library/media/v1/${encodeURIComponent(mediaId)}`;
    const response = await fetch(url, { headers });
    const data = await response.json();
    
    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch media', details: data });
    }
    res.json(data);
  } catch (err) {
    console.error('Error fetching media:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/library/media/v1/:mediaId/tocs', async (req, res) => {
  const { mediaId } = req.params;
  try {
    const headers = buildHeaders();
    const url = `${getDocumotoBaseUrl()}/library/media/v1/${encodeURIComponent(mediaId)}/tocs`;
    const response = await fetch(url, { headers });
    const data = await response.json();
    
    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch media TOC', details: data });
    }
    res.json(data);
  } catch (err) {
    console.error('Error fetching media TOC:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/library/media/v1/:mediaId/thumbnails', async (req, res) => {
  const { mediaId } = req.params;
  try {
    const headers = buildHeaders();
    const url = `${getDocumotoBaseUrl()}/library/media/v1/${encodeURIComponent(mediaId)}/thumbnails`;
    const response = await fetch(url, { headers });
    
    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch media thumbnail' });
    }
    
    // Stream the image data
    response.body.pipe(res);
  } catch (err) {
    console.error('Error fetching media thumbnail:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/library/media/v1/:mediaId/tags', async (req, res) => {
  const { mediaId } = req.params;
  const { offset, limit } = req.query;
  try {
    const headers = buildHeaders();
    const queryParams = new URLSearchParams();
    if (offset) queryParams.append('offset', offset);
    if (limit) queryParams.append('limit', limit);
    
    const url = `${getDocumotoBaseUrl()}/library/media/v1/${encodeURIComponent(mediaId)}/tags?${queryParams.toString()}`;
    const response = await fetch(url, { headers });
    const data = await response.json();
    
    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch media tags', details: data });
    }
    res.json(data);
  } catch (err) {
    console.error('Error fetching media tags:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Page API endpoints
app.get('/api/library/pages/v1/:pageId', async (req, res) => {
  const { pageId } = req.params;
  try {
    const headers = buildHeaders();
    const url = `${getDocumotoBaseUrl()}/library/pages/v1/${encodeURIComponent(pageId)}`;
    const response = await fetch(url, { headers });
    const data = await response.json();
    
    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch page', details: data });
    }
    res.json(data);
  } catch (err) {
    console.error('Error fetching page:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/library/pages/v1/:pageId/thumbnails', async (req, res) => {
  const { pageId } = req.params;
  try {
    const headers = buildHeaders();
    const url = `${getDocumotoBaseUrl()}/library/pages/v1/${encodeURIComponent(pageId)}/thumbnails`;
    const response = await fetch(url, { headers });
    
    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch page thumbnail' });
    }
    
    // Stream the image data
    response.body.pipe(res);
  } catch (err) {
    console.error('Error fetching page thumbnail:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/library/pages/v1/:pageId/boms', async (req, res) => {
  const { pageId } = req.params;
  try {
    const headers = buildHeaders();
    const url = `${getDocumotoBaseUrl()}/library/pages/v1/${encodeURIComponent(pageId)}/boms`;
    const response = await fetch(url, { headers });
    const data = await response.json();
    
    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch page BOM', details: data });
    }
    res.json(data);
  } catch (err) {
    console.error('Error fetching page BOM:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/library/pages/v1/:pageId/hotpoints', async (req, res) => {
  const { pageId } = req.params;
  try {
    const headers = buildHeaders();
    const url = `${getDocumotoBaseUrl()}/library/pages/v1/${encodeURIComponent(pageId)}/hotpoints`;
    const response = await fetch(url, { headers });
    const data = await response.json();
    
    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch page hotpoints', details: data });
    }
    res.json(data);
  } catch (err) {
    console.error('Error fetching page hotpoints:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/library/pages/v1/:pageId/page-illustrations', async (req, res) => {
  const { pageId } = req.params;
  try {
    const headers = buildHeaders();
    const url = `${getDocumotoBaseUrl()}/library/pages/v1/${encodeURIComponent(pageId)}/page-illustrations`;
    const response = await fetch(url, { headers });
    const data = await response.json();
    
    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch page illustrations', details: data });
    }
    res.json(data);
  } catch (err) {
    console.error('Error fetching page illustrations:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/browse-flows/:flowId', async (req, res) => {
  const { flowId } = req.params;
  try {
    const headers = buildHeaders();
    const url = `${getDocumotoBaseUrl()}/library/browse-flows/v1/${encodeURIComponent(flowId)}`;
    const response = await fetch(url, { headers });
    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch browse flow', details: data });
    }
    res.json(data);
  } catch (err) {
    console.error('Error fetching browse flow:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/browse-flows/:flowId/results', async (req, res) => {
  const { flowId } = req.params;
  const { offset = 0, limit = 100, sort, sortDesc, locale } = req.query;
  try {
    const headers = buildHeaders();
    const params = new URLSearchParams({ offset, limit });
    if (sort) params.set('sort', sort);
    if (sortDesc) params.set('sortDesc', sortDesc);
    if (locale) params.set('locale', locale);
    
    const url = `${getDocumotoBaseUrl()}/library/browse-flows/v1/${encodeURIComponent(flowId)}/results?${params}`;
    const response = await fetch(url, { headers });
    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch browse flow results', details: data });
    }
    res.json(data);
  } catch (err) {
    console.error('Error fetching browse flow results:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/browse-flows/:flowId/thumbnail', async (req, res) => {
  const { flowId } = req.params;
  try {
    const headers = buildHeaders();
    const url = `${getDocumotoBaseUrl()}/library/browse-flows/v1/${encodeURIComponent(flowId)}/thumbnails`;
    const response = await fetch(url, { headers });
    
    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      return res.status(response.status).send(bodyText || 'Failed to fetch thumbnail');
    }

    const contentType = response.headers.get('content-type') || 'image/png';
    const buffer = await response.arrayBuffer();
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=300');
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('Error fetching browse flow thumbnail:', err);
    res.status(500).send('Internal server error');
  }
});

// Settings API endpoints for secure storage

// Load settings from file
function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = fs.readFileSync(SETTINGS_FILE, 'utf8');
      const parsed = JSON.parse(data);
      // Migrate old format to new format if needed
      if (parsed.environment && !parsed.profiles) {
        return {
          profiles: [
            {
              id: 'default',
              name: 'Default',
              environment: parsed.environment || 'integration',
              tenantKey: parsed.tenantKey || '',
              apiKey: parsed.apiKey || ''
            }
          ],
          activeProfileId: 'default'
        };
      }
      return parsed;
    }
  } catch (err) {
    console.error('Error loading settings:', err);
  }
  // Initialize with default profile from .env if no settings file exists
  return {
    profiles: [
      {
        id: 'default',
        name: 'Default',
        environment: 'integration',
        tenantKey: 'CALLIFTEST',
        apiKey: process.env.DOCUMOTO_TOKEN || ''
      }
    ],
    activeProfileId: 'default'
  };
}

// Save settings to file
function saveSettings(settings) {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    return true;
  } catch (err) {
    console.error('Error saving settings:', err);
    return false;
  }
}

app.get('/api/settings', (req, res) => {
  const settings = loadSettings();
  console.log('Settings loaded:', JSON.stringify(settings, null, 2));
  // Return profiles without API keys (for security)
  const profiles = (settings.profiles || []).map(p => ({
    id: p.id,
    name: p.name,
    environment: p.environment,
    tenantKey: p.tenantKey
  }));
  console.log('Profiles to return:', JSON.stringify(profiles, null, 2));
  res.json({
    profiles,
    activeProfileId: settings.activeProfileId
  });
});

app.post('/api/settings', (req, res) => {
  const { profiles, activeProfileId } = req.body;
  const currentSettings = loadSettings();
  
  if (profiles) {
    // Merge with existing profiles, preserving API keys if not provided in request
    const existingProfilesMap = new Map((currentSettings.profiles || []).map(p => [p.id, p]));
    currentSettings.profiles = profiles.map(p => {
      const existingProfile = existingProfilesMap.get(p.id);
      // Use the API key from request if provided (non-empty string), otherwise keep existing
      let apiKey;
      if (p.apiKey !== undefined && p.apiKey !== '') {
        apiKey = p.apiKey;
      } else {
        apiKey = existingProfile?.apiKey || '';
      }
      return {
        ...p,
        apiKey
      };
    });
  }
  
  if (activeProfileId !== undefined) {
    currentSettings.activeProfileId = activeProfileId;
  }
  
  const saved = saveSettings(currentSettings);
  if (saved) {
    // Reload settings to apply changes immediately
    settings = loadSettings();
    // Return profiles without API keys
    const profiles = (settings.profiles || []).map(p => ({
      id: p.id,
      name: p.name,
      environment: p.environment,
      tenantKey: p.tenantKey
    }));
    res.json({
      profiles,
      activeProfileId: settings.activeProfileId
    });
  } else {
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

// Get active profile settings (includes API key for backend use)
function getActiveProfile() {
  const settings = loadSettings();
  if (!settings.activeProfileId || !settings.profiles) {
    return null;
  }
  return settings.profiles.find(p => p.id === settings.activeProfileId) || null;
}

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
