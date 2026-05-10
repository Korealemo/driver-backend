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

// Test DB connection
db.getConnection((err, connection) => {
  if (err) {
    console.log("❌ MySQL Connection Failed:", err.message);
  } else {
    console.log("✅ MySQL Connected");
    connection.release();
  }
});

// =======================
// PORT
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
// CREATE TABLES (AUTO)
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

const createWithdrawalsTable = `
CREATE TABLE IF NOT EXISTS withdrawals (
  id INT AUTO_INCREMENT PRIMARY KEY,
  driver_id INT,
  amount DECIMAL(10,2),
  status VARCHAR(20) DEFAULT 'completed',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

db.query(createUsersTable);
db.query(createTransactionsTable);
db.query(createWithdrawalsTable);

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

    db.query(
      `INSERT INTO users (name, surname, phone, email, password, car_plate)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name, surname, phone, email, hashedPassword, car_plate],
      (err, result) => {
        if (err) return res.status(500).json({ message: "DB error" });

        res.json({
          message: "Driver registered",
          userId: result.insertId,
        });
      }
    );
  } catch (err) {
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

    const token = jwt.sign(
      { id: user.id, phone: user.phone },
      process.env.JWT_SECRET || "SECRET_KEY",
      { expiresIn: "1d" }
    );

    res.json({ message: "Login successful", token, user });
  });
});

// =======================
// CREATE TRANSACTION (PAYMENT)
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
        transactionId: result.insertId,
      });
    }
  );
});

// =======================
// COMPLETE PAYMENT (IMPORTANT)
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
// GET SINGLE TRANSACTION
// =======================
app.get("/transaction/:id", (req, res) => {
  db.query(
    "SELECT * FROM transactions WHERE id=?",
    [req.params.id],
    (err, results) => {
      if (err) return res.status(500).json({ error: err.message });

      if (results.length === 0) {
        return res.status(404).json({ message: "Not found" });
      }

      res.json(results[0]);
    }
  );
});

// =======================
// GET ALL TRANSACTIONS
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
// BALANCE CALCULATION (FIXED LOGIC)
// =======================
app.get("/get-balance/:id", (req, res) => {
  const driverId = req.params.id;

  const paymentsQuery = `
    SELECT SUM(amount) AS totalPayments
    FROM transactions
    WHERE driver_id=? AND status='completed'
  `;

  const withdrawalsQuery = `
    SELECT SUM(amount) AS totalWithdrawals
    FROM withdrawals
    WHERE driver_id=?
  `;

  db.query(paymentsQuery, [driverId], (err, payRes) => {
    if (err) return res.status(500).json({ error: err.message });

    db.query(withdrawalsQuery, [driverId], (err2, wRes) => {
      if (err2) return res.status(500).json({ error: err2.message });

      const totalPayments = Number(payRes[0].totalPayments || 0);
      const totalWithdrawals = Number(wRes[0].totalWithdrawals || 0);

      const balance = totalPayments - totalWithdrawals;

      res.json({ balance });
    });
  });
});

// =======================
// WITHDRAW MONEY (FIXED + SAFE)
// =======================
app.post("/withdraw", (req, res) => {
  const { driver_id, amount } = req.body;

  if (!driver_id || !amount) {
    return res.status(400).json({ message: "Missing data" });
  }

  // 1. Get total earnings
  const paymentsQuery = `
    SELECT SUM(amount) AS totalPayments
    FROM transactions
    WHERE driver_id=? AND status='completed'
  `;

  // 2. Get total withdrawn
  const withdrawalsQuery = `
    SELECT SUM(amount) AS totalWithdrawn
    FROM withdrawals
    WHERE driver_id=?
  `;

  db.query(paymentsQuery, [driver_id], (err, payRes) => {
    if (err) return res.status(500).json({ error: err.message });

    db.query(withdrawalsQuery, [driver_id], (err2, wRes) => {
      if (err2) return res.status(500).json({ error: err2.message });

      const totalPayments = Number(payRes[0].totalPayments || 0);
      const totalWithdrawn = Number(wRes[0].totalWithdrawn || 0);

      const balance = totalPayments - totalWithdrawn;

      // 3. Check balance
      if (Number(amount) > balance) {
        return res.status(400).json({
          message: "Insufficient balance",
        });
      }

      // 4. Save withdrawal
      db.query(
        "INSERT INTO withdrawals (driver_id, amount) VALUES (?, ?)",
        [driver_id, amount],
        (err3, result) => {
          if (err3) return res.status(500).json({ error: err3.message });

          res.json({
            message: "Withdrawal successful",
            newBalance: balance - Number(amount),
          });
        }
      );
    });
  });
});

// =======================
// START SERVER
// =======================
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});