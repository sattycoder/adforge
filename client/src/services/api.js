import axios from 'axios'

const client = axios.create({
  baseURL: '/api/pages',
  timeout: 120000, // 120 seconds (2 minutes) - ZIP/HTML processing needs more time
})

export const api = {
  renderPage: ({ url, device, userEmail }) => {
    const params = { url, device }
    if (userEmail) {
      params.userEmail = userEmail
    }
    return client.get('/renderPage', { params })
  },
  getJobStatus: (jobId) => {
    return client.get('/jobStatus', { params: { jobId } })
  },
  injectAd: (payload) => client.post('/injectAd', payload),
  uploadAd: (formData) => client.post('/uploadAd', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  uploadAsset: (formData) => client.post('/uploadAsset', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  generateHtmlThumbnail: ({ url, width, height }) => client.post('/generateHtmlThumbnail', { url, width, height }),
  download: ({ fileName, type = 'screenshots' }) => client.get(`/download/${encodeURIComponent(fileName)}`, { params: { type }, responseType: 'blob' }),
  
  // New ZIP and HTML processing endpoints
  processZipAsset: (formData) => client.post('/processZipAsset', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  processHtmlAsset: (formData) => client.post('/processHtmlAsset', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  
  // Cache management
  purgeCache: (userEmail) => client.post('/purgeCache', { userEmail }),
}


