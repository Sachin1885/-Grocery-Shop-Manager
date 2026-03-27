require("dotenv").config();
const path = require("path");
const os = require("os");
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { pool, initDb } = require("./db");

const app = express();
const port = Number(process.env.PORT || 4000);
const host = process.env.HOST || "0.0.0.0";
const JWT_SECRET = process.env.JWT_SECRET || "super-secret-key";
const webRoot = path.join(__dirname, "..");

app.use(cors());
app.use(express.json());

// Initialize Database
initDb().then(() => {
  console.log("Database initialized successfully.");
}).catch(err => {
  console.error("Database initialization failed:", err);
  process.exit(1);
});

// Middleware to verify JWT
async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'Access token required' });

  jwt.verify(token, JWT_SECRET, async (err, decoded) => {
    if (err) return res.status(403).json({ message: 'Invalid token' });
    
    try {
      const result = await pool.query("SELECT status, is_admin FROM users WHERE id = $1", [decoded.id]);
      const user = result.rows[0];
      if (!user) return res.status(401).json({ message: 'User no longer exists' });
      if (user.status === 'inactive') return res.status(403).json({ message: 'Account is inactive. Contact Admin.' });
      
      req.user = { ...decoded, is_admin: !!user.is_admin };
      next();
    } catch (dbErr) {
      res.status(500).json({ message: 'Auth database error' });
    }
  });
}

// Middleware for Admin only
function requireAdmin(req, res, next) {
  if (!req.user || !req.user.is_admin) {
    return res.status(403).json({ message: 'Admin access required.' });
  }
  next();
}

// Auth routes
app.post("/api/auth/register", async (req, res) => {
  const { name, mobile, password } = req.body;
  if (!name || !mobile || !password) {
    return res.status(400).json({ message: "All fields are required." });
  }
  if (!/^\d{10}$/.test(mobile)) {
    return res.status(400).json({ message: "Valid 10-digit mobile number required." });
  }
  if (password.length < 6) {
    return res.status(400).json({ message: "Password must be at least 6 characters long." });
  }

  try {
    const existingResult = await pool.query("SELECT id FROM users WHERE mobile = $1", [mobile]);
    if (existingResult.rows.length > 0) {
      return res.status(400).json({ message: "Mobile number already registered" });
    }

    const countResult = await pool.query("SELECT COUNT(*) as count FROM users");
    const isAdmin = parseInt(countResult.rows[0].count) === 0;

    const passwordHash = bcrypt.hashSync(password, 10);
    const result = await pool.query(
      "INSERT INTO users (name, mobile, password_hash, password_plain, is_admin) VALUES ($1, $2, $3, $4, $5) RETURNING id",
      [name.trim(), mobile, passwordHash, password, isAdmin]
    );

    const token = jwt.sign({ id: result.rows[0].id, name, mobile, is_admin: isAdmin }, JWT_SECRET, { expiresIn: '24h' });
    res.status(201).json({ token, is_admin: isAdmin, message: "Registration successful" });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({ message: "Registration failed." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const identity = (req.body.identity || req.body.login || "").trim();
  const password = req.body.password;
  if (!identity || !password) {
    return res.status(400).json({ message: "Login and password required." });
  }

  try {
    const userResult = await pool.query(
      "SELECT id, name, mobile, password_hash, status, is_admin FROM users WHERE mobile = $1 OR LOWER(name) = LOWER($2)",
      [identity, identity]
    );
    const user = userResult.rows[0];
    if (!user) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    if (user.status === 'inactive') {
      return res.status(403).json({ message: "Account is inactive. Please contact administrator." });
    }

    const valid = bcrypt.compareSync(password, user.password_hash);
    if (!valid) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign({ id: user.id, name: user.name, mobile: user.mobile, is_admin: !!user.is_admin }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, is_admin: !!user.is_admin });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ message: "Login failed." });
  }
});

app.get("/api/auth/me", authenticateToken, (req, res) => {
  res.json({ 
    id: req.user.id, 
    name: req.user.name, 
    mobile: req.user.mobile, 
    is_admin: req.user.is_admin 
  });
});

