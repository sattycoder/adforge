# Ad Maker Campaign Preview Tool - Technical Documentation

## Overview

The Ad Maker Campaign Preview Tool is a web-based application that enables users to preview how their advertising campaigns will appear on real websites across different device types. The system uses headless browser automation to capture full-page screenshots, detect advertisement slots, and provide an interactive preview interface.

---

## Architecture

### System Components

The application follows a microservices architecture with three main components:

1. **Frontend (React)** - User interface for URL input, device selection, and preview display
2. **Backend API (Node.js/Express)** - RESTful API handling page rendering requests
3. **Browser Pool Manager** - Manages Playwright browser contexts for concurrent page rendering

### Core Architecture Principles

**Browser Context Pooling**
- Single Chromium browser instance shared across all requests
- 10 isolated browser contexts (one per concurrent user)
- Contexts are pre-created at startup for faster allocation
- Automatic context validation and recreation on failure

**Queue-Based Processing**
- BullMQ (Redis-backed) job queue for page rendering requests
- Prevents resource exhaustion by limiting concurrent processing
- Supports job cancellation and priority queuing
- Maximum 10 concurrent jobs matching the browser pool size

**Caching Strategy**
- Redis-based caching for rendered page results
- Cache key: `userEmail:url:device`
- Cache duration: 5 days
- Automatic cache invalidation when screenshot files are deleted

### Request Flow

1. User submits URL and device selection via frontend
2. Frontend calls `/api/pages/renderPage` endpoint
3. Backend checks Redis cache for existing results
4. If cached and valid, returns immediately
5. If not cached, job is enqueued in BullMQ
6. Queue worker picks up job when browser context is available
7. Page is rendered using Playwright with optimized loading strategies
8. Results are cached in Redis and returned to frontend
9. Frontend polls `/api/pages/jobStatus` for progress updates

---

## API Interfaces

### Page Rendering Endpoints

#### `GET /api/pages/renderPage`
Initiates a page rendering job.

**Query Parameters:**
- `url` (required) - Target webpage URL
- `device` (required) - Device type: `macbook-air` or `iphone16`
- `userEmail` (optional) - User identifier for caching

**Response:**
```json
{
  "success": true,
  "data": {
    "jobId": "user_email-url-device-timestamp-random",
    "status": "queued",
    "message": "Job enqueued, use /jobStatus endpoint to check progress"
  }
}
```

#### `GET /api/pages/jobStatus`
Retrieves the current status of a rendering job.

**Query Parameters:**
- `jobId` (required) - Job identifier from renderPage response

**Response:**
```json
{
  "success": true,
  "data": {
    "status": "completed",
    "result": {
      "url": "https://example.com",
      "device": "macbook-air",
      "screenshotUrl": "/screenshots/page-123.png",
      "adSlots": [...],
      "header": {
        "headerUrl": "/screenshots/header-example.jpg",
        "headerHeight": 98,
        "headerWidth": 1440,
        "croppedScreenshotUrl": "/screenshots/page-123-cropped.png"
      },
      "metadata": {
        "scrollHeight": 5652,
        "scrollWidth": 1440
      },
      "step1Complete": true,
      "step2Complete": true,
      "step3Complete": true
    }
  }
}
```

#### `GET /api/pages/pageInfo`
Retrieves cached page information without re-rendering.

**Query Parameters:**
- `url` (required)
- `device` (required)
- `userEmail` (optional)

### Health & Monitoring

#### `GET /api/pages/health`
Returns system health metrics including browser pool status and queue statistics.

**Response:**
```json
{
  "success": true,
  "data": {
    "browserPool": {
      "totalContexts": 10,
      "activeContexts": 3,
      "availableContexts": 7,
      "queueLength": 0
    },
    "queue": {
      "waiting": 0,
      "active": 3,
      "completed": 1250,
      "failed": 5
    },
    "status": "healthy"
  }
}
```

### Cache Management

#### `POST /api/pages/purgeCache`
Clears all cached data for a specific user.

**Request Body:**
```json
{
  "userEmail": "user@example.com"
}
```

### Ad Management Endpoints

#### `POST /api/pages/injectAd`
Injects an advertisement into a detected ad slot.

#### `POST /api/pages/uploadAd`
Uploads an advertisement image asset.

#### `POST /api/pages/processZipAsset`
Processes ZIP files containing HTML/asset bundles.

---

## Database Model

### Redis Data Structure

The application uses Redis for two primary purposes:

**1. Job Queue (BullMQ)**
- Queue name: `page-rendering`
- Job data structure:
  ```json
  {
    "url": "https://example.com",
    "device": "macbook-air",
    "userEmail": "user@example.com",
    "timestamp": 1234567890,
    "cancelled": false
  }
  ```
- Job retention: Completed jobs kept for 1 hour, failed jobs for 24 hours
- Job timeout: 5 minutes per job

**2. Page Rendering Cache**
- Key format: `page:${userEmail}:${url}:${device}`
- Value: JSON string containing:
  ```json
  {
    "url": "https://example.com",
    "device": "macbook-air",
    "screenshotUrl": "/screenshots/page-123.png",
    "adSlots": [...],
    "header": {...},
    "metadata": {...},
    "timestamp": "2024-01-23T10:00:00.000Z"
  }
  ```
