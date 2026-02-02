# Build a Playwright-ready Node image
FROM node:20-bullseye-slim

# Install system dependencies and Chromium
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgcc1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    lsb-release \
    wget \
    gnupg \
    curl \
    chromium \
    imagemagick \
    ffmpeg \
  && rm -rf /var/lib/apt/lists/* \
  && (test -f /etc/ImageMagick-6/policy.xml && \
      sed -i 's/<policy domain="path" rights="none" pattern="@\*"/<policy domain="path" rights="read|write" pattern="@\*"/' /etc/ImageMagick-6/policy.xml || true) \
  && (test -f /etc/ImageMagick-6/policy.xml && \
      sed -i 's/<policy domain="coder" rights="none" pattern="PDF"/<policy domain="coder" rights="read|write" pattern="PDF"/' /etc/ImageMagick-6/policy.xml || true) \
  && (test -f /etc/ImageMagick-6/policy.xml && \
      sed -i 's/<policy domain="coder" rights="none" pattern="GIF"/<policy domain="coder" rights="read|write" pattern="GIF"/' /etc/ImageMagick-6/policy.xml || true) \
  && echo "✅ ImageMagick installed and configured" \
  && (test -f /etc/ImageMagick-6/policy.xml && \
      sed -i 's/<policy domain="resource" name="memory" value="[^"]*"/<policy domain="resource" name="memory" value="4GiB"/' /etc/ImageMagick-6/policy.xml || true) \
  && (test -f /etc/ImageMagick-6/policy.xml && \
      sed -i 's/<policy domain="resource" name="map" value="[^"]*"/<policy domain="resource" name="map" value="8GiB"/' /etc/ImageMagick-6/policy.xml || true) \
  && (test -f /etc/ImageMagick-6/policy.xml && \
      sed -i 's/<policy domain="resource" name="width" value="[^"]*"/<policy domain="resource" name="width" value="100KP"/' /etc/ImageMagick-6/policy.xml || true) \
  && (test -f /etc/ImageMagick-6/policy.xml && \
      sed -i 's/<policy domain="resource" name="height" value="[^"]*"/<policy domain="resource" name="height" value="100KP"/' /etc/ImageMagick-6/policy.xml || true) \
  && (test -f /etc/ImageMagick-6/policy.xml && \
      sed -i 's/<policy domain="resource" name="area" value="[^"]*"/<policy domain="resource" name="area" value="10GP"/' /etc/ImageMagick-6/policy.xml || true) \
  && (test -f /etc/ImageMagick-6/policy.xml && \
      sed -i 's/<policy domain="resource" name="disk" value="[^"]*"/<policy domain="resource" name="disk" value="16EiB"/' /etc/ImageMagick-6/policy.xml || true) \
  && echo "✅ ImageMagick resource limits increased"

WORKDIR /app

# Install deps first (layer cache)
COPY package*.json ./
RUN npm ci --omit=dev

# Install Playwright browsers (Chromium only for smaller image size)
RUN npx playwright install chromium

# Copy the rest of the server source (works whether context is root or server/)
COPY . .

# Set production environment
ENV NODE_ENV=production

# Expose the server port
EXPOSE 5000

CMD ["npm", "start"]


