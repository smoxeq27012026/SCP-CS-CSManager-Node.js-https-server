const pg = require('pg');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

module.exports = new pgSession({
  pool: pool,
  tableName: 'session',
  createTableIfMissing: false,
});