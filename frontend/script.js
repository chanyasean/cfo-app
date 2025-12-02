// frontend/script.js

// ตอน dev local:
const API_BASE = 'https://cfo-app-e9b3.onrender.com';
// ตอน deploy จริง เปลี่ยนเป็น URL Backend บน Render:
// const API_BASE = 'https://cfo-backend-xxxx.onrender.com';

const COMPANY_NAME = 'Your Company Name';

let EF_LIST = [];
let UNIT_LIST = [];
let LAST_MONTHLY_SUMMARY = [];
let ACTIVITIES = []; // เก็บรายการ activity ทั้งหมด (ใช้ร่วมกับปุ่มลบ)

// ---------- Helper Functions ----------
function formatDate(dateStr) {
  if (!dateStr) return "-";
  const [yyyy, mm, dd] = dateStr.split("-");
  return `${dd}/${mm}/${yyyy}`;
}

// ------------- Helper fetch ------------- //

async function fetchJSON(path, options = {}) {
  const res = await fetch(API_BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(`Invalid JSON from ${path}`);
  }
  if (!res.ok) {
    const msg = data && data.error ? data.error : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

async function loadEFs() {
  EF_LIST = await fetchJSON('/api/efs');
}

async function loadUnits() {
  UNIT_LIST = await fetchJSON('/api/units');
}

// ------------- EF / Unit dropdown logic (Flow: Scope → EF → Unit) ------------- //

// EF ตาม Scope เท่านั้น (ไม่ดู Unit)
function populateEFSelectByScope(scopeValue) {
  const efSelect = document.getElementById('ef_id');
  const unitSelect = document.getElementById('unit_id');

  efSelect.innerHTML = '';
  unitSelect.innerHTML = '<option value="">-- เลือก EF ก่อน --</option>';
  unitSelect.disabled = true;

  if (!scopeValue) {
    efSelect.disabled = true;
    efSelect.innerHTML = '<option value="">-- เลือก Scope ก่อน --</option>';
    return;
  }

  const scopeNum = Number(scopeValue);
  const filtered = EF_LIST.filter((ef) => ef.scope === scopeNum);

  efSelect.disabled = false;
  efSelect.innerHTML = '<option value="">-- เลือก EF --</option>';

  filtered.forEach((ef) => {
    const opt = document.createElement('option');
    opt.value = ef.ef_id;
    // แสดงทั้ง Activity + Description + หน่วย
    const label = ef.description
      ? `${ef.ef_activity_name} - ${ef.description} (${ef.base_unit})`
      : `${ef.ef_activity_name} (${ef.base_unit})`;
    opt.textContent = label;
    efSelect.appendChild(opt);
  });

  if (filtered.length === 0) {
    efSelect.innerHTML = '<option value="">(ยังไม่มี EF ใน Scope นี้)</option>';
    efSelect.disabled = true;
  }
}

// Unit ตาม dimension/base_unit ของ EF ที่เลือก
function populateUnitSelectByEF(efId) {
  const unitSelect = document.getElementById('unit_id');
  unitSelect.innerHTML = '';

  if (!efId) {
    unitSelect.disabled = true;
    unitSelect.innerHTML = '<option value="">-- เลือก EF ก่อน --</option>';
    return;
  }

  const ef = EF_LIST.find((e) => e.ef_id === efId);
  if (!ef) {
    unitSelect.disabled = true;
    unitSelect.innerHTML = '<option value="">-- เลือก EF ก่อน --</option>';
    return;
  }

  const filteredUnits = UNIT_LIST.filter(
    (u) =>
      u.dimension === ef.dimension &&
      u.base_unit === ef.base_unit // เพื่อให้แปลงมาที่ base_unit เดียวกับ EF
  );

  unitSelect.disabled = false;
  unitSelect.innerHTML =
    '<option value="">-- เลือกหน่วยของ Activity Data --</option>';

  filteredUnits.forEach((u) => {
    const opt = document.createElement('option');
    opt.value = u.unit_id;
    opt.textContent = `${u.unit_name} (แปลงเป็น ${u.base_unit})`;
    unitSelect.appendChild(opt);
  });

  if (filteredUnits.length === 0) {
    unitSelect.disabled = true;
    unitSelect.innerHTML =
      '<option value="">(ยังไม่มี Unit ที่รองรับ dimension/base unit นี้)</option>';
  }
}

// ------------- Load Activities + Summary ------------- //

async function loadActivitiesAndSummary() {
  // ดึง activities + summary จาก backend
  ACTIVITIES = await fetchJSON('/api/activities');
  const summary = await fetchJSON('/api/summary');

  // ตาราง Activities (Data Entry view)
  const tbody = document.querySelector('#activities-table tbody');
  if (tbody) {
    tbody.innerHTML = '';
    ACTIVITIES.forEach((a) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${formatDate(a.date)}</td>
        <td>${a.activity_description || '-'}</td>
        <td>${a.ef_activity_name}</td>
        <td>${a.scope}</td>
        <td>${a.amount}</td>
        <td>${a.unit_name}</td>
        <td>${a.emission_tco2e != null ? a.emission_tco2e.toFixed(4) : '-'}</td>
        <td>
          <button type="button" class="btn-delete" data-id="${a.id}">
            ลบ
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    // attach event ให้ปุ่มลบทุกปุ่ม
    tbody.querySelectorAll('button.btn-delete').forEach((btn) => {
      const id = btn.getAttribute('data-id');
      btn.addEventListener('click', () => deleteActivity(id));
    });
  }

  // Summary cards
  let total = 0;
  let s1 = 0,
    s2 = 0,
    s3 = 0;

  summary.forEach((row) => {
    const t = row.total_tco2e || 0;
    total += t;
    if (row.scope === 1) s1 = t;
    if (row.scope === 2) s2 = t;
    if (row.scope === 3) s3 = t;
  });

  document.getElementById('total-tco2e').textContent = `${total.toFixed(
    2
  )} tCO₂e`;
  document.getElementById('scope1-tco2e').textContent = `${s1.toFixed(
    2
  )} tCO₂e`;
  document.getElementById('scope2-tco2e').textContent = `${s2.toFixed(
    2
  )} tCO₂e`;
  document.getElementById('scope3-tco2e').textContent = `${s3.toFixed(
    2
  )} tCO₂e`;

  // สรุปรายเดือน / ราย Scope สำหรับ Dashboard
  const monthlySummary = computeMonthlyScopeSummary(ACTIVITIES);
  renderMonthlySummary(monthlySummary);
}

// ------------- Delete Activity ------------- //

async function deleteActivity(id) {
  if (!confirm('ต้องการลบรายการนี้หรือไม่?')) return;

  try {
    await fetchJSON(`/api/activities/${id}`, {
      method: 'DELETE'
    });

    // ลบเสร็จ → reload activities + summary
    await loadActivitiesAndSummary();
  } catch (err) {
    console.error('deleteActivity error:', err);
    alert('เกิดข้อผิดพลาดขณะลบข้อมูล: ' + err.message);
  }
}

// ------------- Monthly Summary Logic ------------- //

function computeMonthlyScopeSummary(activities) {
  const map = new Map(); // key = YYYY-MM

  activities.forEach((a) => {
    if (!a.date || a.emission_tco2e == null) return;
    const month = a.date.slice(0, 7); // "YYYY-MM"
    if (!map.has(month)) {
      map.set(month, { scope1: 0, scope2: 0, scope3: 0 });
    }
    const entry = map.get(month);
    const val = Number(a.emission_tco2e) || 0;
    if (a.scope === 1) entry.scope1 += val;
    if (a.scope === 2) entry.scope2 += val;
    if (a.scope === 3) entry.scope3 += val;
  });

  const arr = Array.from(map.entries())
    .sort((a, b) => (a[0] > b[0] ? 1 : -1))
    .map(([month, scopes]) => {
      const total = scopes.scope1 + scopes.scope2 + scopes.scope3;
      return {
        month,
        scope1: scopes.scope1,
        scope2: scopes.scope2,
        scope3: scopes.scope3,
        total
      };
    });

  LAST_MONTHLY_SUMMARY = arr;
  return arr;
}

function renderMonthlySummary(summary) {
  const tbody = document.querySelector('#monthly-summary-table tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!summary || summary.length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td colspan="5" style="text-align:center;">ยังไม่มีข้อมูล</td>';
    tbody.appendChild(tr);
    return;
  }

  summary.forEach((row) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${row.month}</td>
      <td>${row.scope1.toFixed(2)}</td>
      <td>${row.scope2.toFixed(2)}</td>
      <td>${row.scope3.toFixed(2)}</td>
      <td>${row.total.toFixed(2)}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ------------- Export PDF (หัวกระดาษ + ตาราง หน้าเดียว) ------------- //

function exportSummaryToPDF() {
  if (!LAST_MONTHLY_SUMMARY || LAST_MONTHLY_SUMMARY.length === 0) {
    alert('ยังไม่มีข้อมูลให้ Export');
    return;
  }
  if (!window.jspdf || !window.jspdf.jsPDF) {
    alert('ไม่พบ jsPDF');
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  // Header bar
  doc.setFillColor(17, 24, 39); // #111827
  doc.rect(0, 0, 210, 20, 'F');

  doc.setTextColor(249, 250, 251);
  doc.setFontSize(14);
  doc.text('CFO Monthly Summary', 10, 13);

  doc.setFontSize(10);
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10);
  doc.text(`Company: ${COMPANY_NAME}`, 210 - 10, 10, { align: 'right' });
  doc.text(`Generated: ${dateStr}`, 210 - 10, 15, { align: 'right' });

  doc.setTextColor(0, 0, 0);

  const head = [['Month', 'Scope 1', 'Scope 2', 'Scope 3', 'Total']];
  const body = LAST_MONTHLY_SUMMARY.map((row) => [
    row.month,
    row.scope1.toFixed(2),
    row.scope2.toFixed(2),
    row.scope3.toFixed(2),
    row.total.toFixed(2)
  ]);

  if (doc.autoTable) {
    doc.autoTable({
      head,
      body,
      startY: 28,
      styles: { fontSize: 10 },
      headStyles: {
        fillColor: [37, 99, 235],
        textColor: [249, 250, 251]
      }
    });
  } else {
    let y = 30;
    doc.setFontSize(12);
    doc.text('Monthly Summary (tCO₂e)', 10, y);
    y += 8;
    doc.setFontSize(10);
    body.forEach((row) => {
      const line = row.join('  |  ');
      doc.text(line, 10, y);
      y += 6;
      if (y > 280) {
        doc.addPage();
        y = 20;
      }
    });
  }

  doc.save('cfo_monthly_summary.pdf');
}

// ------------- NAV (Dashboard / Data Entry) ------------- //

function setupNav() {
  const buttons = document.querySelectorAll('.nav-btn');
  const dashboardView = document.getElementById('dashboard-view');
  const dataView = document.getElementById('data-view');

  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      buttons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      const target = btn.getAttribute('data-target');
      if (target === 'dashboard-view') {
        dashboardView.classList.remove('hidden');
        dataView.classList.add('hidden');
      } else {
        dashboardView.classList.add('hidden');
        dataView.classList.remove('hidden');
      }
    });
  });
}

// ------------- INIT ------------- //

async function init() {
  try {
    setupNav();

    await Promise.all([loadEFs(), loadUnits()]);
    await loadActivitiesAndSummary();

    const scopeSelect = document.getElementById('scope');
    const efSelect = document.getElementById('ef_id');
    const unitSelect = document.getElementById('unit_id');

    scopeSelect.addEventListener('change', () => {
      const scopeVal = scopeSelect.value;
      populateEFSelectByScope(scopeVal);
    });

    efSelect.addEventListener('change', () => {
      const efId = efSelect.value;
      populateUnitSelectByEF(efId);
    });

    const form = document.getElementById('activity-form');
    const msgEl = document.getElementById('form-message');

    const exportBtn = document.getElementById('export-pdf-btn');
    if (exportBtn) {
      exportBtn.addEventListener('click', exportSummaryToPDF);
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      msgEl.textContent = '';
      msgEl.style.color = '';

      const activity_description = document
        .getElementById('activity_description')
        .value.trim();
      const date = document.getElementById('date').value;
      const scope = document.getElementById('scope').value;
      const ef_id = document.getElementById('ef_id').value;
      const unit_id = document.getElementById('unit_id').value;
      const amountVal = document.getElementById('amount').value;
      const remark = document.getElementById('remark').value.trim();

      const amount = Number(amountVal);

      if (
        !activity_description ||
        !date ||
        !scope ||
        !ef_id ||
        !unit_id ||
        !amountVal
      ) {
        msgEl.textContent = 'กรุณากรอกข้อมูลให้ครบ';
        msgEl.style.color = 'red';
        return;
      }
      if (isNaN(amount) || amount <= 0) {
        msgEl.textContent = 'Amount ต้องเป็นตัวเลขมากกว่า 0';
        msgEl.style.color = 'red';
        return;
      }

      try {
        await fetchJSON('/api/activities', {
          method: 'POST',
          body: JSON.stringify({
            activity_description,
            date,
            scope,
            ef_id,
            unit_id,
            amount,
            remark
          })
        });

        msgEl.textContent = 'บันทึกสำเร็จ';
        msgEl.style.color = 'green';

        form.reset();
        // reset dropdowns
        efSelect.innerHTML = '<option value="">-- เลือก Scope ก่อน --</option>';
        efSelect.disabled = true;
        unitSelect.innerHTML = '<option value="">-- เลือก EF ก่อน --</option>';
        unitSelect.disabled = true;

        await loadActivitiesAndSummary();
      } catch (err) {
        console.error(err);
        msgEl.textContent = 'เกิดข้อผิดพลาด: ' + err.message;
        msgEl.style.color = 'red';
      }
    });
  } catch (err) {
    console.error(err);
    alert('โหลดข้อมูลไม่สำเร็จ: ' + err.message);
  }
}

document.addEventListener('DOMContentLoaded', init);
