// لاگ‌گیری ساختاریافته‌ی متمرکز بر پایه‌ی pino.
// در محیط تولید به‌صورت JSON به stdout می‌رود (مناسب جمع‌آوری لاگ در Render)
// و در توسعه با سطح quiet تر اجرا می‌شود.

const pino = require('pino');
const pinoHttp = require('pino-http');

const isProd = process.env.NODE_ENV === 'production';

const logger = pino({
  level: process.env.LOG_LEVEL || (isProd ? 'info' : 'warn'),
});

// middleware برای ثبت لاگ درخواست‌ها روی req.log
const requestLogger = pinoHttp({
  logger,
  autoLogging: !isProd ? false : { ignore: (req) => req.url.startsWith('/health') },
  customLogLevel: (req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
});

module.exports = { logger, requestLogger };