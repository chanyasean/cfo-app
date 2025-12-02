// backend/server.js
const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// -------------------- DB SETUP -------------------- //

const DB_PATH = path.join(__dirname, 'cfo.db');
const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
  // ตาราง EF_Master (ข้อมูล EF จากเอกสาร/Excel)
  db.run(`
    CREATE TABLE IF NOT EXISTS EF_Master (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ef_id TEXT UNIQUE,
      scope INTEGER,
      group_name TEXT,
      ef_activity_name TEXT,
      description TEXT,
      dimension TEXT,
      base_unit TEXT,
      ef_kgco2e_per_base_unit REAL
    );
  `);

  // ตาราง Unit_Master
  db.run(`
    CREATE TABLE IF NOT EXISTS Unit_Master (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      unit_id TEXT UNIQUE,
      dimension TEXT,
      unit_name TEXT,
      to_base_factor REAL,
      base_unit TEXT
    );
  `);

  // ตาราง Activity_Log สำหรับเก็บรายการกิจกรรม
  db.run(`
    CREATE TABLE IF NOT EXISTS Activity_Log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      activity_id TEXT UNIQUE,
      activity_description TEXT,
      date TEXT,
      scope INTEGER,
      ef_id TEXT,
      unit_id TEXT,
      amount REAL,
      remark TEXT,
      created_at TEXT,
      updated_at TEXT,
      is_deleted INTEGER DEFAULT 0
    );
  `);

  // ---------- seed EF_Master (ตัวอย่างเล็ก ๆ เฉพาะตอน DB ว่าง) ----------
  db.get('SELECT COUNT(*) AS count FROM EF_Master', (err, row) => {
    if (err) {
      console.error('Error counting EF_Master:', err);
      return;
    }
    if (row.count === 0) {
      console.log('Seeding EF_Master (ตัวอย่าง)...');
      const stmt = db.prepare(`
        INSERT INTO EF_Master
        (ef_id, scope, group_name, ef_activity_name, description, dimension, base_unit, ef_kgco2e_per_base_unit)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      // ตัวอย่าง EF (ไว้ก่อน ถัดไปจะ import EF เต็มจาก Excel)
      stmt.run(
        'EF011',
        2,
        'Electricity',
        'Electricity, grid mix',
        'Purchased electricity grid mix (2016-2018)',
        'energy',
        'kWh',
        0.4999
      );

      stmt.run(
        'EF005',
        1,
        'Stationary Combustion',
        'Gas/Diesel oil combustion',
        'Gas/Diesel oil combustion (stationary source)',
        'volume',
        'L',
        2.7078
      );

      stmt.run(
        'EF012',
        3,
        'Purchased goods',
        'ABS resin',
        'Acrylonitrile Butadiene Styrene at plant',
        'mass',
        'kg',
        4.1597
      );

      stmt.finalize();
    }
  });

  // ---------- seed Unit_Master ถ้ายังไม่มี ----------
  db.get('SELECT COUNT(*) AS count FROM Unit_Master', (err, row) => {
    if (err) {
      console.error('Error counting Unit_Master:', err);
      return;
    }

    if (row.count === 0) {
      console.log('Seeding Unit_Master...');
      const stmt = db.prepare(`
        INSERT INTO Unit_Master
          (unit_id, dimension, unit_name, to_base_factor, base_unit)
        VALUES (?, ?, ?, ?, ?)
      `);

      // ---------- MASS (base = kg) ----------
      stmt.run('U_MASS_KG', 'mass', 'kg', 1, 'kg');
      stmt.run('U_MASS_TON', 'mass', 'tonne', 1000, 'kg'); // 1 tonne = 1000 kg (เผื่อใช้ภายหลัง)
      stmt.run('U_MASS_MT', 'mass', 'MT', 1000, 'kg');      // metric ton

      // ---------- VOLUME ของเหลว (base = L) ----------
      stmt.run('U_VOL_LITRE', 'volume', 'litre', 1, 'L');      // 1 litre = 1 L
      stmt.run('U_VOL_M3', 'volume', 'm3', 1000, 'L');         // 1 m3 = 1000 L

      // ---------- VOLUME ก๊าซ (base = scf) ----------
      // ใช้ scf เป็น base ไปก่อน
      stmt.run('U_VOL_SCF', 'volume', 'scf', 1, 'scf');

      // ---------- ENERGY (base = kWh) ----------
      stmt.run('U_EN_KWH', 'energy', 'kWh', 1, 'kWh');
      stmt.run('U_EN_MWH', 'energy', 'MWh', 1000, 'kWh');      // 1 MWh = 1000 kWh
      // 1 kWh = 3.6 MJ → 1 MJ = 1/3.6 kWh
      stmt.run('U_EN_MJ', 'energy', 'MJ', 1 / 3.6, 'kWh');
      // 1 hp ≈ 0.7457 kW → 1 hp-hr ≈ 0.7457 kWh
      stmt.run('U_EN_HP_HR', 'energy', 'hp-hr', 0.7457, 'kWh');

      // ---------- DISTANCE ----------
      stmt.run('U_DIST_KM', 'distance', 'km', 1, 'km');

      // ---------- TRANSPORT WORK ----------
      stmt.run('U_TWORK_TKM', 'transport_work', 'tkm', 1, 'tkm');

      // ---------- COUNT / PIECES ----------
      stmt.run('U_COUNT_P', 'count', 'p', 1, 'p');
      stmt.run('U_COUNT_P_SHEET', 'count', 'p (แผ่น)', 1, 'p (แผ่น)');

      // ---------- TIME ----------
      stmt.run('U_TIME_HR', 'time', 'hr', 1, 'hr');

      // ---------- AREA ----------
      stmt.run('U_AREA_M2', 'area', 'm2', 1, 'm2');

      stmt.finalize();
    }
  });
});

// -------------------- helper promisify -------------------- //

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// -------------------- API -------------------- //

// EF ทั้งหมด
app.get('/api/efs', async (req, res) => {
  try {
    const rows = await all(`
      SELECT *
      FROM EF_Master
      ORDER BY scope, group_name, ef_activity_name
    `);
    res.json(rows);
  } catch (err) {
    console.error('GET /api/efs error:', err);
    res.status(500).json({ error: 'Failed to fetch EF' });
  }
});

// Units ทั้งหมด
app.get('/api/units', async (req, res) => {
  try {
    const rows = await all(`
      SELECT *
      FROM Unit_Master
      ORDER BY dimension, unit_name
    `);
    res.json(rows);
  } catch (err) {
    console.error('GET /api/units error:', err);
    res.status(500).json({ error: 'Failed to fetch units' });
  }
});

// Activities + emission (ใช้ Option A + แสดงเฉพาะที่ไม่ถูกลบ)
app.get('/api/activities', async (req, res) => {
  try {
    const rows = await all(`
      SELECT
        a.id,
        a.activity_id,
        a.activity_description,
        a.date,
        a.scope,
        a.ef_id,
        e.ef_activity_name,
        e.dimension,
        e.base_unit AS ef_base_unit,
        e.ef_kgco2e_per_base_unit,
        a.unit_id,
        u.unit_name,
        u.to_base_factor,
        u.base_unit AS unit_base_unit,
        a.amount,
        a.remark,
        (a.amount * u.to_base_factor) * e.ef_kgco2e_per_base_unit AS emission_kgco2e,
        ((a.amount * u.to_base_factor) * e.ef_kgco2e_per_base_unit) / 1000.0 AS emission_tco2e
      FROM Activity_Log a
      JOIN EF_Master e ON a.ef_id = e.ef_id
      JOIN Unit_Master u ON a.unit_id = u.unit_id
      WHERE a.is_deleted = 0
      ORDER BY a.date DESC, a.id DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error('GET /api/activities error:', err);
    res.status(500).json({ error: 'Failed to fetch activities' });
  }
});

// เพิ่ม Activity (สร้างรายการใหม่)
app.post('/api/activities', async (req, res) => {
  try {
    const {
      activity_description,
      date,
      scope,
      ef_id,
      unit_id,
      amount,
      remark
    } = req.body;

    if (
      !activity_description ||
      !date ||
      !scope ||
      !ef_id ||
      !unit_id ||
      amount == null
    ) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (Number(amount) <= 0) {
      return res.status(400).json({ error: 'Amount must be greater than 0' });
    }

    const activity_id =
      'ACT-' +
      Date.now().toString(36) +
      '-' +
      Math.random().toString(36).slice(2, 6);

    const now = new Date().toISOString();

    await run(
      `
      INSERT INTO Activity_Log
      (activity_id, activity_description, date, scope, ef_id, unit_id, amount, remark, created_at, updated_at, is_deleted)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
      `,
      [
        activity_id,
        activity_description,
        date,
        Number(scope),
        ef_id,
        unit_id,
        Number(amount),
        remark || '',
        now,
        now
      ]
    );

    res.json({ message: 'Activity created', activity_id });
  } catch (err) {
    console.error('POST /api/activities error:', err);
    res.status(500).json({ error: 'Failed to create activity' });
  }
});

// ลบ Activity (Option A - ลบออกจากตารางแบบ soft delete)
app.delete('/api/activities/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) {
      return res.status(400).json({ error: 'id ไม่ถูกต้อง' });
    }

    const now = new Date().toISOString();

    // ถ้าอยาก hard delete จริง ๆ ให้เปลี่ยนเป็น DELETE
    await run(
      `
      UPDATE Activity_Log
      SET is_deleted = 1,
          updated_at = ?
      WHERE id = ?
      `,
      [now, id]
    );

    res.json({ message: 'ลบข้อมูลเรียบร้อย' });
  } catch (err) {
    console.error('DELETE /api/activities/:id error:', err);
    res.status(500).json({ error: 'Failed to delete activity' });
  }
});

// Summary ตาม Scope
app.get('/api/summary', async (req, res) => {
  try {
    const rows = await all(`
      SELECT
        a.scope,
        SUM((a.amount * u.to_base_factor) * e.ef_kgco2e_per_base_unit) AS total_kgco2e,
        SUM((a.amount * u.to_base_factor) * e.ef_kgco2e_per_base_unit) / 1000.0 AS total_tco2e
      FROM Activity_Log a
      JOIN EF_Master e ON a.ef_id = e.ef_id
      JOIN Unit_Master u ON a.unit_id = u.unit_id
      WHERE a.is_deleted = 0
      GROUP BY a.scope
      ORDER BY a.scope
    `);
    res.json(rows);
  } catch (err) {
    console.error('GET /api/summary error:', err);
    res.status(500).json({ error: 'Failed to get summary' });
  }
});

// health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'CFO backend running' });
});

// start server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
