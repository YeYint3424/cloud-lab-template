import express, { Request, Response } from 'express';
import os from 'node:os';

const app = express();
const PORT = Number(process.env.PORT ?? 3000);
const APP_ENV = process.env.APP_ENV ?? 'dev';
const STUDENT_ID = process.env.STUDENT_ID ?? 'UNSET';
const startedAt = Date.now();

app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/info', (_req: Request, res: Response) => {
  res.status(200).json({
    service: 'vlsc-s05-api',
    appEnv: APP_ENV,
    studentId: STUDENT_ID,
    hostname: os.hostname(),
    arch: process.arch,
    platform: process.platform,
    nodeVersion: process.version,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
  });
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`vlsc-s05-api listening on 0.0.0.0:${PORT} env=${APP_ENV}`);
});

// Graceful shutdown: PaaS platforms send SIGTERM before stopping a container.
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    console.log(`received ${sig}, shutting down`);
    server.close(() => process.exit(0));
  });
}
// cache test
