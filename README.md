# AdForge

A full-stack web application for detecting advertisement slots on websites and replacing them with custom creative assets. Preview how your ads will appear across different devices with accurate device frame simulation.

## Features

- **Multi-Device Preview**: iPhone 16 and MacBook Air device frames
- **Automatic Ad Detection**: Identifies Google Ad iframes and other ad slots using selector patterns and AI
- **Creative Replacement**: Upload and place custom creative assets on detected ad slots
- **Screenshot Generation**: Download full-page or viewport screenshots with your creatives
- **AI-Powered Consent Handling**: Automatically handles cookie consent popups
- **Smart Loading**: Optimized page loading with intelligent scrolling and content readiness checks

## Tech Stack

- **Frontend**: React 18, Vite, Tailwind CSS
- **Backend**: Node.js, Express, Playwright
- **AI**: AWS Bedrock (Claude 3.7 Sonnet) for consent handling and ad detection
- **Queue**: BullMQ with Redis for job management
- **Image Processing**: Sharp for image manipulation

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- Redis (for caching and queue management)
- AWS credentials (for Claude AI features)

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd ad-maker

# Install dependencies
npm install
cd client && npm install && cd ..
cd server && npm install && cd ..

# Set up environment variables
# See .env.example files for required variables

# Start development servers
npm run dev
```

### Environment Variables

Copy the example environment files and fill in your credentials:

```bash
# Server
cp server/.env.example server/.env
# Edit server/.env with your actual AWS credentials and Redis settings

# Client
cp client/.env.example client/.env
# Edit client/.env with your backend URL
```

**Required Server Variables**:
- `AWS_ACCESS_KEY_ID` - Your AWS access key
- `AWS_SECRET_ACCESS_KEY` - Your AWS secret key
- `AWS_BEDROCK_REGION` - AWS region (default: eu-central-1)
- `AWS_BEDROCK_MODEL_ID` - Claude model ARN (replace account-id)
- `REDIS_HOST` - Redis host (default: localhost)
- `REDIS_PORT` - Redis port (default: 6379)

**Required Client Variables**:
- `VITE_BACKEND_URL` - Backend server URL (default: http://localhost:5000)

## Usage

1. Enter a website URL
2. Select device (iPhone 16 or MacBook Air)
3. Wait for ad detection to complete
4. Click on detected ad slots to upload custom creatives
5. Download screenshots with your creatives placed

## Project Structure

```
ad-maker/
├── client/          # React frontend
├── server/          # Node.js backend
├── docker-compose.yml
└── README.md
```

## License

MIT License