app.post("/api/auth/change-password", authenticateToken, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const userId = req.user.id;

  if (!currentPassword || !newPassword || newPassword.length < 6) {
    return res.status(400).json({ message: "Invalid password data." });
  }

  try {
    const userResult = await pool.query("SELECT password_hash FROM users WHERE id = $1", [userId]);
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ message: "User not found." });

    const valid = bcrypt.compareSync(currentPassword, user.password_hash);
    if (!valid) return res.status(400).json({ message: "Current password galat hai." });

    const newHash = bcrypt.hashSync(newPassword, 10);
    await pool.query("UPDATE users SET password_hash = $1, password_plain = $2 WHERE id = $3", [newHash, newPassword, userId]);
    res.json({ message: "Password successfully change ho gaya." });
  } catch (error) {
    res.status(500).json({ message: "Password change fail hua." });
  }
});

app.post("/api/auth/forgot-password", async (req, res) => {
  const { mobile, name, newPassword } = req.body;
  if (!mobile || !name || !newPassword || newPassword.length < 6) {
    return res.status(400).json({ message: "Sahi details bhariye." });
  }

  try {
    const userResult = await pool.query("SELECT id FROM users WHERE mobile = $1 AND LOWER(name) = LOWER($2)", [mobile, name.trim()]);
    const user = userResult.rows[0];
    if (!user) {
      return res.status(404).json({ message: "Details match nahi hui. Mobile aur Name check karein." });
    }

    const newHash = bcrypt.hashSync(newPassword, 10);
    await pool.query("UPDATE users SET password_hash = $1, password_plain = $2 WHERE id = $3", [newHash, newPassword, user.id]);
    res.json({ message: "Password reset ho gaya. Ab login karein." });
  } catch (error) {
    res.status(500).json({ message: "Password reset fail hua." });
  }
});

// Admin Panel API Endpoints
app.get("/api/admin/users", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const usersResult = await pool.query(
      "SELECT id, name, mobile, status, is_admin, password_plain, created_at FROM users WHERE id != $1 ORDER BY created_at DESC",
      [req.user.id]
    );
    res.json(usersResult.rows);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch users" });
  }
});

app.patch("/api/admin/users/:userId/status", authenticateToken, requireAdmin, async (req, res) => {
  const userId = Number(req.params.userId);
  const { status } = req.body;
  if (!['active', 'inactive'].includes(status)) {
    return res.status(400).json({ message: "Invalid status value." });
  }
  try {
    const result = await pool.query("UPDATE users SET status = $1 WHERE id = $2", [status, userId]);
    if (result.rowCount === 0) return res.status(404).json({ message: "User not found." });
    res.json({ message: `User status updated to ${status}.` });
  } catch (err) {
    res.status(500).json({ message: "Failed to update user status." });
  }
});

app.patch("/api/admin/users/:userId/password", authenticateToken, requireAdmin, async (req, res) => {
  const userId = Number(req.params.userId);
  const { password } = req.body;
  if (!password || password.length < 6) {
    return res.status(400).json({ message: "Password must be at least 6 characters long." });
  }
  try {
    const passwordHash = bcrypt.hashSync(password, 10);
    const result = await pool.query("UPDATE users SET password_hash = $1, password_plain = $2 WHERE id = $3", [passwordHash, password, userId]);
    if (result.rowCount === 0) return res.status(404).json({ message: "User not found." });
    res.json({ message: "Password updated successfully." });
  } catch (err) {
    res.status(500).json({ message: "Failed to update password." });
  }
});

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, message: "Database connection failed." });
  }
});

app.get("/api/items", authenticateToken, async (req, res) => {
  try {
    const itemsResult = await pool.query("SELECT id, name, unit, price, stock FROM items WHERE user_id = $1 ORDER BY name ASC", [req.user.id]);
    res.json(itemsResult.rows);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch items" });
  }
});

