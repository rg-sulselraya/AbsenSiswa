/*
 * The UI talks to a backend through VITE_ATTENDANCE_API_URL when one is configured.
 * The browser never receives Google credentials. Until that backend is configured,
 * this local fallback keeps the prototype usable and stores only attendance events
 * in localStorage. Replace FALLBACK_STUDENTS with the response from the sheet API.
 */
// The root entry is also served directly by GitHub Pages in some repository
// configurations. Keep both deployment modes supported: a static host can
// provide window.__ATTENDANCE_API_URL__, while Vite injects its build-time
// VITE_ATTENDANCE_API_URL value for production builds.
const API_BASE = globalThis.__ATTENDANCE_API_URL__ || import.meta.env?.VITE_ATTENDANCE_API_URL || '';
const STORAGE_KEY = 'ruang-kelas-attendance-v1';
const WA_KEY = 'ruang-kelas-wa-v1';
const SESSION_KEY = 'ruang-kelas-student-session-v1';
const DEVICE_KEY = 'ruang-kelas-device-token-v1';
const BINDING_KEY = 'ruang-kelas-device-bindings-v1';
const RESET_LOG_KEY = 'ruang-kelas-device-reset-log-v1';
const STAFF_SESSION_KEY = 'ruang-kelas-staff-session-v1';
const BRANCHES = [
  { id: 'CABANG-001', name: 'Hertasning', status: 'Aktif' },
  { id: 'CABANG-002', name: 'Panakkukang', status: 'Aktif' },
  { id: 'CABANG-003', name: 'Tamalanrea', status: 'Aktif' },
];
let branches = BRANCHES;
// Read-only preview of the supplied sheet (headers: User Serial, Nama Siswa,
// No Ortu, Nama Sekolah, Grade, Kelas). Production should load all rows via API.
const FALLBACK_STUDENTS = [
  { id: 'USERM5C6YF66', name: 'Muhammad Roofi Ismail Adhami', className: '12 KURMER R4.02', branch: 'Hertasning', branchId: 'CABANG-001', grade: '12 SMA', parentPhone: '' },
  { id: 'PRINCESSWTIOB03O', name: 'Princess Velvina Rahiel', className: '9 SMP R3.01', branch: 'Panakkukang', branchId: 'CABANG-002', grade: '9 SMP', parentPhone: '' },
  { id: 'SAFIRAAJ546XXOCK', name: 'Andi Safira Putri Maryam', className: '11 SMA R4.01', branch: 'Hertasning', branchId: 'CABANG-001', grade: '11 SMA', parentPhone: '' },
  { id: 'USERKL9G6CNG', name: 'Maylafayza Difa Anggraeny', className: 'SIAP SNBT R4.01', branch: 'Panakkukang', branchId: 'CABANG-002', grade: '12 SMA', parentPhone: '' },
  { id: 'KHALISTAEJ64P6SB', name: 'Khalista Amaliani Reikha Putri', className: '8 SMP R3.01', branch: 'Tamalanrea', branchId: 'CABANG-003', grade: '8 SMP', parentPhone: '' },
  { id: 'SYRENZX2MUDTULJT', name: 'Syren Fadhila Iftihar', className: 'SIAP SNBT R4.01', branch: 'Hertasning', branchId: 'CABANG-001', grade: '12 SMA', parentPhone: '628114189189' },
  { id: 'FIRLYNPKFZIS3AF7', name: 'Firly adinata castany', className: '11 SMA R4.03', branch: 'Panakkukang', branchId: 'CABANG-002', grade: '11 SMA', parentPhone: '' },
  { id: 'NAFISAHRORJ8JEXA', name: 'Nafisah Daneen Mawali', className: '9 SMP R3.01', branch: 'Tamalanrea', branchId: 'CABANG-003', grade: '9 SMP', parentPhone: '' },
]; 

