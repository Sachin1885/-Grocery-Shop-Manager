const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Master DB stores users only
const masterDbPath = path.join(dataDir, 'master.db');
const masterDb = new Database(masterDbPath);
masterDb.pragma('journal_mode = WAL');

const bcrypt = require('bcrypt');

// Initialize Master DB
masterDb.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    mobile TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    password_plain TEXT, -- Store plain text for Admin convenience (Security Risk but requested)
    status TEXT DEFAULT 'active', -- 'active' or 'inactive'
    is_admin INTEGER DEFAULT 0, -- 1 for admin, 0 for shop owner
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Add columns if they don't exist (for existing DBs)
try {
  const info = masterDb.prepare("PRAGMA table_info(users)").all();
  if (!info.some(c => c.name === 'status')) {
    masterDb.exec("ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'active'");
  }
  if (!info.some(c => c.name === 'is_admin')) {
    masterDb.exec("ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0");
  }
  if (!info.some(c => c.name === 'password_plain')) {
    masterDb.exec("ALTER TABLE users ADD COLUMN password_plain TEXT");
  }
  
  // Seed admin user
  const adminName = "Sachin Yadav";
  const adminPass = "Radhe01@";
  const adminMobile = "9999999999"; // Master admin number
  
  const existing = masterDb.prepare("SELECT id FROM users WHERE name = ? OR mobile = ?").get(adminName, adminMobile);
  if (!existing) {
    const hash = bcrypt.hashSync(adminPass, 10);
    masterDb.prepare("INSERT INTO users (name, mobile, password_hash, password_plain, is_admin) VALUES (?, ?, ?, ?, 1)").run(adminName, adminMobile, hash, adminPass);
    console.log("Admin user seeded.");
  } else {
    // Ensure existing user is admin if it's Sachin Yadav
    masterDb.prepare("UPDATE users SET is_admin = 1, password_plain = ? WHERE name = ?").run(adminPass, adminName);
  }
} catch (e) {
  console.error("Master DB upgrade failed:", e);
}

// Cache user DB connections to avoid reopening
const userDbs = new Map();

function getUserDb(userId) {
  if (!userId) throw new Error("User ID is required for DB access.");
  
  if (userDbs.has(userId)) {
    return userDbs.get(userId);
  }

  const userDbPath = path.join(dataDir, `user_${userId}.db`);
  const db = new Database(userDbPath);
  db.pragma('journal_mode = WAL');

  // Initialize client specific schema (no user_id needed here anymore since it's a separate file)
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      unit TEXT NOT NULL,
      price DECIMAL(10, 2) NOT NULL DEFAULT 0,
      stock DECIMAL(10, 2) NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(name)
    );

    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER DEFAULT NULL,
      payment_mode TEXT DEFAULT 'cash', -- 'cash' or 'udhaar'
      total_amount DECIMAL(12, 2) NOT NULL,
      sold_at DATETIME NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sale_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL,
      item_id INTEGER NOT NULL,
      item_name TEXT NOT NULL,
      unit TEXT NOT NULL,
      qty DECIMAL(10, 2) NOT NULL,
      unit_price DECIMAL(10, 2) NOT NULL,
      line_total DECIMAL(12, 2) NOT NULL,
      FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      mobile TEXT,
      total_udhaar DECIMAL(12, 2) DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS udhaar_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      sale_id INTEGER, -- NULL if it's a direct payment/adjustment
      type TEXT NOT NULL, -- 'debit' (udhaar liya) or 'credit' (jama kiya)
      amount DECIMAL(12, 2) NOT NULL,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
    );
  `);

  // Migration: Add columns to existing sales table if they don't exist
  try {
    const info = db.prepare("PRAGMA table_info(sales)").all();
    if (!info.some(c => c.name === 'customer_id')) {
      db.exec("ALTER TABLE sales ADD COLUMN customer_id INTEGER DEFAULT NULL");
    }
    if (!info.some(c => c.name === 'payment_mode')) {
      db.exec("ALTER TABLE sales ADD COLUMN payment_mode TEXT DEFAULT 'cash'");
    }
  } catch (e) {
    console.error("User DB migration failed:", e);
  }

  userDbs.set(userId, db);
  return db;
}

module.exports = {
  masterDb,
  getUserDb
};