app.post("/api/items", authenticateToken, async (req, res) => {
  const { name, unit } = req.body;
  const price = Number(req.body.price);
  const stock = Number(req.body.stock);

  if (!name || !unit || Number.isNaN(price) || price < 0 || Number.isNaN(stock) || stock < 0) {
    return res.status(400).json({ message: "Invalid item payload. Price and stock must be numbers." });
  }
  const cleanName = name.trim();
  try {
    const existingResult = await pool.query("SELECT id, stock FROM items WHERE user_id = $1 AND LOWER(name) = LOWER($2)", [req.user.id, cleanName]);
    if (existingResult.rows.length > 0) {
      return res.status(400).json({ message: `Item "${cleanName}" pehle se hi stock mein hai. Uska stock edit karein.` });
    }
    const result = await pool.query(
      "INSERT INTO items (user_id, name, unit, price, stock) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, unit, price, stock",
      [req.user.id, cleanName, unit, price, stock]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Item creation error:", error);
    res.status(500).json({ message: "Failed to create item" });
  }
});

app.patch("/api/items/:id/price", authenticateToken, async (req, res) => {
  const id = Number(req.params.id);
  const price = Number(req.body.price);
  if (!id || Number.isNaN(price) || price < 0) {
    return res.status(400).json({ message: "Invalid price payload." });
  }
  try {
    const result = await pool.query(
      "UPDATE items SET price = $1 WHERE id = $2 AND user_id = $3 RETURNING id, name, unit, price, stock",
      [price, id, req.user.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ message: "Item not found." });
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ message: "Failed to update price" });
  }
});

app.patch("/api/items/:id/stock", authenticateToken, async (req, res) => {
  const id = Number(req.params.id);
  const stock = Number(req.body.stock);
  if (!id || Number.isNaN(stock) || stock < 0) {
    return res.status(400).json({ message: "Invalid stock payload." });
  }
  try {
    const result = await pool.query(
      "UPDATE items SET stock = $1 WHERE id = $2 AND user_id = $3 RETURNING id, name, unit, price, stock",
      [stock, id, req.user.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ message: "Item not found." });
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ message: "Failed to update stock" });
  }
});

app.delete("/api/items/:id", authenticateToken, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ message: "Invalid item id." });
  try {
    const result = await pool.query("DELETE FROM items WHERE id = $1 AND user_id = $2", [id, req.user.id]);
    if (result.rowCount === 0) return res.status(404).json({ message: "Item not found." });
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ message: "Failed to delete item" });
  }
});

app.get("/api/sales/today", authenticateToken, async (req, res) => {
  const date = req.query.date || 'now';
  try {
    const dateFilter = date === 'now' ? "CURRENT_DATE" : `'${date}'::date`;
    const query = `
      SELECT COUNT(*) AS bills, COALESCE(SUM(total_amount), 0) AS total 
      FROM sales 
      WHERE user_id = $1 AND sold_at::date = ${dateFilter}
    `;
    const result = await pool.query(query, [req.user.id]);
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Sales summary error:", error);
    res.status(500).json({ message: "Failed to fetch sales summary" });
  }
});

app.get("/api/sales/today/bills", authenticateToken, async (req, res) => {
  const date = req.query.date || 'now';
  try {
    const dateFilter = date === 'now' ? "CURRENT_DATE" : `'${date}'::date`;
    const salesResult = await pool.query(
      `SELECT id, total_amount, sold_at, payment_mode FROM sales WHERE user_id = $1 AND sold_at::date = ${dateFilter} ORDER BY sold_at DESC`,
      [req.user.id]
    );
    
    const bills = [];
    for (const sale of salesResult.rows) {
      const linesResult = await pool.query(
        "SELECT item_name, unit, qty, unit_price, line_total FROM sale_lines WHERE sale_id = $1 ORDER BY id ASC",
        [sale.id]
      );
      bills.push({
        saleId: sale.id,
        totalAmount: Number(sale.total_amount),
        soldAt: sale.sold_at,
        paymentMode: sale.payment_mode,
        lines: linesResult.rows.map(l => ({
          itemName: l.item_name,
          unit: l.unit,
          qty: Number(l.qty),
          unitPrice: Number(l.unit_price),
          lineTotal: Number(l.line_total)
        }))
      });
    }
    res.json(bills);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch today's bills" });
  }
});