let students = FALLBACK_STUDENTS;
let records = loadJson(STORAGE_KEY, {});
let waStatuses = loadJson(WA_KEY, {});
let studentSession = loadJson(SESSION_KEY, null);
let deviceBindings = loadJson(BINDING_KEY, {});
let deviceResetLog = loadJson(RESET_LOG_KEY, []);
let staffSession = loadJson(STAFF_SESSION_KEY, null);
let authRole = studentSession ? 'student' : staffSession?.role || null;
let pendingDeliveredId = null;
let pendingBindStudent = null;
let pendingResetStudentId = null;
let cameraStream = null;
let barcodeDetector = null;
let cameraTimer = null;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const dateKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Makassar' }).format(new Date());
const nowTime = () => new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Makassar' }).format(new Date());
const initials = (name) => name.split(' ').slice(0, 2).map((part) => part[0]).join('').toUpperCase();
const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
function loadJson(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; } }
function persist() { localStorage.setItem(STORAGE_KEY, JSON.stringify(records)); localStorage.setItem(WA_KEY, JSON.stringify(waStatuses)); localStorage.setItem(BINDING_KEY, JSON.stringify(deviceBindings)); localStorage.setItem(RESET_LOG_KEY, JSON.stringify(deviceResetLog)); if (studentSession) localStorage.setItem(SESSION_KEY, JSON.stringify(studentSession)); else localStorage.removeItem(SESSION_KEY); }
function persistStaffSession() { if (staffSession) localStorage.setItem(STAFF_SESSION_KEY, JSON.stringify(staffSession)); else localStorage.removeItem(STAFF_SESSION_KEY); }
function getDeviceToken() { let token = localStorage.getItem(DEVICE_KEY); if (!token) { token = crypto.randomUUID ? crypto.randomUUID() : `device-${Date.now()}-${Math.random().toString(36).slice(2)}`; localStorage.setItem(DEVICE_KEY, token); } return token; }
function hasDeviceToken() { return Boolean(localStorage.getItem(DEVICE_KEY)); }
function bindingFor(studentId) { return deviceBindings[studentId] || null; }
function staffHeaders() { return staffSession?.token && !API_BASE.includes('script.google.com') ? { 'X-Staff-Session': staffSession.token } : {}; }
function staffUrl(path) { const token = staffSession?.token; return token ? `${API_BASE}/${path}?token=${encodeURIComponent(token)}` : `${API_BASE}/${path}`; }
function requestHeaders(extra = {}) { return { 'Content-Type': API_BASE.includes('script.google.com') ? 'text/plain;charset=utf-8' : 'application/json', ...extra }; }
function deviceSessionValid(studentId) { const binding = bindingFor(studentId); const token = localStorage.getItem(DEVICE_KEY); return Boolean(binding?.status === 'TERDAFTAR' && token && binding.deviceToken === token); }
function tokenBelongsToAnotherStudent(studentId, token) { return Boolean(token && Object.entries(deviceBindings).some(([id, binding]) => id !== studentId && binding.status === 'TERDAFTAR' && binding.deviceToken === token)); }
function tokenWasReset(token) { return Boolean(token && deviceResetLog.some((entry) => entry.deviceToken === token && entry.status === 'DI-RESET')); }
function todayRecord(studentId) { const record = records[`${dateKey()}::${studentId}`] || null; return record?.branchId ? record : null; }
function allRows() { return students.map((student) => ({ student, record: todayRecord(student.id), wa: waStatuses[`${dateKey()}::${student.id}`] || { status: 'unprocessed' } })); }
function branchById(id) { return branches.find((branch) => branch.id.toUpperCase() === String(id).trim().toUpperCase() && branch.status !== 'Nonaktif'); }
function currentStudent() { return studentSession ? students.find((student) => student.id === studentSession.id) || studentSession : null; }

async function loadStudents() {
  if (!API_BASE) return;
  try {
    const response = await fetch(`${API_BASE}/students`);
    if (!response.ok) throw new Error('student endpoint unavailable');
    const data = await response.json();
    if (Array.isArray(data.students) && data.students.length) students = data.students.map((student) => ({ ...student, branchId: student.branchId || student.cabangId || '', branch: student.branch || student.branchName || '' }));
  } catch { showToast('Mode demo aktif — sambungkan endpoint Google Sheets untuk data sekolah.', 'warn'); }
}

async function loadBranches() {
  if (!API_BASE) return;
  try {
    const response = await fetch(`${API_BASE}/branches`);
    if (!response.ok) throw new Error('branch endpoint unavailable');
    const data = await response.json();
    if (Array.isArray(data.branches) && data.branches.length) branches = data.branches;
  } catch { showToast('Master cabang lokal digunakan sampai endpoint cabang tersedia.', 'warn'); }
}

async function loadDeviceBindings() {
  if (!API_BASE) return;
  try {
    const response = await fetch(`${API_BASE}/device-bindings`);
    if (!response.ok) throw new Error('device binding endpoint unavailable');
    const data = await response.json();
    if (data.bindings && typeof data.bindings === 'object') deviceBindings = data.bindings;
  } catch { showToast('Mode binding lokal aktif — hubungkan endpoint device binding untuk validasi server.', 'warn'); }
}

async function serverDeviceCheck(student, token) {
  if (!API_BASE) return { status: 'local' };
  try {
    const response = await fetch(`${API_BASE}/device-binding/check`, { method: 'POST', headers: requestHeaders(), body: JSON.stringify({ studentId: student.id, deviceToken: token || null }) });
    const data = await response.json();
    if (data.message && !data.status) return { status: 'error', message: data.message };
    if (!response.ok) return { status: 'error', message: data.message || 'Perangkat tidak dapat divalidasi.' };
    return data;
  } catch { return { status: 'error', message: 'Server device binding tidak tersedia.' }; }
}

