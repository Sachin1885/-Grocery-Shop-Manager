require("dotenv").config();
const path = require("path");
const os = require("os");
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { masterDb, getUserDb } = require("./db");
const { sendOTP } = require("./sms-service");

const app = express();
const port = Number(process.env.PORT || 4000);
const host = process.env.HOST || "0.0.0.0";
const JWT_SECRET = process.env.JWT_SECRET || "super-secret-key";
const webRoot = path.join(__dirname, "..");

app.use(cors());
app.use(express.json());

// Middleware to verify JWT
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'Access token required' });

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).json({ message: 'Invalid token' });
    
    // Check if user is still active in master DB
    try {
      const user = masterDb.prepare("SELECT status, is_admin FROM users WHERE id = ?").get(decoded.id);
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
app.post("/api/auth/register", (req, res) => {
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
    const existing = masterDb.prepare("SELECT id FROM users WHERE mobile = ?").get(mobile);
    if (existing) {
      return res.status(400).json({ message: "Mobile number already registered" });
    }

    // First user is automatically Admin
    const userCount = masterDb.prepare("SELECT COUNT(*) as count FROM users").get().count;
    const isAdmin = userCount === 0 ? 1 : 0;

    const passwordHash = bcrypt.hashSync(password, 10);
    const result = masterDb.prepare("INSERT INTO users (name, mobile, password_hash, password_plain, is_admin) VALUES (?, ?, ?, ?, ?)").run(name.trim(), mobile, passwordHash, password, isAdmin);

    const token = jwt.sign({ id: result.lastInsertRowid, name, mobile, is_admin: !!isAdmin }, JWT_SECRET, { expiresIn: '24h' });
    res.status(201).json({ token, is_admin: !!isAdmin, message: "Registration successful" });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({ message: "Registration failed." });
  }
});

app.post("/api/auth/login", (req, res) => {
  const identity = (req.body.identity || req.body.login || "").trim();
  const password = req.body.password;
  if (!identity || !password) {
    return res.status(400).json({ message: "Login and password required." });
  }

  try {
    const user = masterDb.prepare("SELECT id, name, mobile, password_hash, status, is_admin FROM users WHERE mobile = ? OR LOWER(name) = LOWER(?)").get(identity, identity);
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

app.post("/api/auth/change-password", authenticateToken, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const userId = req.user.id;

  if (!currentPassword || !newPassword || newPassword.length < 6) {
    return res.status(400).json({ message: "Invalid password data." });
  }

  try {
    const user = masterDb.prepare("SELECT password_hash FROM users WHERE id = ?").get(userId);
    if (!user) return res.status(404).json({ message: "User not found." });

    const valid = bcrypt.compareSync(currentPassword, user.password_hash);
    if (!valid) return res.status(400).json({ message: "Current password galat hai." });

    const newHash = bcrypt.hashSync(newPassword, 10);
    masterDb.prepare("UPDATE users SET password_hash = ?, password_plain = ? WHERE id = ?").run(newHash, newPassword, userId);
    res.json({ message: "Password successfully change ho gaya." });
  } catch (error) {
    res.status(500).json({ message: "Password change fail hua." });
  }
});

app.post("/api/auth/forgot-password", (req, res) => {
  const { mobile, name, newPassword } = req.body;
  if (!mobile || !name || !newPassword || newPassword.length < 6) {
    return res.status(400).json({ message: "Sahi details bhariye." });
  }

  try {
    const user = masterDb.prepare("SELECT id FROM users WHERE mobile = ? AND LOWER(name) = LOWER(?)").get(mobile, name.trim());
    if (!user) {
      return res.status(404).json({ message: "Details match nahi hui. Mobile aur Name check karein." });
    }

    const newHash = bcrypt.hashSync(newPassword, 10);
    masterDb.prepare("UPDATE users SET password_hash = ?, password_plain = ? WHERE id = ?").run(newHash, newPassword, user.id);
    res.json({ message: "Password reset ho gaya. Ab login karein." });
  } catch (error) {
    res.status(500).json({ message: "Password reset fail hua." });
  }
});

// Admin Panel API Endpoints
app.get("/api/admin/users", authenticateToken, requireAdmin, (req, res) => {
  try {
    const users = masterDb.prepare("SELECT id, name, mobile, status, is_admin, password_plain, created_at FROM users WHERE id != ? ORDER BY created_at DESC").all(req.user.id);
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch users" });
  }
});

app.patch("/api/admin/users/:userId/status", authenticateToken, requireAdmin, (req, res) => {
  const userId = Number(req.params.userId);
  const { status } = req.body;
  if (!['active', 'inactive'].includes(status)) {
    return res.status(400).json({ message: "Invalid status value." });
  }
  try {
    const result = masterDb.prepare("UPDATE users SET status = ? WHERE id = ?").run(status, userId);
    if (result.changes === 0) return res.status(404).json({ message: "User not found." });
    res.json({ message: `User status updated to ${status}.` });
  } catch (err) {
    res.status(500).json({ message: "Failed to update user status." });
  }
});

app.patch("/api/admin/users/:userId/password", authenticateToken, requireAdmin, (req, res) => {
  const userId = Number(req.params.userId);
  const { password } = req.body;
  if (!password || password.length < 6) {
    return res.status(400).json({ message: "Password must be at least 6 characters long." });
  }
  try {
    const passwordHash = bcrypt.hashSync(password, 10);
    const result = masterDb.prepare("UPDATE users SET password_hash = ?, password_plain = ? WHERE id = ?").run(passwordHash, password, userId);
    if (result.changes === 0) return res.status(404).json({ message: "User not found." });
    res.json({ message: "Password updated successfully." });
  } catch (err) {
    res.status(500).json({ message: "Failed to update password." });
  }
});

app.get("/api/health", (_req, res) => {
  try {
    masterDb.prepare("SELECT 1").get();
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, message: "Database connection failed." });
  }
});