app.get("/api/sales/:saleId/receipt", authenticateToken, async (req, res) => {
  const saleId = Number(req.params.saleId);
  if (!saleId) return res.status(400).json({ message: "Invalid sale ID." });
  
  try {
    const saleResult = await pool.query(
      "SELECT id, total_amount, sold_at, payment_mode FROM sales WHERE id = $1 AND user_id = $2",
      [saleId, req.user.id]
    );
    const sale = saleResult.rows[0];
    
    if (!sale) {
      return res.status(404).json({ message: "Sale not found." });
    }
    
    const linesResult = await pool.query(
      "SELECT item_name, unit, qty, unit_price, line_total FROM sale_lines WHERE sale_id = $1 ORDER BY id ASC",
      [saleId]
    );
    
    res.json({
      saleId: sale.id,
      totalAmount: Number(sale.total_amount),
      soldAt: sale.sold_at,
      paymentMode: sale.payment_mode,
      lines: linesResult.rows.map(l => ({
        itemName: l.item_name,
        unit: l.unit,
        qty: Number(l.qty),
        unitPrice: Number(l.unit_price),
        lineTotal: Number(l.line_total)
      }))
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch receipt" });
  }
});

// Customers & Udhaar API
app.get("/api/customers", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM customers WHERE user_id = $1 ORDER BY name ASC", [req.user.id]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch customers" });
  }
});

app.post("/api/customers", authenticateToken, async (req, res) => {
  const { name, mobile } = req.body;
  if (!name) return res.status(400).json({ message: "Customer name is required." });
  try {
    const result = await pool.query(
      "INSERT INTO customers (user_id, name, mobile) VALUES ($1, $2, $3) RETURNING *",
      [req.user.id, name.trim(), mobile || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ message: "Failed to create customer" });
  }
});

app.get("/api/customers/:id/transactions", authenticateToken, async (req, res) => {
  const customerId = Number(req.params.id);
  try {
    // Verify customer belongs to user
    const customerCheck = await pool.query("SELECT id FROM customers WHERE id = $1 AND user_id = $2", [customerId, req.user.id]);
    if (customerCheck.rowCount === 0) return res.status(404).json({ message: "Customer not found." });

    const result = await pool.query("SELECT * FROM udhaar_transactions WHERE customer_id = $1 ORDER BY created_at DESC", [customerId]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch transactions" });
  }
});

app.post("/api/customers/:id/pay", authenticateToken, async (req, res) => {
  const customerId = Number(req.params.id);
  const { amount, note } = req.body;
  const payAmount = Number(amount);
  if (Number.isNaN(payAmount) || payAmount <= 0) return res.status(400).json({ message: "Invalid amount." });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Verify customer belongs to user
    const customerCheck = await client.query("SELECT id FROM customers WHERE id = $1 AND user_id = $2", [customerId, req.user.id]);
    if (customerCheck.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: "Customer not found." });
    }

    await client.query("INSERT INTO udhaar_transactions (customer_id, type, amount, note) VALUES ($1, 'credit', $2, $3)", [customerId, payAmount, note || 'Payment received']);
    const result = await client.query("UPDATE customers SET total_udhaar = total_udhaar - $1 WHERE id = $2 RETURNING *", [payAmount, customerId]);
    
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ message: "Failed to process payment" });
  } finally {
    client.release();
  }
});