async function loginStaff(role, password) {
  if (!API_BASE) return showToast('Backend autentikasi staf belum tersedia.', 'warn');
  try {
    const response = await fetch(`${API_BASE}/staff/login`, { method: 'POST', headers: requestHeaders(), body: JSON.stringify({ role, password }) });
    const data = await response.json();
    if (!response.ok || data.message || !data.token) return showToast(data.message || 'Login staf ditolak.', 'warn');
    staffSession = { role: data.role, token: data.token }; studentSession = null; authRole = data.role; persist(); persistStaffSession(); setView(role === 'admin' ? 'admin' : 'dashboard'); showToast(`Login ${role === 'admin' ? 'Admin' : 'Wali Kelas'} berhasil.`);
  } catch { showToast('Server autentikasi staf tidak tersedia.', 'warn'); }
}

async function bindDevice(student) {
  const token = getDeviceToken();
  if (tokenWasReset(token)) return showToast('Perangkat lama sudah di-reset. Gunakan perangkat baru atau hubungi Admin.', 'warn');
  if (tokenBelongsToAnotherStudent(student.id, token)) return showToast('Perangkat ini sudah terdaftar untuk akun siswa lain.', 'warn');
  const boundAt = new Date().toISOString();
  if (API_BASE) {
    try {
      const response = await fetch(`${API_BASE}/device-binding/bind`, { method: 'POST', headers: requestHeaders(staffHeaders()), body: JSON.stringify({ studentId: student.id, deviceToken: token, studentName: student.name }) });
      const data = await response.json();
      if (!response.ok || data.message) return showToast(data.message || 'Registrasi perangkat ditolak oleh server.', 'warn');
    } catch { return showToast('Registrasi perangkat gagal karena server tidak tersedia.', 'warn'); }
  }
  deviceBindings[student.id] = { studentId: student.id, studentName: student.name, deviceToken: token, status: 'TERDAFTAR', boundAt, updatedAt: boundAt };
  persist(); $('#bind-modal').hidden = true; pendingBindStudent = null; completeStudentLogin(student); showToast('Perangkat berhasil terdaftar untuk akun ini.');
}

function completeStudentLogin(student) { studentSession = { id: student.id, name: student.name, className: student.className, branch: student.branch, branchId: student.branchId }; authRole = 'student'; persist(); renderSession(); }

function saveAttendance(student, type) {
  const key = `${dateKey()}::${student.id}`;
  const current = records[key] || { date: dateKey(), studentId: student.id, name: student.name, className: student.className, branchId: student.branchId, branch: student.branch, status: 'Belum Pulang' };
  const time = nowTime();
  if (type === 'in') current.checkIn = time;
  if (type === 'out') { current.checkOut = time; current.status = 'Hadir'; }
  records[key] = current;
  persist();
  if (API_BASE) fetch(`${API_BASE}/attendance`, { method: 'POST', headers: requestHeaders(), body: JSON.stringify({ ...current, deviceToken: getDeviceToken() }) }).catch(() => {});
  return current;
}

function processScan(rawBranchId) {
  if (!studentSession) return showScanResult('Silakan login sebagai siswa sebelum melakukan presensi.', 'warning');
  const branchId = rawBranchId.trim().toUpperCase();
  const branch = branchById(branchId);
  const student = currentStudent();
  if (!branch) return showScanResult(`QR ${esc(branchId || 'cabang')} tidak dikenal. Presensi tidak dibuat.`, 'warning');
  if (!student) return showScanResult('Akun siswa tidak ditemukan. Silakan login kembali.', 'warning');
  if ((!API_BASE && !deviceSessionValid(student.id)) || (API_BASE && !hasDeviceToken())) { studentSession = null; authRole = null; persist(); setView('login'); return showScanResult('Perangkat tidak dikenali. Silakan hubungi Admin untuk reset perangkat.', 'warning'); }
  if (student.branchId && student.branchId.toUpperCase() !== branch.id) return showScanResult(`⚠️ <b>QR cabang tidak sesuai dengan data siswa.</b><br>Anda terdaftar di Cabang <strong>${esc(student.branch)}</strong>.`, 'warning');
  const current = todayRecord(student.id);
  if (!current) {
    const record = saveAttendance(student, 'in');
    showScanResult(`✅ <b>Presensi berhasil</b><br>Selamat datang, <strong>${esc(student.name)}</strong><br>Cabang: <strong>${esc(branch.name)}</strong><br>Jam datang: <strong>${record.checkIn}</strong>`, 'success');
    showToast(`${student.name} tercatat Jam Datang ${record.checkIn}`, 'success');
  } else if (!current.checkOut) {
    const record = saveAttendance(student, 'out');
    showScanResult(`✅ <b>Presensi pulang berhasil</b><br>Sampai jumpa, <strong>${esc(student.name)}</strong><br>Cabang: <strong>${esc(branch.name)}</strong><br>Jam pulang: <strong>${record.checkOut}</strong>`, 'success');
    showToast(`${student.name} tercatat Jam Pulang ${record.checkOut}`, 'success');
  } else {
    showScanResult(`ℹ️ <b>Presensi hari ini sudah lengkap.</b><br>Jam datang: <strong>${current.checkIn}</strong><br>Jam pulang: <strong>${current.checkOut}</strong>`, 'warning');
  }
  $('#barcode-input').value = '';
  renderAll();
}