app.get("/api/items", authenticateToken, (req, res) => {
  try {
    const db = getUserDb(req.user.id);
    const items = db.prepare("SELECT id, name, unit, price, stock FROM items ORDER BY name ASC").all();
    res.json(items);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch items" });
  }
});

app.post("/api/items", authenticateToken, (req, res) => {
  const { name, unit } = req.body;
  const price = Number(req.body.price);
  const stock = Number(req.body.stock);

  if (!name || !unit || Number.isNaN(price) || price < 0 || Number.isNaN(stock) || stock < 0) {
    return res.status(400).json({ message: "Invalid item payload. Price and stock must be numbers." });
  }
  const cleanName = name.trim();
  try {
    const db = getUserDb(req.user.id);
    const existing = db.prepare("SELECT id, stock FROM items WHERE LOWER(name) = LOWER(?)").get(cleanName);
    if (existing) {
      return res.status(400).json({ message: `Item "${cleanName}" pehle se hi stock mein hai. Uska stock edit karein.` });
    }
    const result = db.prepare("INSERT INTO items (name, unit, price, stock) VALUES (?, ?, ?, ?)").run(cleanName, unit, price, stock);
    const item = db.prepare("SELECT id, name, unit, price, stock FROM items WHERE id = ?").get(result.lastInsertRowid);
    res.status(201).json(item);
  } catch (error) {
    console.error("Item creation error:", error);
    res.status(500).json({ message: "Failed to create item" });
  }
});

app.patch("/api/items/:id/price", authenticateToken, (req, res) => {
  const id = Number(req.params.id);
  const price = Number(req.body.price);
  if (!id || Number.isNaN(price) || price < 0) {
    return res.status(400).json({ message: "Invalid price payload." });
  }
  try {
    const db = getUserDb(req.user.id);
    const result = db.prepare("UPDATE items SET price = ? WHERE id = ?").run(price, id);
    if (result.changes === 0) return res.status(404).json({ message: "Item not found." });
    const item = db.prepare("SELECT id, name, unit, price, stock FROM items WHERE id = ?").get(id);
    res.json(item);
  } catch (error) {
    res.status(500).json({ message: "Failed to update price" });
  }
});

app.patch("/api/items/:id/stock", authenticateToken, (req, res) => {
  const id = Number(req.params.id);
  const stock = Number(req.body.stock);
  if (!id || Number.isNaN(stock) || stock < 0) {
    return res.status(400).json({ message: "Invalid stock payload." });
  }
  try {
    const db = getUserDb(req.user.id);
    const result = db.prepare("UPDATE items SET stock = ? WHERE id = ?").run(stock, id);
    if (result.changes === 0) return res.status(404).json({ message: "Item not found." });
    const item = db.prepare("SELECT id, name, unit, price, stock FROM items WHERE id = ?").get(id);
    res.json(item);
  } catch (error) {
    res.status(500).json({ message: "Failed to update stock" });
  }
});

