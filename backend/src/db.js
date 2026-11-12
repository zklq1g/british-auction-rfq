const { Pool, types } = require('pg');

// DATE -> 'YYYY-MM-DD' string, preventing UTC timezone shifts
types.setTypeParser(1082, (v) => v);

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query: (text, params) => pool.query(text, params), withTransaction };