app.post("/api/sales", authenticateToken, async (req, res) => {
  const lines = Array.isArray(req.body.lines) ? req.body.lines : [];
  const paymentMode = req.body.paymentMode || 'cash';
  const customerId = req.body.customerId ? Number(req.body.customerId) : null;

  if (!lines.length) return res.status(400).json({ message: "Bill is empty." });
  if (paymentMode === 'udhaar' && !customerId) {
    return res.status(400).json({ message: "Udhaar ke liye customer chunna zaroori hai." });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let total = 0;
    const resolved = [];
    for (const line of lines) {
      const itemId = Number(line.itemId);
      const qty = Number(line.qty);
      const lineUnit = line.unit;
      
      if (!itemId || Number.isNaN(qty) || qty <= 0) {
        throw new Error("Invalid billing line.");
      }
      
      const itemResult = await client.query("SELECT id, name, unit, price, stock FROM items WHERE id = $1 AND user_id = $2", [itemId, req.user.id]);
      const item = itemResult.rows[0];
      if (!item) throw new Error("Item not found.");
      
      let baseQty = qty;
      let displayUnit = lineUnit || item.unit;
      
      if (item.unit === 'kg' && lineUnit === 'gram') {
        baseQty = qty / 1000;
      } else if (item.unit === 'gram' && lineUnit === 'kg') {
        baseQty = qty * 1000;
      }
      
      if (baseQty > Number(item.stock)) {
        throw new Error(`Stock kam hai: ${item.name} (${item.stock} ${item.unit} available)`);
      }
      
      const lineTotal = Number(item.price) * baseQty;
      total += lineTotal;
      
      resolved.push({
        itemId,
        name: item.name,
        unit: displayUnit,
        qty: qty,
        baseQty: baseQty,
        price: Number(item.price) * (baseQty / qty),
        lineTotal,
      });
    }

    // Update stock
    for (const line of resolved) {
      await client.query("UPDATE items SET stock = stock - $1 WHERE id = $2 AND user_id = $3", [line.baseQty, line.itemId, req.user.id]);
    }
    
    // Insert sale
    const saleResult = await client.query(
      "INSERT INTO sales (user_id, customer_id, payment_mode, total_amount, sold_at) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP) RETURNING id",
      [req.user.id, customerId, paymentMode, total]
    );
    const saleId = saleResult.rows[0].id;
    
    // Insert lines
    for (const line of resolved) {
      await client.query(
        "INSERT INTO sale_lines (sale_id, item_id, item_name, unit, qty, unit_price, line_total) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [saleId, line.itemId, line.name, line.unit, line.qty, line.price, line.lineTotal]
      );
    }

    // If Udhaar, update customer balance
    if (paymentMode === 'udhaar' && customerId) {
      await client.query("INSERT INTO udhaar_transactions (customer_id, sale_id, type, amount, note) VALUES ($1, $2, 'debit', $3, $4)", [customerId, saleId, total, `Bill #${saleId}`]);
      await client.query("UPDATE customers SET total_udhaar = total_udhaar + $1 WHERE id = $2 AND user_id = $3", [total, customerId, req.user.id]);
    }
    
    await client.query('COMMIT');
    res.status(201).json({ saleId, grandTotal: total });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(400).json({ message: error.message || "Sale failed." });
  } finally {
    client.release();
  }
});

app.use((error, _req, res, _next) => {
  res.status(500).json({ message: error.message || "Unexpected server error." });
});

app.use("/css", express.static(path.join(webRoot, "css")));
app.use("/js", express.static(path.join(webRoot, "js")));

app.get("/", (_req, res) => {
  res.sendFile(path.join(webRoot, "dashboard.html"));
});
app.get("/dashboard.html", (_req, res) => {
  res.sendFile(path.join(webRoot, "dashboard.html"));
});
app.get("/index.html", (_req, res) => {
  res.sendFile(path.join(webRoot, "index.html"));
});
app.get("/admin.html", (_req, res) => {
  res.sendFile(path.join(webRoot, "admin.html"));
});
for (const file of ["manifest.json", "sw.js", "icon.svg"]) {
  app.get(`/${file}`, (_req, res) => {
    res.sendFile(path.join(webRoot, file));
  });
}

function lanIpv4s() {
  const out = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) {
      const v4 = a.family === "IPv4" || a.family === 4;
      if (v4 && !a.internal) out.push(a.address);
    }
  }
  return out;
}

const server = app.listen(port, host, () => {
  console.log(`Server: http://localhost:${port}/  (API + web app)`);
  const ips = lanIpv4s();
  if (ips.length) {
    console.log("Phone (same Wi‑Fi) — http use karein, https nahi:");
    for (const ip of ips) console.log(`  http://${ip}:${port}/`);
  }
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\n[!] Port ${port} pehle se use ho raha hai.\n`);
    process.exit(1);
  }
  console.error(err);
  process.exit(1);
});