function showScanResult(html, kind) { const box = $('#scan-result'); box.innerHTML = html; box.className = `scan-result show ${kind}`; }
function showToast(message, kind = 'success') { const toast = document.createElement('div'); toast.className = `toast ${kind}`; toast.textContent = message; $('#toast-region').append(toast); setTimeout(() => toast.remove(), 3900); }

function renderSummary() {
  const student = currentStudent();
  const record = student ? todayRecord(student.id) : null;
  $('#today-present').textContent = record ? (record.checkOut ? '✓' : '1') : '—';
  $('#today-summary-label').textContent = record?.checkOut ? 'Presensi lengkap hari ini' : record ? 'Menunggu Jam Pulang' : 'Belum presensi hari ini';
  $('#today-in').textContent = record?.checkIn || '—'; $('#today-out').textContent = record?.checkOut || '—'; $('#today-absent').textContent = record?.branch || student?.branch || '—';
  $('#today-progress').style.width = record?.checkOut ? '100%' : record ? '50%' : '0%';
  $('#recent-count').textContent = record ? (record.checkOut ? 'Lengkap' : 'Sudah datang') : 'Belum mulai';
  $('#recent-list').innerHTML = student ? `<div class="recent-item"><span class="recent-avatar">${initials(student.name)}</span><div><b>${esc(student.name)}</b><small>${record ? (record.checkOut ? 'Jam Datang & Pulang' : 'Jam Datang tercatat') : `Terdaftar di ${esc(student.branch || 'cabang')}`}</small></div><span class="recent-time">${record?.checkOut || record?.checkIn || '—'}</span></div>` : '<div class="empty-state" style="padding:16px 0"><span>Login untuk melihat status presensi.</span></div>';
}

function renderDashboard() {
  const rows = allRows();
  const present = rows.filter(({ record }) => record).length;
  const out = rows.filter(({ record }) => record?.checkOut).length;
  $('#stat-total').textContent = rows.length; $('#stat-present').textContent = present; $('#stat-absent').textContent = rows.length - present; $('#stat-out').textContent = out; $('#stat-not-out').textContent = present - out; $('#present-percent').textContent = `${rows.length ? Math.round((present / rows.length) * 100) : 0}%`;
  const query = ($('#search-input').value || '').trim().toLowerCase();
  const classValue = $('#class-filter').value; const attendance = $('#attendance-filter').value; const waFilter = $('#wa-filter').value;
  const filtered = rows.filter(({ student, record, wa }) => {
    const matchQuery = !query || student.name.toLowerCase().includes(query) || student.id.toLowerCase().includes(query);
    const matchClass = classValue === 'all' || student.className === classValue;
    const matchAttendance = attendance === 'all' || (attendance === 'present' && record) || (attendance === 'absent' && !record) || (attendance === 'out' && record?.checkOut) || (attendance === 'not-out' && record && !record.checkOut);
    return matchQuery && matchClass && matchAttendance && (waFilter === 'all' || wa.status === waFilter);
  });
  $('#table-total').textContent = rows.length; $('#table-showing').textContent = filtered.length;
  const activeFilters = [classValue !== 'all', attendance !== 'all', waFilter !== 'all'].filter(Boolean).length; $('#filter-count').textContent = activeFilters; $('#filter-count').classList.toggle('show', activeFilters > 0);
  $('#attendance-body').innerHTML = filtered.map(({ student, record, wa }) => {
    const attendanceBadge = !record ? '<span class="attendance-badge absent">Belum Hadir</span>' : record.checkOut ? '<span class="attendance-badge present">Sudah Pulang</span>' : '<span class="attendance-badge not-out">Belum Pulang</span>';
    const waLabel = wa.status === 'delivered' ? '✓ Sudah Terkirim' : wa.status === 'processed' ? '◷ Sudah Diproses' : 'Belum Diproses';
    const waButton = record ? `<button class="wa-action" data-wa="${esc(student.id)}">▣ Send WA</button>` : '<button class="wa-action disabled" disabled>▣ Send WA</button>';
    return `<tr><td><div class="student-cell"><span class="student-avatar">${initials(student.name)}</span><div><b>${esc(student.name)}</b><small>${esc(student.id)}</small></div></div></td><td>${esc(student.className)}</td><td>${esc(record?.branch || student.branch || '—')}</td><td class="time-cell">${record?.checkIn || '<span class="dash">—</span>'}</td><td class="time-cell">${record?.checkOut || '<span class="dash">—</span>'}</td><td>${attendanceBadge}</td><td><button class="wa-badge ${wa.status}" data-status-id="${esc(student.id)}">${waLabel}</button></td><td>${waButton}</td></tr>`;
  }).join('');
  $('#empty-state').hidden = filtered.length !== 0;
}

