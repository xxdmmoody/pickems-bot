import pino from 'pino';

const level = process.env['LOG_LEVEL'] ?? 'info';

/**
 * Plain JSON in production so journald keeps it structured; pretty output only
 * when a TTY is attached, which keeps `npm run dev` readable.
 */
export const logger = pino({
  level,
  ...(process.stdout.isTTY
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
      }
    : {}),
});
