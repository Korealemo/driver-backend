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
// DB CONNECTION (RAILWAY SAFE)
// =======================
const db = mysql.createPool({
  host: process.env.MYSQLHOST,
  user: process.env.MYSQLUSER,
  password: process.env.MYSQLPASSWORD,
  database: process.env.MYSQL_DATABASE,
  port: process.env.MYSQLPORT,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

const PORT = process.env.PORT || 5000;

// =======================
// CONNECT DB + TABLES
// =======================

    // USERS TABLE
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
      )
    `;

    db.query(createUsersTable, (err) => {
      if (err) console.log("❌ Users table error:", err);
      else console.log("✅ Users table ready");
    });

    // TRANSACTIONS TABLE
    const createTransactionsTable = `
      CREATE TABLE IF NOT EXISTS transactions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        driver_id INT,
        amount DECIMAL(10,2),
        method VARCHAR(50),
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    db.query(createTransactionsTable, (err) => {
      if (err) console.log("❌ Transactions table error:", err);
      else console.log("✅ Transactions table ready");
    });
  

// =======================
// TEST ROUTE
// =======================
app.get("/", (req, res) => {
  res.send("🚀 API is running...");
});

// =======================
// REGISTER
// =======================
app.post("/register", async (req, res) => {
  const { name, surname, phone, email, password, car_plate } = req.body;

  if (!name || !surname || !phone || !email || !password || !car_plate) {
    return res.status(400).json({ message: "Required fields missing" });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    const sql = `
      INSERT INTO users (name, surname, phone, email, password, car_plate)
      VALUES (?, ?, ?, ?, ?, ?)
    `;

    db.query(sql, [name, surname, phone, email, hashedPassword, car_plate], (err, result) => {
      if (err) {
        return res.status(500).json({
          message: "Phone already exists or DB error",
        });
      }

      res.json({
        message: "Driver registered successfully",
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

  if (!phone || !password) {
    return res.status(400).json({ message: "Phone and password required" });
  }

  const sql = "SELECT * FROM users WHERE phone = ?";

  db.query(sql, [phone], async (err, results) => {
    if (err) return res.status(500).json({ message: "Server error" });

    if (results.length === 0) {
      return res.status(400).json({ message: "User not found" });
    }

    const user = results[0];
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(400).json({ message: "Invalid password" });
    }

    const token = jwt.sign(
      { id: user.id, phone: user.phone },
      "SECRET_KEY",
      { expiresIn: "1d" }
    );

    res.json({
      message: "Login successful",
      token,
      user: {
        id: user.id,
        name: user.name,
        surname: user.surname,
        phone: user.phone,
        car_plate: user.car_plate,
      },
    });
  });
});

// =======================
// GET PROFILE
// =======================
app.get("/me", (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) return res.status(401).json({ message: "No token" });

  try {
    const decoded = jwt.verify(token, "SECRET_KEY");

    db.query(
      "SELECT id, name, surname, phone, car_plate FROM users WHERE id = ?",
      [decoded.id],
      (err, results) => {
        if (err) return res.status(500).json({ message: "Server error" });

        if (results.length === 0) {
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
// CREATE TRANSACTION
// =======================
app.post("/transaction", (req, res) => {
  const { driver_id, amount, method } = req.body;

  if (!driver_id || !amount || !method) {
    return res.status(400).json({ message: "Missing fields" });
  }

  const sql = `
    INSERT INTO transactions (driver_id, amount, method)
    VALUES (?, ?, ?)
  `;

  db.query(sql, [driver_id, amount, method], (err, result) => {
    if (err) return res.status(500).json({ message: "DB error" });

    res.json({
      message: "Transaction saved",
      transactionId: result.insertId,
    });
  });
});

// =======================
// COMPLETE PAYMENT
// =======================
app.post("/pay/:id", (req, res) => {
  db.query(
    "UPDATE transactions SET status = 'completed' WHERE id = ?",
    [req.params.id],
    (err) => {
      if (err) return res.status(500).json({ message: "DB error" });

      res.json({ message: "Payment completed" });
    }
  );
});

// =======================
// GET BALANCE
// =======================
app.get("/get-balance/:driverId", (req, res) => {
  const sql = `
    SELECT SUM(amount) AS total
    FROM transactions
    WHERE status = 'completed'
    AND driver_id = ?
  `;

  db.query(sql, [req.params.driverId], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });

    res.json({
      balance: results[0].total || 0,
    });
  });
});

// =======================
// GET TRANSACTIONS
// =======================
app.get("/get-transactions/:driverId", (req, res) => {
  const sql = `
    SELECT *
    FROM transactions
    WHERE driver_id = ?
    ORDER BY created_at DESC
  `;

  db.query(sql, [req.params.driverId], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });

    res.json(results);
  });
});

// =======================
// START SERVER
// =======================
app.listen(PORT, () => {
  console.log("🚀 Server running on port " + PORT);
});