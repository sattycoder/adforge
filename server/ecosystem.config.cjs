/**
 * PM2 Ecosystem Configuration for Ad Maker Server
 * 
 * CLUSTER MODE: Uses all CPU cores for maximum performance
 * - Each instance: 10 browser contexts
 * - 4 CPU cores = 4 instances × 10 contexts = 40 concurrent contexts
 * - Perfect for up to 50 users (40 concurrent capacity)
 * 
 * Usage:
 *   npm run start:pm2    - Start with PM2
 *   npm run stop:pm2     - Stop PM2 instances
 *   npm run restart:pm2  - Restart all instances
 *   npm run logs:pm2     - View logs
 *   npm run monit:pm2    - Monitor performance
 * 
 * PM2 Commands:
 *   pm2 save             - Save current process list
 *   pm2 startup          - Setup auto-start on server reboot
 *   pm2 list             - List all processes
 */

module.exports = {
  apps: [{
    name: 'ad-maker-server',
    script: './src/server.js',
    
    // CLUSTER MODE: Use all CPU cores
    // Each instance gets its own browser pool (10 contexts)
    // All instances share the same Redis queue
    instances: 'max', // Use all available CPU cores
    exec_mode: 'cluster', // Cluster mode for load balancing
    
    // Environment variables (can be overridden by .env file or Docker)
    env: {
      NODE_ENV: 'production',
      PORT: 5000,
      REDIS_HOST: process.env.REDIS_HOST || 'redis',
      REDIS_PORT: process.env.REDIS_PORT || '6379',
      BROWSER_POOL_SIZE: '10' // 10 contexts per instance
    },
    
    // Docker-specific: PM2 will use environment variables from docker-compose
    // These will override the env section above
    
    // Memory management
    max_memory_restart: '2G', // Restart instance if memory exceeds 2GB
    
    // Auto-restart configuration
    autorestart: true, // Auto-restart on crash
    watch: false, // Don't watch files (set to true for development)
    
    // Logging configuration
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_file: './logs/pm2-combined.log',
    time: true, // Add timestamp to logs
    merge_logs: true, // Merge logs from all instances
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z', // Log format
    
    // Process management
    min_uptime: '10s', // Minimum uptime to consider app stable
    max_restarts: 10, // Max restarts in 1 minute
    restart_delay: 4000, // Delay between restarts (4 seconds)
    
    // Graceful shutdown
    kill_timeout: 10000, // 10 seconds for graceful shutdown
    wait_ready: true, // Wait for 'ready' event before considering app online
    listen_timeout: 10000, // 10 seconds to start listening
    
    // Instance variables (available in process.env)
    instance_var: 'INSTANCE_ID', // Unique ID for each instance
    
    // Advanced: Instance communication
    // PM2 handles load balancing automatically via round-robin
  }]
}