function renderClassOptions() {
  const select = $('#class-filter');
  const current = select.value;
  const classes = [...new Set(students.map((student) => student.className).filter(Boolean))].sort();
  select.innerHTML = '<option value="all">Semua kelas</option>' + classes.map((className) => `<option value="${esc(className)}">${esc(className)}</option>`).join('');
  select.value = classes.includes(current) ? current : 'all';
}

function renderDeviceManagement() {
  const query = ($('#device-search').value || '').trim().toLowerCase();
  const statusFilter = $('#device-status-filter').value;
  const rows = students.map((student) => ({ student, binding: bindingFor(student.id) })).filter(({ student, binding }) => {
    const status = binding?.status || 'BELUM_TERDAFTAR';
    return (!query || student.name.toLowerCase().includes(query) || student.id.toLowerCase().includes(query)) && (statusFilter === 'all' || status === statusFilter);
  });
  $('#device-total').textContent = students.length; $('#device-showing').textContent = rows.length;
  $('#device-body').innerHTML = rows.map(({ student, binding }) => {
    const status = binding?.status || 'BELUM_TERDAFTAR';
    const statusLabel = status === 'TERDAFTAR' ? '🟢 Aktif' : status === 'DI-RESET' ? '↺ Di-Reset' : '🔴 Belum Terdaftar';
    const date = binding?.boundAt ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(binding.boundAt)) : '—';
    const action = status === 'TERDAFTAR' ? `<button class="wa-action reset-device-action" data-reset-device="${esc(student.id)}">Reset Device</button>` : '<span class="dash">—</span>';
    return `<tr><td><div class="student-cell"><span class="student-avatar">${initials(student.name)}</span><div><b>${esc(student.name)}</b><small>${esc(student.className)}</small></div></div></td><td class="time-cell">${esc(student.id)}</td><td><span class="device-status-badge ${status.toLowerCase().replace(/[^a-z-]/g, '')}">${statusLabel}</span></td><td>${date}</td><td>${action}</td></tr>`;
  }).join('');
  $('#device-empty').hidden = rows.length !== 0;
}

function openBindModal() { $('#bind-modal').hidden = false; }
function cancelBind() { pendingBindStudent = null; $('#bind-modal').hidden = true; }
function openResetDevice(studentId) { const student = students.find((item) => item.id === studentId); if (!student) return; pendingResetStudentId = studentId; $('#reset-device-copy').textContent = `Reset binding untuk ${student.name}? Setelah di-reset, siswa tidak dapat menggunakan perangkat lama sampai melakukan registrasi pada perangkat baru.`; $('#reset-device-modal').hidden = false; }
async function confirmResetDevice() {
  const student = students.find((item) => item.id === pendingResetStudentId); const binding = student && bindingFor(student.id); if (!student || !binding) return;
  const resetAt = new Date().toISOString();
  if (API_BASE) {
    try { const response = await fetch(staffUrl('device-binding/reset'), { method: 'POST', headers: requestHeaders(staffHeaders()), body: JSON.stringify({ studentId: student.id, admin: 'Admin', reason: 'Reset Device' }) }); const data = await response.json(); if (!response.ok || data.message || data.status !== 'DI-RESET') return showToast(data.message || 'Reset Device ditolak oleh server.', 'warn'); } catch { return showToast('Reset Device gagal karena server tidak tersedia.', 'warn'); }
  }
  deviceResetLog.push({ id: `RESET-${Date.now()}`, studentId: student.id, studentName: student.name, deviceToken: binding.deviceToken, resetAt, admin: 'Admin', reason: 'Reset Device', status: 'DI-RESET' });
  deviceBindings[student.id] = { ...binding, deviceToken: null, status: 'DI-RESET', resetAt, updatedAt: resetAt }; if (studentSession?.id === student.id) { studentSession = null; authRole = null; } persist(); $('#reset-device-modal').hidden = true; pendingResetStudentId = null; if (!studentSession) setView('login'); else renderDeviceManagement(); showToast(`Device ${student.name} berhasil di-reset.`);
}

