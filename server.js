require("dotenv").config();

const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();

// =======================
// MIDDLEWARE
// =======================
app.use(cors());
app.use(express.json());

// =======================
// ENV DEBUG
// =======================
console.log("🔎 DB ENV CHECK:", {
  host: process.env.MYSQLHOST,
  user: process.env.MYSQLUSER,
  database: process.env.MYSQLDATABASE,
  port: process.env.MYSQLPORT,
});

// =======================
// MYSQL CONNECTION
// =======================
const db = mysql.createPool({
  host: process.env.MYSQLHOST,
  user: process.env.MYSQLUSER,
  password: process.env.MYSQLPASSWORD,
  database: process.env.MYSQLDATABASE,
  port: process.env.MYSQLPORT,
  waitForConnections: true,
  connectionLimit: 10,
});

// test connection (safe version)
db.getConnection((err, connection) => {
  if (err) {
    console.log("❌ MySQL Connection Failed:", err.message);
  } else {
    console.log("✅ MySQL Connected");
    connection.release();
  }
});

// =======================
// PORT FIX (CRITICAL RAILWAY FIX)
// =======================
const PORT = process.env.PORT || 3000;

// =======================
// HEALTH CHECK
// =======================
app.get("/", (req, res) => {
  res.send("🚀 API is running...");
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// =======================
// DB TEST
// =======================
app.get("/db-test", (req, res) => {
  db.query("SELECT 1 + 1 AS result", (err, data) => {
    if (err) {
      return res.status(500).json({
        message: "DB error",
        error: err.message,
      });
    }

    res.json({
      message: "Database connected successfully",
      data,
    });
  });
});

// =======================
// CREATE TABLES
// =======================
const createUsersTable = `
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50),
  surname VARCHAR(50),
  phone VARCHAR(20) UNIQUE,
  email VARCHAR(100),
  car_plate VARCHAR(20),
  password VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

const createTransactionsTable = `
CREATE TABLE IF NOT EXISTS transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  driver_id INT,
  amount DECIMAL(10,2),
  method VARCHAR(50),
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

db.query(createUsersTable, (err) => {
  if (err) console.log("❌ Users table error:", err.message);
  else console.log("✅ Users table ready");
});

db.query(createTransactionsTable, (err) => {
  if (err) console.log("❌ Transactions table error:", err.message);
  else console.log("✅ Transactions table ready");
});

// =======================
// REGISTER
// =======================
app.post("/register", async (req, res) => {
  const { name, surname, phone, email, password, car_plate } = req.body;

  if (!name || !surname || !phone || !email || !password || !car_plate) {
    return res.status(400).json({ message: "Missing fields" });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    const sql = `
      INSERT INTO users (name, surname, phone, email, password, car_plate)
      VALUES (?, ?, ?, ?, ?, ?)
    `;

    db.query(sql, [name, surname, phone, email, hashedPassword, car_plate], (err, result) => {
      if (err) {
        return res.status(500).json({ message: "DB error or phone exists" });
      }

      res.json({
        message: "Driver registered",
        userId: result.insertId,
      });
    });

  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// =======================
// LOGIN
// =======================
app.post("/login", (req, res) => {
  const { phone, password } = req.body;

  const sql = "SELECT * FROM users WHERE phone = ?";

  db.query(sql, [phone], async (err, results) => {
    if (err) return res.status(500).json({ message: "Server error" });

    if (results.length === 0) {
      return res.status(400).json({ message: "User not found" });
    }

    const user = results[0];

    const match = await bcrypt.compare(password, user.password);

    if (!match) {
      return res.status(400).json({ message: "Wrong password" });
    }

    const token = jwt.sign(
      { id: user.id, phone: user.phone },
      process.env.JWT_SECRET || "SECRET_KEY",
      { expiresIn: "1d" }
    );

    res.json({
      message: "Login successful",
      token,
      user,
    });
  });
});

// =======================
// PROFILE
// =======================
app.get("/me", (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) return res.status(401).json({ message: "No token" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "SECRET_KEY");

    db.query(
      "SELECT id, name, surname, phone, email, car_plate FROM users WHERE id = ?",
      [decoded.id],
      (err, results) => {
        if (err) return res.status(500).json({ message: "Server error" });

        if (!results.length) {
          return res.status(404).json({ message: "User not found" });
        }

        res.json(results[0]);
      }
    );
  } catch {
    res.status(401).json({ message: "Invalid token" });
  }
});

// =======================
// TRANSACTION
// =======================
app.post("/transaction", (req, res) => {
  const { driver_id, amount, method } = req.body;

  const sql = `
    INSERT INTO transactions (driver_id, amount, method)
    VALUES (?, ?, ?)
  `;

  db.query(sql, [driver_id, amount, method], (err, result) => {
    if (err) return res.status(500).json({ message: "DB error" });

    res.json({
      message: "Transaction saved",
      id: result.insertId,
    });
  });
});

// =======================
// COMPLETE PAYMENT
// =======================
app.post("/pay/:id", (req, res) => {
  db.query(
    "UPDATE transactions SET status='completed' WHERE id=?",
    [req.params.id],
    (err) => {
      if (err) return res.status(500).json({ message: "DB error" });

      res.json({ message: "Payment completed" });
    }
  );
});

// =======================
// BALANCE
// =======================
app.get("/get-balance/:id", (req, res) => {
  db.query(
    `
    SELECT SUM(amount) AS total
    FROM transactions
    WHERE driver_id=? AND status='completed'
    `,
    [req.params.id],
    (err, results) => {
      if (err) return res.status(500).json({ error: err.message });

      res.json({ balance: results[0].total || 0 });
    }
  );
});

// =======================
// TRANSACTIONS LIST
// =======================
app.get("/get-transactions/:id", (req, res) => {
  db.query(
    "SELECT * FROM transactions WHERE driver_id=? ORDER BY created_at DESC",
    [req.params.id],
    (err, results) => {
      if (err) return res.status(500).json({ error: err.message });

      res.json(results);
    }
  );
});

// =======================
// START SERVER (RAILWAY SAFE)
// =======================
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});