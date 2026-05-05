const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// DB Connection
const db = mysql.createConnection({
    host: "localhost",
    user: "root",
    password: "",
    database: "driver_app"
});

// Connect DB + AUTO CREATE TABLE
db.connect((err) => {
    if (err) {
        console.log("❌ Database connection failed:", err);
    } else {
        console.log("✅ MySQL Connected");

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
            if (err) {
                console.log("❌ Table creation error:", err);
            } else {
                console.log("✅ Users table ready");
            }
        });
    }
});

// TEST ROUTE
app.get("/", (req, res) => {
    res.send("🚀 API is running...");
});


// =======================
// REGISTER API
// =======================
app.post("/register", async (req, res) => {
    const { name, surname, phone, email, password,car_plate } = req.body;

    if (!name || !surname || !phone || !email  || !password || !car_plate) {
        return res.status(400).json({
            message: "Required fields missing"
        });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);

        const sql = `
            INSERT INTO users (name, surname, phone, email, password, car_plate)
            VALUES (?, ?, ?, ?, ?, ?)
        `;

        db.query(
            sql,
            [name, surname, phone, email, hashedPassword, car_plate],
            (err, result) => {
                if (err) {
                    console.log(err);
                    return res.status(500).json({
                        message: "Phone already exists or DB error"
                    });
                }

                res.json({
                    message: " Driver registered successfully",
                    userId: result.insertId
                });
            }
        );

    } catch (error) {
        console.log(error);
        res.status(500).json({ message: "Server error" });
    }
});

// =======================
// GET DRIVER PROFILE
// =======================
app.get("/me", (req, res) => {
    const token = req.headers.authorization?.split(" ")[1];

    if (!token) {
        return res.status(401).json({ message: "No token provided" });
    }

    try {
        const decoded = jwt.verify(token, "SECRET_KEY");

        const sql = "SELECT id, name, surname, phone, car_plate FROM users WHERE id = ?";

        db.query(sql, [decoded.id], (err, results) => {
            if (err) {
                return res.status(500).json({ message: "Server error" });
            }

            if (results.length === 0) {
                return res.status(404).json({ message: "User not found" });
            }

            res.json(results[0]);
        });

    } catch (err) {
        return res.status(401).json({ message: "Invalid token" });
    }
});
//================
//==================LOGIN USER
//=================================


// LOGIN DRIVER
app.post("/login", (req, res) => {
    const { phone, password } = req.body;

    if (!phone || !password) {
        return res.status(400).json({
            message: "Phone and password are required"
        });
    }

    const sql = "SELECT * FROM users WHERE phone = ?";

    db.query(sql, [phone], async (err, results) => {
        if (err) {
            console.log(err);
            return res.status(500).json({ message: "Server error" });
        }

        if (results.length === 0) {
            return res.status(400).json({ message: "User not found" });
        }

        const user = results[0];

        // Compare password
        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) {
            return res.status(400).json({ message: "Invalid password" });
        }

        // Create token (optional but good practice)
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
                car_plate: user.car_plate
            }
        });
    });
});
//====
//==== TRANSACTIONS TABLE
//=====
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
            if (err) {
                console.log(" Transactions table error:", err);
            } else {
                console.log("Transactions table ready");
            }
        });
        app.post("/transaction", (req, res) => {
    const { driver_id, amount, method } = req.body;

    // validation
    if (!driver_id || !amount || !method) {
        return res.status(400).json({
            message: "Missing required fields"
        });
    }

    const sql = `
        INSERT INTO transactions (driver_id, amount, method)
        VALUES (?, ?, ?)
    `;

    db.query(sql, [driver_id, amount, method], (err, result) => {
        if (err) {
            console.log("DB ERROR:", err);
            return res.status(500).json({
                message: "Database error"
            });
        }

        res.json({
            message: "Transaction saved",
            transactionId: result.insertId
        });
    });
});
// GET TRANSACTION STATUS
app.get("/transaction/:id", (req, res) => {
    const id = req.params.id;

    const sql = "SELECT status FROM transactions WHERE id = ?";

    db.query(sql, [id], (err, result) => {
        if (err) {
            return res.status(500).json({ message: "DB error" });
        }

        if (result.length === 0) {
            return res.status(404).json({ message: "Transaction not found" });
        }

        res.json({
            status: result[0].status
        });
    });
});
// SIMULATE PAYMENT
app.post("/pay/:id", (req, res) => {
    const id = req.params.id;

    const sql = "UPDATE transactions SET status = 'completed' WHERE id = ?";

    db.query(sql, [id], (err) => {
        if (err) {
            return res.status(500).json({ message: "DB error" });
        }

        res.json({
            message: "Payment marked as completed"
        });
    });
});
app.get("/get-balance/:driverId", (req, res) => {
    const driverId = req.params.driverId;

    const sql = `
        SELECT SUM(amount) AS total
        FROM transactions
        WHERE status = 'completed'
        AND driver_id = ?
    `;

    db.query(sql, [driverId], (err, results) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }

        res.json({
            balance: results[0].total || 0
        });
    });
});
app.get("/get-transactions/:driverId", (req, res) => {
    const driverId = req.params.driverId;

    const sql = `
        SELECT *
        FROM transactions
        WHERE driver_id = ?
        ORDER BY created_at DESC
    `;

    db.query(sql, [driverId], (err, results) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }

        res.json(results);
    });
});
// =======================
// START SERVER
// =======================
app.listen(5000, () => {
    console.log(" Server running on http://192.168.43.80:5000");
});