const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const EmbeddedPostgres = require('embedded-postgres').default;

const DB_DIR = path.resolve(__dirname, 'pgdata');
const PORT = 5432;
const USER = 'postgres';
const PASSWORD = 'password';

async function initAndRun() {
  const pg = new EmbeddedPostgres({
    port: PORT,
    databaseDir: DB_DIR,
    user: USER,
    password: PASSWORD,
    persistent: true,
  });

  if (!fs.existsSync(DB_DIR)) {
    console.log('[DB] Initializing new cluster in ' + DB_DIR);
    await pg.initialise();
  }

  console.log('[DB] Starting PostgreSQL on port ' + PORT + '...');
  await pg.start();
  console.log('[DB] PostgreSQL is running on port ' + PORT);

  // Connect to default 'postgres' database to ensure 'rfq' and 'rfq_test' exist
  const rootPool = new Pool({
    connectionString: `postgres://${USER}:${PASSWORD}@localhost:${PORT}/postgres`,
  });

  async function ensureDb(dbName) {
    const { rows } = await rootPool.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [dbName]
    );
    if (rows.length === 0) {
      console.log(`[DB] Creating database "${dbName}"...`);
      await rootPool.query(`CREATE DATABASE ${dbName}`);
    }
  }

  try {
    await ensureDb('rfq');
    await ensureDb('rfq_test');
  } catch (err) {
    console.error('[DB] Error checking/creating databases:', err.message);
  } finally {
    await rootPool.end();
  }

  // Apply schema to rfq
  const schemaPath = path.resolve(__dirname, '../db/schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');

  async function initSchema(dbName) {
    const clientPool = new Pool({
      connectionString: `postgres://${USER}:${PASSWORD}@localhost:${PORT}/${dbName}`,
    });
    try {
      const { rows } = await clientPool.query(
        "SELECT 1 FROM information_schema.tables WHERE table_name = 'rfqs'"
      );
      if (rows.length === 0) {
        console.log(`[DB] Executing schema.sql on "${dbName}"...`);
        await clientPool.query(schemaSql);
        console.log(`[DB] Schema initialized successfully for "${dbName}"!`);
      } else {
        console.log(`[DB] "${dbName}" already contains tables.`);
      }
    } catch (e) {
      console.error(`[DB] Error initializing schema for ${dbName}:`, e.message);
    } finally {
      await clientPool.end();
    }
  }

  await initSchema('rfq');
  await initSchema('rfq_test');

  console.log('[DB] Databases rfq and rfq_test are ready!');

  // Keep process alive
  process.on('SIGINT', async () => {
    console.log('[DB] Stopping PostgreSQL...');
    await pg.stop();
    process.exit(0);
  });
}

initAndRun().catch((err) => {
  console.error('[DB] Fatal error:', err);
  process.exit(1);
});