app.delete("/api/items/:id", authenticateToken, (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ message: "Invalid item id." });
  try {
    const db = getUserDb(req.user.id);
    const result = db.prepare("DELETE FROM items WHERE id = ?").run(id);
    if (result.changes === 0) return res.status(404).json({ message: "Item not found." });
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ message: "Failed to delete item" });
  }
});

app.get("/api/sales/today", authenticateToken, (req, res) => {
  const date = req.query.date || 'now';
  try {
    const db = getUserDb(req.user.id);
    const dateFilter = date === 'now' ? "DATE('now')" : `DATE('${date}')`;
    const result = db.prepare(`SELECT COUNT(*) AS bills, COALESCE(SUM(total_amount), 0) AS total FROM sales WHERE DATE(sold_at) = ${dateFilter}`).get();
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch sales summary" });
  }
});

app.get("/api/sales/today/bills", authenticateToken, (req, res) => {
  const date = req.query.date || 'now';
  try {
    const db = getUserDb(req.user.id);
    const dateFilter = date === 'now' ? "DATE('now')" : `DATE('${date}')`;
    const sales = db.prepare(`SELECT id, total_amount, sold_at, payment_mode FROM sales WHERE DATE(sold_at) = ${dateFilter} ORDER BY sold_at DESC`).all();
    
    const bills = [];
    for (const sale of sales) {
      const lines = db.prepare("SELECT item_name, unit, qty, unit_price, line_total FROM sale_lines WHERE sale_id = ? ORDER BY id ASC").all(sale.id);
      bills.push({
        saleId: sale.id,
        totalAmount: Number(sale.total_amount),
        soldAt: sale.sold_at,
        paymentMode: sale.payment_mode,
        lines: lines.map(l => ({
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

app.get("/api/sales/:saleId/receipt", authenticateToken, (req, res) => {
  const saleId = Number(req.params.saleId);
  if (!saleId) return res.status(400).json({ message: "Invalid sale ID." });
  
  try {
    const db = getUserDb(req.user.id);
    const sale = db.prepare("SELECT id, total_amount, sold_at, payment_mode FROM sales WHERE id = ?").get(saleId);
    
    if (!sale) {
      return res.status(404).json({ message: "Sale not found." });
    }
    
    const lines = db.prepare("SELECT item_name, unit, qty, unit_price, line_total FROM sale_lines WHERE sale_id = ? ORDER BY id ASC").all(saleId);
    
    res.json({
      saleId: sale.id,
      totalAmount: Number(sale.total_amount),
      soldAt: sale.sold_at,
      paymentMode: sale.payment_mode,
      lines: lines.map(l => ({
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
app.get("/api/customers", authenticateToken, (req, res) => {
  try {
    const db = getUserDb(req.user.id);
    const customers = db.prepare("SELECT * FROM customers ORDER BY name ASC").all();
    res.json(customers);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch customers" });
  }
});

app.post("/api/customers", authenticateToken, (req, res) => {
  const { name, mobile } = req.body;
  if (!name) return res.status(400).json({ message: "Customer name is required." });
  try {
    const db = getUserDb(req.user.id);
    const result = db.prepare("INSERT INTO customers (name, mobile) VALUES (?, ?)").run(name.trim(), mobile || null);
    const customer = db.prepare("SELECT * FROM customers WHERE id = ?").get(result.lastInsertRowid);
    res.status(201).json(customer);
  } catch (error) {
    res.status(500).json({ message: "Failed to create customer" });
  }
});

app.get("/api/customers/:id/transactions", authenticateToken, (req, res) => {
  const customerId = Number(req.params.id);
  try {
    const db = getUserDb(req.user.id);
    const transactions = db.prepare("SELECT * FROM udhaar_transactions WHERE customer_id = ? ORDER BY created_at DESC").all(customerId);
    res.json(transactions);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch transactions" });
  }
});

app.post("/api/customers/:id/pay", authenticateToken, (req, res) => {
  const customerId = Number(req.params.id);
  const { amount, note } = req.body;
  const payAmount = Number(amount);
  if (Number.isNaN(payAmount) || payAmount <= 0) return res.status(400).json({ message: "Invalid amount." });

  try {
    const db = getUserDb(req.user.id);
    const transaction = db.transaction(() => {
      db.prepare("INSERT INTO udhaar_transactions (customer_id, type, amount, note) VALUES (?, 'credit', ?, ?)").run(customerId, payAmount, note || 'Payment received');
      db.prepare("UPDATE customers SET total_udhaar = total_udhaar - ? WHERE id = ?").run(payAmount, customerId);
      return db.prepare("SELECT * FROM customers WHERE id = ?").get(customerId);
    });
    const customer = transaction();
    res.json(customer);
  } catch (error) {
    res.status(500).json({ message: "Failed to process payment" });
  }
});

app.post("/api/sales", authenticateToken, (req, res) => {
  const lines = Array.isArray(req.body.lines) ? req.body.lines : [];
  const paymentMode = req.body.paymentMode || 'cash';
  const customerId = req.body.customerId ? Number(req.body.customerId) : null;

  if (!lines.length) return res.status(400).json({ message: "Bill is empty." });
  if (paymentMode === 'udhaar' && !customerId) {
    return res.status(400).json({ message: "Udhaar ke liye customer chunna zaroori hai." });
  }

  try {
    const db = getUserDb(req.user.id);
    const insertSale = db.prepare("INSERT INTO sales (customer_id, payment_mode, total_amount, sold_at) VALUES (?, ?, ?, datetime('now'))");
    const insertLine = db.prepare("INSERT INTO sale_lines (sale_id, item_id, item_name, unit, qty, unit_price, line_total) VALUES (?, ?, ?, ?, ?, ?, ?)");
    const updateStock = db.prepare("UPDATE items SET stock = stock - ? WHERE id = ?");

    let total = 0;
    const resolved = [];
    for (const line of lines) {
      const itemId = Number(line.itemId);
      const qty = Number(line.qty);
      const lineUnit = line.unit; // Get unit from request line
      
      if (!itemId || Number.isNaN(qty) || qty <= 0) {
        throw new Error("Invalid billing line.");
      }
      
      const item = db.prepare("SELECT id, name, unit, price, stock FROM items WHERE id = ?").get(itemId);
      if (!item) throw new Error("Item not found.");
      
      let baseQty = qty;
      let displayUnit = lineUnit || item.unit;
      
      // Conversion logic: if base is kg and user sells in gram
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
        qty: qty, // Store original qty for receipt
        baseQty: baseQty, // Store converted qty for stock
        price: Number(item.price) * (baseQty / qty), // Calculated unit price for the display unit
        lineTotal,
      });
    }

    // Use transaction
    const transaction = db.transaction(() => {
      // Update stock
      for (const line of resolved) {
        updateStock.run(line.baseQty, line.itemId);
      }
      
      // Insert sale
      const saleResult = insertSale.run(customerId, paymentMode, total);
      const saleId = saleResult.lastInsertRowid;
      
      // Insert lines
      for (const line of resolved) {
        insertLine.run(saleId, line.itemId, line.name, line.unit, line.qty, line.price, line.lineTotal);
      }

      // If Udhaar, update customer balance
      if (paymentMode === 'udhaar' && customerId) {
        db.prepare("INSERT INTO udhaar_transactions (customer_id, sale_id, type, amount, note) VALUES (?, ?, 'debit', ?, ?)").run(customerId, saleId, total, `Bill #${saleId}`);
        db.prepare("UPDATE customers SET total_udhaar = total_udhaar + ? WHERE id = ?").run(total, customerId);
      }
      
      return saleId;
    });
    
    const saleId = transaction();
    res.status(201).json({ saleId, grandTotal: total });
  } catch (error) {
    res.status(400).json({ message: error.message || "Sale failed." });
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
    console.log(
      "Agar phone se na khule: Windows Firewall → port 4000 allow karein, ya backend/open-firewall-4000.bat (Run as administrator)."
    );
    console.log(
      "Alag Wi‑Fi / mobile data: backend/REMOTE-ACCESS.txt (Tailscale = best; cloudflared = quick tunnel)."
    );
  }
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `\n[!] Port ${port} pehle se use ho raha hai.\n` +
        `    → Jis terminal me pehle server chal raha hai, wahan Ctrl+C dabao.\n` +
        `    → Ya yahan se: npm run free-port   phir   npm start\n` +
        `    → Ya ek hi baar: npm run start:clean\n`
    );
    process.exit(1);
  }
  console.error(err);
  process.exit(1);
});
