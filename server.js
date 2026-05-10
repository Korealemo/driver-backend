require("dotenv").config();

const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();

// =======================
// CONFIG
// =======================
const PORT = process.env.PORT || 3000;

// 🔥 SINGLE SOURCE OF TRUTH (FIXES INVALID TOKEN ISSUE)
const JWT_SECRET = process.env.JWT_SECRET || "SECRET_KEY";

// =======================
// MIDDLEWARE
// =======================
app.use(cors());
app.use(express.json());

// =======================
// DEBUG ENV
// =======================
console.log("🔎 ENV CHECK:", {
  host: process.env.MYSQLHOST,
  user: process.env.MYSQLUSER,
  database: process.env.MYSQLDATABASE,
  port: process.env.MYSQLPORT,
  jwt: JWT_SECRET ? "SET" : "NOT SET",
});

// =======================
// MYSQL
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

// =======================
// TEST DB
// =======================
db.getConnection((err, connection) => {
  if (err) {
    console.log("❌ MySQL Error:", err.message);
  } else {
    console.log("✅ MySQL Connected");
    connection.release();
  }
});

// =======================
// HEALTH
// =======================
app.get("/", (req, res) => {
  res.send("🚀 API Running");
});

// =======================
// AUTH MIDDLEWARE
// =======================
function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "No token provided" });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ message: "Invalid token" });
    }

    req.user = user;
    next();
  });
}

// =======================
// TABLES
// =======================
db.query(`
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
`);

db.query(`
CREATE TABLE IF NOT EXISTS transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  driver_id INT,
  amount DECIMAL(10,2),
  method VARCHAR(50),
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`);

db.query(`
CREATE TABLE IF NOT EXISTS withdrawals (
  id INT AUTO_INCREMENT PRIMARY KEY,
  driver_id INT,
  amount DECIMAL(10,2),
  status VARCHAR(20) DEFAULT 'completed',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`);

// =======================
// REGISTER
// =======================
app.post("/register", async (req, res) => {
  const { name, surname, phone, email, password, car_plate } = req.body;

  if (!name || !surname || !phone || !email || !password || !car_plate) {
    return res.status(400).json({ message: "Missing fields" });
  }

  try {
    const hashed = await bcrypt.hash(password, 10);

    db.query(
      `INSERT INTO users (name, surname, phone, email, password, car_plate)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name, surname, phone, email, hashed, car_plate],
      (err, result) => {
        if (err) return res.status(500).json({ message: "DB error" });

        res.json({
          message: "User created",
          userId: result.insertId,
        });
      }
    );
  } catch (e) {
    res.status(500).json({ message: "Server error" });
  }
});

// =======================
// LOGIN
// =======================
app.post("/login", (req, res) => {
  const { phone, password } = req.body;

  db.query("SELECT * FROM users WHERE phone=?", [phone], async (err, results) => {
    if (err) return res.status(500).json({ message: "Server error" });

    if (results.length === 0) {
      return res.status(400).json({ message: "User not found" });
    }

    const user = results[0];

    const match = await bcrypt.compare(password, user.password);

    if (!match) {
      return res.status(400).json({ message: "Wrong password" });
    }

    // 🔥 FIXED TOKEN
    const token = jwt.sign(
      { id: user.id, phone: user.phone },
      JWT_SECRET,
      { expiresIn: "1d" }
    );

    res.json({
      message: "Login success",
      token,
      user,
    });
  });
});

// =======================
// PROFILE (/me)
// =======================
app.get("/me", authenticateToken, (req, res) => {
  const userId = req.user.id;

  db.query(
    "SELECT id, name, surname, phone, email, car_plate FROM users WHERE id=?",
    [userId],
    (err, results) => {
      if (err) return res.status(500).json({ message: "DB error" });

      if (results.length === 0) {
        return res.status(404).json({ message: "User not found" });
      }

      res.json(results[0]);
    }
  );
});

// =======================
// TRANSACTION
// =======================
app.post("/transaction", (req, res) => {
  const { driver_id, amount, method } = req.body;

  db.query(
    `INSERT INTO transactions (driver_id, amount, method, status)
     VALUES (?, ?, ?, 'pending')`,
    [driver_id, amount, method],
    (err, result) => {
      if (err) return res.status(500).json({ message: "DB error" });

      res.json({
        message: "Transaction created",
        id: result.insertId,
      });
    }
  );
});

// =======================
// PAY
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
  const id = req.params.id;

  const q1 = `SELECT SUM(amount) AS total FROM transactions WHERE driver_id=? AND status='completed'`;
  const q2 = `SELECT SUM(amount) AS withdrawn FROM withdrawals WHERE driver_id=?`;

  db.query(q1, [id], (err, r1) => {
    if (err) return res.status(500).json(err);

    db.query(q2, [id], (err2, r2) => {
      if (err2) return res.status(500).json(err2);

      const total = Number(r1[0].total || 0);
      const withdrawn = Number(r2[0].withdrawn || 0);

      res.json({ balance: total - withdrawn });
    });
  });
});

// =======================
// WITHDRAW
// =======================
app.post("/withdraw", (req, res) => {
  const { driver_id, amount } = req.body;

  db.query(
    "INSERT INTO withdrawals (driver_id, amount) VALUES (?, ?)",
    [driver_id, amount],
    (err) => {
      if (err) return res.status(500).json(err);

      res.json({ message: "Withdraw success" });
    }
  );
});

// =======================
// START SERVER
// =======================
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});