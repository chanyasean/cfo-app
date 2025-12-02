// backend/import_ef_from_excel.js
// Import EF จาก EF_Scope1-3.xlsx → EF_Master
// รองรับ Scope 1–3, multi-scope, Description และแปลง EF ให้เป็นต่อ base_unit

const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const xlsx = require('xlsx');

const DB_PATH = path.join(__dirname, 'cfo.db');
const EXCEL_PATH = path.join(__dirname, 'EF_Scope1-3.xlsx'); // แก้ชื่อให้ตรงไฟล์จริงถ้าต่าง

const db = new sqlite3.Database(DB_PATH);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

// แปลงหน่วย EF จาก Excel → dimension, base_unit, ef_per_base_unit
function normalizeEFUnit(unitRaw, efNumeric) {
  const label = String(unitRaw).trim();
  const u = label.toLowerCase();

  // ----- MASS: base = kg -----
  if (u === 'kg' || u === 'kg.' || u === 'kg ' || u === 'kg') {
    return { dimension: 'mass', baseUnit: 'kg', efPerBase: efNumeric };
  }
  if (u === 'kg' || u === 'kg') {
    return { dimension: 'mass', baseUnit: 'kg', efPerBase: efNumeric };
  }
  if (u === 'kg' || u === 'kg') {
    return { dimension: 'mass', baseUnit: 'kg', efPerBase: efNumeric };
  }
  if (u === 'kg' || u === 'kg') {
    return { dimension: 'mass', baseUnit: 'kg', efPerBase: efNumeric };
  }
  // ถ้า Excel ใช้ 'Kg' → u จะเป็น 'kg' แล้วเข้า case ข้างบน

  // ----- VOLUME ของเหลว: base = L -----
  if (u === 'l' || u === 'litre' || u === 'liter') {
    // EF เป็น kgCO2e/L อยู่แล้ว
    return { dimension: 'volume', baseUnit: 'L', efPerBase: efNumeric };
  }
  if (u === 'm3') {
    // EF ตอนนี้เป็น kgCO2e/m3 → เราอยากได้ kgCO2e/L
    // 1 m3 = 1000 L → EF_per_L = EF_per_m3 / 1000
    return { dimension: 'volume', baseUnit: 'L', efPerBase: efNumeric / 1000 };
  }

  // ----- VOLUME ก๊าซ: base = scf -----
  if (u === 'scf') {
    // ยังไม่แปลง scf → ใช้ scf เป็น base ไปเลย
    return { dimension: 'volume', baseUnit: 'scf', efPerBase: efNumeric };
  }

  // ----- ENERGY: base = kWh -----
  if (u === 'kwh') {
    return { dimension: 'energy', baseUnit: 'kWh', efPerBase: efNumeric };
  }
  if (u === 'mwh') {
    // EF_per_MWh → EF_per_kWh = EF_per_MWh / 1000
    return { dimension: 'energy', baseUnit: 'kWh', efPerBase: efNumeric / 1000 };
  }
  if (u === 'mj') {
    // 1 kWh = 3.6 MJ → EF_per_kWh = EF_per_MJ * 3.6
    return { dimension: 'energy', baseUnit: 'kWh', efPerBase: efNumeric * 3.6 };
  }
  if (u === 'hp-hr') {
    // 1 hp-hr ≈ 0.7457 kWh → EF_per_kWh = EF_per_hp-hr / 0.7457
    return { dimension: 'energy', baseUnit: 'kWh', efPerBase: efNumeric / 0.7457 };
  }

  // ----- DISTANCE -----
  if (u === 'km') {
    return { dimension: 'distance', baseUnit: 'km', efPerBase: efNumeric };
  }

  // ----- TRANSPORT WORK -----
  if (u === 'tkm') {
    return { dimension: 'transport_work', baseUnit: 'tkm', efPerBase: efNumeric };
  }

  // ----- COUNT / PIECES -----
  if (u === 'p') {
    return { dimension: 'count', baseUnit: 'p', efPerBase: efNumeric };
  }
  if (u === 'p (แผ่น)' || u === 'p(แผ่น)') {
    return { dimension: 'count', baseUnit: 'p (แผ่น)', efPerBase: efNumeric };
  }

  // ----- TIME -----
  if (u === 'hr' || u === 'hour' || u === 'h') {
    return { dimension: 'time', baseUnit: 'hr', efPerBase: efNumeric };
  }

  // ----- AREA -----
  if (u === 'm2') {
    return { dimension: 'area', baseUnit: 'm2', efPerBase: efNumeric };
  }

  throw new Error(`ไม่รู้จักหน่วย EF จาก Excel: "${unitRaw}"`);
}

async function main() {
  console.log('อ่านไฟล์ Excel:', EXCEL_PATH);

  const wb = xlsx.readFile(EXCEL_PATH);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(sheet);

  console.log(`เจอ ${rows.length} แถวใน Excel`);

  // ลบ EF เดิมของ Scope 1–3 ก่อน
  console.log('ลบ EF เดิมใน Scope 1, 2, 3 ออกก่อน...');
  await run('DELETE FROM EF_Master WHERE scope IN (1, 2, 3)');

  const insertSql = `
    INSERT INTO EF_Master
      (ef_id, scope, group_name, ef_activity_name, description, dimension, base_unit, ef_kgco2e_per_base_unit)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `;

  let imported = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];

    const name = r['ชื่อ'];
    const unitRaw = r['หน่วย'];
    const efValue = r['Emission Factors'];
    const scopeRaw = r['Scope'];
    const descFromExcel = r['คำอธิบาย'] || r['Description'];

    if (!name || !unitRaw || efValue == null || efValue === '' || !scopeRaw) {
      console.log(`ข้ามแถว ${i + 1}: ข้อมูลไม่ครบ`);
      continue;
    }

    const efNumeric = Number(efValue);
    if (!Number.isFinite(efNumeric)) {
      console.log(`ข้ามแถว ${i + 1}: EF ไม่ใช่ตัวเลข ->`, efValue);
      continue;
    }

    let scopes = String(scopeRaw)
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => n === 1 || n === 2 || n === 3);
    scopes = [...new Set(scopes)];

    if (scopes.length === 0) {
      console.log(`ข้ามแถว ${i + 1}: Scope ผิดรูปแบบ ->`, scopeRaw);
      continue;
    }

    let norm;
    try {
      norm = normalizeEFUnit(unitRaw, efNumeric);
    } catch (err) {
      console.log(`ข้ามแถว ${i + 1}: ${err.message}`);
      continue;
    }

    const { dimension, baseUnit, efPerBase } = norm;
    const baseEfId = `EF${String(i + 1).padStart(4, '0')}`;

    for (const scope of scopes) {
      const efId = scopes.length === 1 ? baseEfId : `${baseEfId}_S${scope}`;

      let groupName = 'Other';
      if (scope === 1) groupName = 'Direct / Fuel Combustion';
      else if (scope === 2) groupName = 'Electricity';
      else if (scope === 3) groupName = 'Other indirect (Scope 3)';

      const description = descFromExcel || name;

      try {
        await run(insertSql, [
          efId,
          scope,
          groupName,
          name,
          description,
          dimension,
          baseUnit,
          efPerBase
        ]);
        imported++;
      } catch (err) {
        console.error(
          `ผิดพลาดตอน insert แถว ${i + 1} (ef_id=${efId}, scope=${scope}):`,
          err.message
        );
      }
    }
  }

  console.log(`นำเข้า EF สำเร็จ ${imported} แถว`);
  db.close();
}

main().catch((err) => {
  console.error(err);
  db.close();
});