- TTL: 5 days (432,000 seconds)
- Memory policy: `allkeys-lru` (evict least recently used keys when memory limit reached)

**3. Claude AI Response Cache**
- Consent detection results cached to reduce API calls
- Ad detection results cached for faster subsequent requests
- Header detection results cached per URL

### Redis Configuration

- Maximum memory: 512MB
- Persistence: AOF (Append-Only File) enabled
- Eviction policy: `allkeys-lru`
- Connection pooling: Enabled for concurrent access

---

## Deployment Process

### Prerequisites

- Docker and Docker Compose installed
- AWS credentials configured (for Claude AI via Bedrock)
- Minimum server specs: 2 vCPU, 16GB RAM (r6i.large recommended)

### Environment Variables

**Server (.env):**
```
PORT=5000
REDIS_HOST=redis
REDIS_PORT=6379
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
AWS_BEDROCK_REGION=eu-central-1
CLAUDE_CONSENT_ENABLED=true
BROWSER_POOL_SIZE=10
NODE_ENV=production
```

**Client (.env):**
```
VITE_API_URL=http://localhost:5050/api
```

### Deployment Steps

1. **Clone Repository**
   ```bash
   git clone <repository-url>
   cd ad-maker
   ```

2. **Configure Environment**
   - Copy `.env.example` to `.env` in both `server/` and `client/` directories
   - Update AWS credentials and other configuration values

3. **Build and Start Services**
   ```bash
   docker-compose up -d --build
   ```

4. **Verify Deployment**
   - Check health endpoint: `curl http://localhost:5050/api/pages/health`
   - Access frontend: `http://localhost:3030`
   - Monitor logs: `docker-compose logs -f`

### Service Ports

- **Frontend**: `3030` (mapped from container port 3000)
- **Backend API**: `5050` (mapped from container port 5000)
- **Redis**: `6379` (internal, not exposed externally)

### Persistent Volumes

The following volumes persist data across container restarts:

- `server_uploads` - User-uploaded assets (ZIP files, images)
- `server_screenshots` - Generated page screenshots and headers
- `redis_data` - Redis persistence data

### Scaling Considerations

The current architecture supports:
- **Concurrent Users**: Up to 10 simultaneous page rendering requests
- **Queue Capacity**: Unlimited (limited by Redis memory)
- **Browser Contexts**: 10 pre-allocated contexts

To scale beyond 10 concurrent users:
1. Increase `BROWSER_POOL_SIZE` environment variable
2. Update `concurrency` in `pageQueue.js` to match pool size
3. Ensure sufficient server resources (RAM scales with context count)

### Monitoring & Maintenance

**Health Checks:**
- Health endpoint provides real-time system metrics
- Monitor browser pool utilization and queue length
- Track job completion and failure rates

**Log Management:**
- Application logs available via `docker-compose logs`
- Log rotation handled by Docker
- Error tracking via console output

**Cache Management:**
- Automatic cache expiration after 5 days
- Manual cache purge via `/api/pages/purgeCache` endpoint
- Redis memory limits prevent unbounded growth

**Cleanup Jobs:**
- Automatic screenshot cleanup after 6 hours
- Temporary file cleanup runs periodically
- Failed job cleanup after 24 hours

---

## Technical Specifications

### Browser Automation

- **Engine**: Playwright (Chromium)
- **Headless Mode**: Enabled
- **Viewport Sizes**:
  - MacBook Air: 1440x900
  - iPhone 16: 393x852
- **Page Loading Strategy**:
  - Smart top ad triggering with frame monitoring
  - Eager loading of lazy resources
  - Slow auto-scroll with content readiness checks
  - Network idle detection
  - Average rendering time: 45-70 seconds per page

### AI Integration

- **Provider**: AWS Bedrock
- **Model**: Claude 3.7 Sonnet (anthropic.claude-3-7-sonnet-20250219-v1:0)
- **Use Cases**:
  - Consent popup detection and handling
  - Advertisement slot detection
  - Header detection and capture
  - Popup closing assistance

### Performance Optimizations

- Browser context pooling for reduced memory overhead
- Redis caching to avoid redundant page renders
- Job queue prevents resource exhaustion
- Optimized screenshot formats (JPEG for desktop, PNG for mobile)
- Parallel page cleanup for faster context release
- Adaptive polling for job status checks

---

## Security Considerations

- Input validation on all API endpoints
- Directory traversal protection for file downloads
- CORS enabled for frontend-backend communication
- Environment variable isolation for sensitive credentials
- No persistent user authentication (stateless API design)
- Screenshot file validation before serving from cache

---

## Troubleshooting

**Common Issues:**

1. **Browser Context Allocation Timeout**
   - Check browser pool size vs. concurrent requests
   - Monitor queue length via health endpoint
   - Consider increasing pool size if consistently busy

2. **Redis Connection Errors**
   - Verify Redis container is running: `docker-compose ps`
   - Check Redis logs: `docker-compose logs redis`
   - Ensure network connectivity between services

3. **Screenshot Generation Failures**
   - Check available disk space for screenshot volume
   - Verify Playwright dependencies are installed
   - Review page rendering logs for specific errors

4. **Cache Not Working**
   - Verify Redis is accessible and healthy
   - Check cache key format matches expected pattern
   - Ensure cache TTL hasn't expired

---

*Document Version: 1.0*  
*Last Updated: January 2024*