function renderAll() { renderSummary(); renderDashboard(); }

function setView(view) {
  if (view === 'dashboard' && !['teacher', 'admin'].includes(authRole)) { showToast('Dashboard khusus Wali Kelas. Silakan login sebagai wali kelas.', 'warn'); return setView('login'); }
  if (view === 'admin' && authRole !== 'admin') { showToast('Manajemen Device hanya dapat diakses Admin.', 'warn'); return setView('login'); }
  $$('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  $('#login-view').classList.toggle('active-view', view === 'login'); $('#scan-view').classList.toggle('active-view', view === 'scan'); $('#dashboard-view').classList.toggle('active-view', view === 'dashboard'); $('#admin-view').classList.toggle('active-view', view === 'admin');
  $('#page-context').textContent = view === 'scan' ? 'Presensi / Scan' : view === 'login' ? 'Login Siswa' : view === 'admin' ? 'Manajemen Device' : 'Dashboard Wali Kelas';
  if (view === 'admin') renderDeviceManagement();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function populateStudentAccounts() {
  const select = $('#student-account');
  select.innerHTML = '<option value="">Pilih nama siswa</option>' + students.map((student) => `<option value="${esc(student.id)}">${esc(student.name)} · ${esc(student.className)}</option>`).join('');
}

function renderSession() {
  const student = currentStudent();
  if (!student) { setView('login'); return; }
  $('#greeting-name').innerHTML = `Halo, ${esc(student.name.split(' ')[0])} <span class="wave">✦</span>`;
  $('#session-student-name').textContent = student.name;
  $('#session-student-meta').textContent = `${student.className} · Cabang ${student.branch || 'belum dipetakan'}`;
  $('#session-avatar').textContent = initials(student.name);
  $('#session-role').textContent = 'AKUN SISWA';
  setView('scan'); renderSummary();
}

async function resumeStudentSession() {
  if (!studentSession) return setView('login');
  if (!hasDeviceToken()) { studentSession = null; authRole = null; persist(); showToast('Perangkat tidak dikenali. Silakan hubungi Admin untuk reset perangkat.', 'warn'); return setView('login'); }
  if (API_BASE) { const student = currentStudent(); const result = await serverDeviceCheck(student, localStorage.getItem(DEVICE_KEY)); if (result.status !== 'TERDAFTAR') { studentSession = null; authRole = null; persist(); return setView('login'); } }
  else if (!deviceSessionValid(studentSession.id)) { studentSession = null; authRole = null; persist(); return setView('login'); }
  renderSession();
}

async function loginStudent() {
  const student = students.find((item) => item.id === $('#student-account').value);
  if (!student) return showToast('Pilih akun siswa terlebih dahulu.', 'warn');
  if (!student.branchId) return showToast('Cabang siswa belum dipetakan oleh admin.', 'warn');
  const token = localStorage.getItem(DEVICE_KEY);
  if (token && tokenBelongsToAnotherStudent(student.id, token)) return showToast('Perangkat ini sudah terdaftar untuk akun siswa lain. Silakan gunakan perangkat yang terdaftar atau hubungi Admin.', 'warn');
  const serverCheck = await serverDeviceCheck(student, token);
  if (serverCheck.status === 'error') return showToast(serverCheck.message, 'warn');
  if (API_BASE && serverCheck.status === 'TERDAFTAR') { completeStudentLogin(student); showToast(`Selamat datang kembali, ${student.name}.`); return; }
  if (API_BASE && serverCheck.status === 'BELUM_TERDAFTAR') { pendingBindStudent = student; $('#bind-modal-copy').textContent = `Perangkat ini belum terdaftar untuk akun ${student.name}. Daftarkan perangkat ini? Satu akun siswa hanya dapat menggunakan satu perangkat.`; $('#bind-modal').hidden = false; return; }
  if (API_BASE && serverCheck.status === 'DEVICE_DI_RESET' && token) return showToast(serverCheck.message, 'warn');
  if (API_BASE && serverCheck.status === 'DI-RESET' && !token) { pendingBindStudent = student; $('#bind-modal-copy').textContent = `Binding sebelumnya sudah di-reset oleh Admin. Daftarkan perangkat baru untuk akun ${student.name}?`; $('#bind-modal').hidden = false; return; }
  const binding = bindingFor(student.id);
  if (!binding) { pendingBindStudent = student; $('#bind-modal-copy').textContent = `Perangkat ini belum terdaftar untuk akun ${student.name}. Daftarkan perangkat ini? Satu akun siswa hanya dapat menggunakan satu perangkat.`; $('#bind-modal').hidden = false; return; }
  if (binding.status === 'DI-RESET') {
    if (token && tokenWasReset(token)) return showToast('Perangkat lama sudah di-reset. Gunakan perangkat baru atau hubungi Admin.', 'warn');
    pendingBindStudent = student; $('#bind-modal-copy').textContent = `Binding sebelumnya sudah di-reset oleh Admin. Daftarkan perangkat baru untuk akun ${student.name}?`; $('#bind-modal').hidden = false; return;
  }
  if (!hasDeviceToken()) return showToast('Perangkat tidak dikenali. Silakan hubungi Admin untuk reset perangkat.', 'warn');
  if (binding.deviceToken !== getDeviceToken()) return showToast('Akun ini sudah terdaftar pada perangkat lain. Silakan hubungi Admin untuk melakukan reset perangkat.', 'warn');
  completeStudentLogin(student); showToast(`Selamat datang kembali, ${student.name}.`);
}

function logoutStudent() { studentSession = null; authRole = null; persist(); stopCamera(); $('#scan-result').className = 'scan-result'; setView('login'); showToast('Anda telah keluar dari akun siswa.'); }

function sendWA(studentId) {
  const row = allRows().find(({ student }) => student.id === studentId); if (!row?.record) return;
  const { student, record } = row;
  const message = record.checkOut ? `Halo Ayah/Bunda ${student.name}, kami informasikan bahwa ${student.name} telah mengikuti pembelajaran hari ini. Jam datang: ${record.checkIn}. Jam pulang: ${record.checkOut}. Terima kasih.` : `Halo Ayah/Bunda ${student.name}, kami informasikan bahwa ${student.name} telah hadir mengikuti pembelajaran hari ini pada pukul ${record.checkIn}.`;
  const phone = String(student.parentPhone || '').replace(/\D/g, '');
  if (!phone) return showToast('Nomor WhatsApp orang tua belum tersedia.', 'warn');
  const key = `${dateKey()}::${student.id}`;
  waStatuses[key] = { status: 'processed', processedAt: new Date().toISOString(), studentId: student.id }; persist();
  if (API_BASE) fetch(`${API_BASE}/wa-status`, { method: 'POST', headers: requestHeaders(), body: JSON.stringify({ date: dateKey(), studentId: student.id, status: 'processed', processedAt: waStatuses[key].processedAt }) }).catch(() => {});
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer');
  showToast(`WhatsApp untuk ${student.name} dibuka. Status: Sudah Diproses.`); renderDashboard();
}

function openConfirm(studentId) { pendingDeliveredId = studentId; $('#confirm-modal').hidden = false; }
function confirmDelivered() { if (!pendingDeliveredId) return; const key = `${dateKey()}::${pendingDeliveredId}`; waStatuses[key] = { ...(waStatuses[key] || {}), status: 'delivered', deliveredAt: new Date().toISOString(), studentId: pendingDeliveredId }; persist(); if (API_BASE) fetch(`${API_BASE}/wa-status`, { method: 'POST', headers: requestHeaders(), body: JSON.stringify({ date: dateKey(), studentId: pendingDeliveredId, status: 'delivered', deliveredAt: waStatuses[key].deliveredAt }) }).catch(() => {}); $('#confirm-modal').hidden = true; pendingDeliveredId = null; renderDashboard(); showToast('Status diubah menjadi Sudah Terkirim.'); }

async function activateCamera() {
  if (!navigator.mediaDevices?.getUserMedia) return showToast('Kamera tidak tersedia di browser ini. Gunakan input ID manual.', 'warn');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); cameraStream = stream;
    const stage = $('#scanner-stage'); let video = $('#camera-preview');
    if (!video) { video = document.createElement('video'); video.id = 'camera-preview'; video.autoplay = true; video.muted = true; video.playsInline = true; video.style.cssText = 'position:absolute;inset:16px;width:calc(100% - 32px);height:150px;object-fit:cover;border-radius:8px;opacity:.8;z-index:3'; stage.prepend(video); }
    video.srcObject = stream; $('#camera-button').innerHTML = '<span>■</span> Kamera aktif'; showToast('Kamera aktif. Arahkan barcode ke area pemindaian.');
    if ('BarcodeDetector' in window) { barcodeDetector = new BarcodeDetector({ formats: ['qr_code', 'code_128', 'code_39', 'ean_13'] }); scanVideo(video); } else showToast('Pemindaian otomatis belum didukung browser ini; masukkan ID manual.', 'warn');
  } catch { showToast('Izin kamera ditolak. Anda tetap dapat memasukkan ID manual.', 'warn'); }
}
async function scanVideo(video) { if (!barcodeDetector || !cameraStream) return; try { const codes = await barcodeDetector.detect(video); if (codes[0]?.rawValue) { processScan(codes[0].rawValue); stopCamera(); return; } } catch { /* continue */ } cameraTimer = setTimeout(() => scanVideo(video), 500); }
function stopCamera() { cameraStream?.getTracks().forEach((track) => track.stop()); cameraStream = null; if (cameraTimer) clearTimeout(cameraTimer); }

