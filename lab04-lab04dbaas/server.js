'use strict';

const http = require('http');
const { Pool } = require('pg');

// ---------------------------------------------------------------------------
// 1. Zero-Trust Environment Validation
//    Secrets come ONLY from environment variables (Render/Koyeb dashboard,
//    or config/.env in Codespaces). Never hardcode the connection string here.
// ---------------------------------------------------------------------------
const DATABASE_URL = process.env.DATABASE_URL;
const PORT = parseInt(process.env.PORT || '3000', 10);
const STUDENT_ID = process.env.STUDENT_ID || 'YOUR_STUDENT_ID'; // set STUDENT_ID in Render env
const PAAS_ENVIRONMENT = process.env.NODE_ENV || 'production';

if (!DATABASE_URL || !DATABASE_URL.includes('sslmode=require')) {
  console.error('[FATAL] DATABASE_URL is missing or lacks mandatory ?sslmode=require parameter.');
  process.exit(1);
}

// Detect pooled endpoint: "-pooler" host suffix (Neon) or port 6543 (Supabase Supavisor)
let DB_CONNECTION_POOLED = false;
try {
  const dbUrl = new URL(DATABASE_URL);
  DB_CONNECTION_POOLED = dbUrl.hostname.includes('-pooler') || dbUrl.port === '6543';
} catch (err) {
  console.error('[FATAL] DATABASE_URL is not a valid URI:', err.message);
  process.exit(1);
}

if (!DB_CONNECTION_POOLED) {
  console.warn('[WARN] DATABASE_URL does not point to a pooled endpoint (-pooler / port 6543).');
}

const SSL_ENFORCED = DATABASE_URL.includes('sslmode=require');

// ---------------------------------------------------------------------------
// 2. Singleton Connection Pool with explicit resource bounds
// ---------------------------------------------------------------------------
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // TLS encryption on the PaaS-to-DBaaS link (lab only; prod = verify-full + CA)
  max: 10,                            // Assessment bound: pool size must not exceed 10
  idleTimeoutMillis: 30000,           // Release idle sockets after 30s so the DB can scale to zero
  connectionTimeoutMillis: 15000      // Allow up to 15s for a serverless cold start wake-up
});

pool.on('error', (err) => {
  console.error('[POOL_ERROR] Unexpected error on idle PostgreSQL client:', err.message);
});

// Small helper to send JSON responses
const sendJson = (res, statusCode, payload) => {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload, null, 2));
};

// ---------------------------------------------------------------------------
// 3. HTTP Server: /healthz, /deployments, /api/audit
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');

  // ---- Health check with DB telemetry -------------------------------------
  if (req.method === 'GET' && pathname === '/healthz') {
    let client;
    try {
      const startTime = process.hrtime.bigint();
      client = await pool.connect();
      const dbRes = await client.query(
        `SELECT current_database()       AS db_name,
                inet_server_addr()::text AS db_ip,
                pg_backend_pid()         AS backend_pid,
                NOW()                    AS server_time;`
      );
      const durationMs = Number(process.hrtime.bigint() - startTime) / 1e6;

      return sendJson(res, 200, {
        status: 'HEALTHY',
        latency_ms: Number(durationMs.toFixed(2)),
        pool_metrics: {
          total_count: pool.totalCount,
          idle_count: pool.idleCount,
          waiting_count: pool.waitingCount
        },
        telemetry: dbRes.rows[0]
      });
    } catch (err) {
      console.error('[DB_HEALTH_FAILURE]', err.code, err.message);
      return sendJson(res, 503, {
        status: 'UNHEALTHY',
        error_code: err.code || 'UNKNOWN',
        message: err.message
      });
    } finally {
      if (client) client.release(); // Always return socket to pool (prevents connection leak)
    }
  }

  // ---- Lab 04: cloud_deployments listing ----------------------------------
  if (req.method === 'GET' && pathname === '/deployments') {
    let client;
    try {
      client = await pool.connect();
      const result = await client.query(
        'SELECT id, student_id, service_node, tls_cipher, created_at FROM cloud_deployments ORDER BY id DESC LIMIT 20;'
      );
      return sendJson(res, 200, { count: result.rowCount, data: result.rows });
    } catch (err) {
      console.error('[QUERY_FAILURE]', err.code, err.message);
      return sendJson(res, 500, { error: 'Database query failed', code: err.code });
    } finally {
      if (client) client.release();
    }
  }

  // ---- Periodic Assessment: shipment_logs audit ---------------------------
  if (req.method === 'GET' && pathname === '/api/audit') {
    let client;
    try {
      client = await pool.connect();
      // Parameterized query ($1) prevents SQL injection; unnamed statement is pooler-safe
      const result = await client.query(
        `SELECT log_id, student_id, tracking_code, hub_region, recorded_at
           FROM shipment_logs
          WHERE student_id = $1
          ORDER BY log_id ASC;`,
        [STUDENT_ID]
      );

      return sendJson(res, 200, {
        student_id: STUDENT_ID,
        paas_environment: PAAS_ENVIRONMENT,
        db_connection_pooled: DB_CONNECTION_POOLED,
        ssl_enforced: SSL_ENFORCED,
        total_records: result.rowCount,
        records: result.rows
      });
    } catch (err) {
      console.error('[AUDIT_FAILURE]', err.code, err.message);
      return sendJson(res, 500, { error: 'Audit query failed', code: err.code || 'UNKNOWN' });
    } finally {
      if (client) client.release();
    }
  }

  return sendJson(res, 404, { error: 'Route Not Found' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[STARTUP] Server bound to 0.0.0.0:${PORT} | PID: ${process.pid}`);
});

// ---------------------------------------------------------------------------
// 4. Kernel Signal Trapping (SIGTERM / SIGINT) for graceful pool teardown
// ---------------------------------------------------------------------------
let shuttingDown = false;

const gracefulShutdown = (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[SIGNAL] Intercepted ${signal}. Draining HTTP server and PostgreSQL pool...`);

  // Safety net: force exit if draining hangs longer than 10s
  const forceExit = setTimeout(() => {
    console.error('[SHUTDOWN_TIMEOUT] Forcing exit after 10s.');
    process.exit(1);
  }, 10000);
  forceExit.unref();

  server.close(async () => {
    try {
      await pool.end();
      console.log('[SHUTDOWN] PostgreSQL Connection Pool closed cleanly. Exiting 0.');
      process.exit(0);
    } catch (err) {
      console.error('[SHUTDOWN_ERROR]', err.message);
      process.exit(1);
    }
  });
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));