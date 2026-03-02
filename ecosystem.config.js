module.exports = {
  apps: [{
    name: 'smtpflow',
    script: '/opt/smtpflow/backend/src/index.js',
    cwd: '/opt/smtpflow/backend',
    user: 'smtpflow',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '512M',
    env: {
      NODE_ENV: 'production',
    },
    env_file: '/opt/smtpflow/backend/.env',
    log_file: '/var/log/smtpflow/pm2.log',
    out_file: '/var/log/smtpflow/out.log',
    error_file: '/var/log/smtpflow/error.log',
  }],
};
