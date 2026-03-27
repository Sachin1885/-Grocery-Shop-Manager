const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function initDb() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Create users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        mobile TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        password_plain TEXT,
        status TEXT DEFAULT 'active',
        is_admin BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create items table
    await client.query(`
      CREATE TABLE IF NOT EXISTS items (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        unit TEXT NOT NULL,
        price DECIMAL(10, 2) NOT NULL DEFAULT 0,
        stock DECIMAL(10, 2) NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, name)
      );
    `);

    // Create sales table
    await client.query(`
      CREATE TABLE IF NOT EXISTS sales (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        customer_id INTEGER DEFAULT NULL,
        payment_mode TEXT DEFAULT 'cash',
        total_amount DECIMAL(12, 2) NOT NULL,
        sold_at TIMESTAMP NOT NULL
      );
    `);

    // Create sale_lines table
    await client.query(`
      CREATE TABLE IF NOT EXISTS sale_lines (
        id SERIAL PRIMARY KEY,
        sale_id INTEGER REFERENCES sales(id) ON DELETE CASCADE,
        item_id INTEGER NOT NULL,
        item_name TEXT NOT NULL,
        unit TEXT NOT NULL,
        qty DECIMAL(10, 2) NOT NULL,
        unit_price DECIMAL(10, 2) NOT NULL,
        line_total DECIMAL(12, 2) NOT NULL
      );
    `);

    // Create customers table
    await client.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        mobile TEXT,
        total_udhaar DECIMAL(12, 2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create udhaar_transactions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS udhaar_transactions (
        id SERIAL PRIMARY KEY,
        customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
        sale_id INTEGER REFERENCES sales(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        amount DECIMAL(12, 2) NOT NULL,
        note TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Seed admin user
    const adminName = "Sachin Yadav";
    const adminPass = "Radhe01@";
    const adminMobile = "9999999999";
    
    const existing = await client.query("SELECT id FROM users WHERE name = $1 OR mobile = $2", [adminName, adminMobile]);
    if (existing.rows.length === 0) {
      const hash = bcrypt.hashSync(adminPass, 10);
      await client.query("INSERT INTO users (name, mobile, password_hash, password_plain, is_admin) VALUES ($1, $2, $3, $4, TRUE)", [adminName, adminMobile, hash, adminPass]);
      console.log("Admin user seeded.");
    } else {
      await client.query("UPDATE users SET is_admin = TRUE, password_plain = $1 WHERE name = $2", [adminPass, adminName]);
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error("Database initialization failed:", e);
    throw e;
  } finally {
    client.release();
  }
}

module.exports = {
  pool,
  initDb
};
