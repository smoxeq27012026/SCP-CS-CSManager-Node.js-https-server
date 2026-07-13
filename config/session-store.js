const pg = require('pg');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);

console.log('DATABASE_URL exists:', !!process.env.DATABASE_URL);
console.log('DATABASE_URL starts with:', process.env.DATABASE_URL?.substring(0, 30));

let pool;
try {
  pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  
  // Проверяем подключение при старте
  pool.connect((err, client, release) => {
    if (err) {
      console.error('❌ Database connection error:', err.message);
      console.error('Full error:', err);
    } else {
      console.log('✅ Database connected successfully!');
      release();
    }
  });
} catch (err) {
  console.error('❌ Pool creation error:', err);
  // Создаём фейковый пул, чтобы приложение не падало
  pool = {
    connect: (cb) => cb(new Error('Database not available')),
    query: (text, params, cb) => cb(new Error('Database not available')),
    end: () => {}
  };
}

module.exports = new pgSession({
  pool: pool,
  tableName: 'session',
  createTableIfMissing: false,
});