document.addEventListener('click', (event) => {
  const nav = event.target.closest('[data-view]'); if (nav) setView(nav.dataset.view);
  const role = event.target.closest('[data-role]'); if (role) { $$('.role-tab').forEach((tab) => tab.classList.toggle('active', tab === role)); const studentRole = role.dataset.role === 'student'; const teacherRole = role.dataset.role === 'teacher'; $('#student-login-panel').hidden = !studentRole; $('#teacher-login-panel').hidden = !teacherRole; $('#admin-login-panel').hidden = role.dataset.role !== 'admin'; }
  const resetDevice = event.target.closest('[data-reset-device]'); if (resetDevice) openResetDevice(resetDevice.dataset.resetDevice);
  const wa = event.target.closest('[data-wa]'); if (wa) sendWA(wa.dataset.wa);
  const status = event.target.closest('[data-status-id]'); if (status && waStatuses[`${dateKey()}::${status.dataset.statusId}`]?.status === 'processed') openConfirm(status.dataset.statusId);
});
$('#scan-form').addEventListener('submit', (event) => { event.preventDefault(); processScan($('#barcode-input').value); });
$('#student-login-submit').addEventListener('click', loginStudent);
$('#teacher-login-submit').addEventListener('click', () => loginStaff('teacher', $('#teacher-password').value));
$('#admin-login-submit').addEventListener('click', () => loginStaff('admin', $('#admin-password').value));
$('#logout-button').addEventListener('click', logoutStudent);
$('#bind-cancel').addEventListener('click', cancelBind); $('#bind-confirm').addEventListener('click', () => { if (pendingBindStudent) bindDevice(pendingBindStudent); });
$('#reset-device-cancel').addEventListener('click', () => { pendingResetStudentId = null; $('#reset-device-modal').hidden = true; }); $('#reset-device-confirm').addEventListener('click', confirmResetDevice);
$('#clear-input').addEventListener('click', () => { $('#barcode-input').value = ''; $('#barcode-input').focus(); });
$('#camera-button').addEventListener('click', activateCamera);
$('#search-input').addEventListener('input', renderDashboard); $('#class-filter').addEventListener('change', renderDashboard); $('#attendance-filter').addEventListener('change', renderDashboard); $('#wa-filter').addEventListener('change', renderDashboard);
$('#filter-toggle').addEventListener('click', () => $('#filter-row').classList.toggle('show'));
$('#reset-filter').addEventListener('click', () => { $('#class-filter').value = 'all'; $('#attendance-filter').value = 'all'; $('#wa-filter').value = 'all'; $('#search-input').value = ''; renderDashboard(); });
$('#device-search').addEventListener('input', renderDeviceManagement); $('#device-status-filter').addEventListener('change', renderDeviceManagement); $('#refresh-device-button').addEventListener('click', () => { renderDeviceManagement(); showToast('Daftar device berhasil disegarkan.'); });
$('#refresh-button').addEventListener('click', () => { renderAll(); showToast('Rekap berhasil disegarkan.'); });
$('#export-button').addEventListener('click', () => { const rows = allRows(); const csv = [['Siswa', 'ID', 'Kelas', 'ID Cabang', 'Cabang', 'Jam Datang', 'Jam Pulang', 'Status', 'Status WA'], ...rows.map(({ student, record, wa }) => [student.name, student.id, student.className, record?.branchId || student.branchId || '', record?.branch || student.branch || '', record?.checkIn || '', record?.checkOut || '', record ? (record.checkOut ? 'Hadir' : 'Belum Pulang') : 'Belum Hadir', wa.status])].map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n'); const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); link.download = `rekap-presensi-${dateKey()}.csv`; link.click(); URL.revokeObjectURL(link.href); showToast('Rekap CSV berhasil diunduh.'); });
$('#modal-cancel').addEventListener('click', () => { $('#confirm-modal').hidden = true; pendingDeliveredId = null; }); $('#modal-confirm').addEventListener('click', confirmDelivered);
window.addEventListener('beforeunload', stopCamera);

$('#display-date').textContent = new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Makassar' }).format(new Date());
Promise.all([loadStudents(), loadBranches(), loadDeviceBindings()]).finally(() => { populateStudentAccounts(); renderClassOptions(); renderAll(); resumeStudentSession(); });
