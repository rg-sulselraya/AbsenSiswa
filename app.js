import QRCode from 'qrcode';
import jsQR from 'jsqr';

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
const DEFAULT_API_BASE = 'https://script.google.com/macros/s/AKfycbze3U9LkJK-Z_JvJRyOzrA47G44Asc4hRAvdhbg7LznIIW7c8D8El2HjV-h0qv7Y4EIwA/exec';
const API_BASE = globalThis.__ATTENDANCE_API_URL__ || import.meta.env?.VITE_ATTENDANCE_API_URL || DEFAULT_API_BASE;
const STORAGE_KEY = 'ruang-kelas-attendance-v1';
const WA_KEY = 'ruang-kelas-wa-v1';
const SESSION_KEY = 'ruang-kelas-student-session-v1';
const DEVICE_KEY = 'ruang-kelas-device-token-v1';
const BINDING_KEY = 'ruang-kelas-device-bindings-v1';
const RESET_LOG_KEY = 'ruang-kelas-device-reset-log-v1';
const STAFF_SESSION_KEY = 'ruang-kelas-staff-session-v1';
const PROFILE_PHOTO_KEY = 'ruang-kelas-profile-photo-v1';
const STUDENTS_CACHE_KEY = 'ruang-kelas-students-cache-v1';
const BRANCHES = [
  { id: 'CABANG-001', name: 'Hertasning', status: 'Aktif' },
  { id: 'CABANG-002', name: 'Panakkukang', status: 'Aktif' },
  { id: 'CABANG-003', name: 'Tamalanrea', status: 'Aktif' },
];
let branches = API_BASE ? [] : BRANCHES;
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

let students = loadJson(STUDENTS_CACHE_KEY, FALLBACK_STUDENTS);
let studentsLoadState = API_BASE ? 'loading' : 'ready';
let branchesLoadState = API_BASE ? 'loading' : 'ready';
let studentsLoadPromise = null;
let branchesLoadPromise = null;
let records = loadJson(STORAGE_KEY, {});
let waStatuses = loadJson(WA_KEY, {});
let studentSession = loadJson(SESSION_KEY, null);
let deviceBindings = loadJson(BINDING_KEY, {});
let deviceBindingsLoadState = API_BASE ? 'idle' : 'ready';
let deviceResetLog = loadJson(RESET_LOG_KEY, []);
let staffSession = loadJson(STAFF_SESSION_KEY, null);
let authRole = studentSession ? 'student' : staffSession?.role || null;
let pendingDeliveredId = null;
let pendingDeliveredType = null;
let pendingBindStudent = null;
let pendingResetStudentId = null;
let loginInProgress = false;
let bindInProgress = false;
let scanInProgress = false;
let scannerLocked = false;
let classSummaryRowsState = [];
let classDetailState = { title: '', items: [], metric: '' };
let classSummaryLoadState = API_BASE ? 'loading' : 'ready';
let cameraStream = null;
let barcodeDetector = null;
let cameraTimer = null;
let scanCanvas = null;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
function setProcessing(visible, title = 'Sedang memproses...', copy = 'Mohon tunggu sebentar.') { const overlay = $('#processing-overlay'); if (!overlay) return; overlay.hidden = !visible; $('#processing-title').textContent = title; $('#processing-copy').textContent = copy; }
async function runWithProcessing(button, task, title = 'Sedang memproses...') { if (button?.disabled) return; const original = button?.innerHTML; if (button) { button.disabled = true; button.classList.add('is-loading'); button.innerHTML = `<span class="button-spinner" aria-hidden="true"></span>${title}`; } setProcessing(true, title); try { return await task(); } finally { if (button) { button.disabled = false; button.classList.remove('is-loading'); button.innerHTML = original; } setProcessing(false); } }
const dateKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Makassar' }).format(new Date());
const nowTime = () => new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Makassar' }).format(new Date());
const formatAttendanceTime = (value, expectedDate = '') => { const text = String(value ?? '').trim(); if (!text || /^0{1,2}[.:]0{2}$/.test(text)) return ''; if (/^\d{1,2}[.:]\d{2}$/.test(text)) return text.replace('.', ':'); const parsed = new Date(text); if (Number.isNaN(parsed.getTime())) return text; if (expectedDate && /^\d{4}-\d{2}-\d{2}[T\s]/.test(text) && new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Makassar' }).format(parsed) !== expectedDate) return ''; if (parsed.getFullYear() <= 1900) return ''; const formatted = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Makassar' }).format(parsed); return formatted === '00:00' ? '' : formatted; };
const initials = (name) => name.split(' ').slice(0, 2).map((part) => part[0]).join('').toUpperCase();
const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
function loadJson(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; } }
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function fetchJsonWithRetry(url, options = {}, attempts = 3) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(url, { cache: 'no-store', ...options, signal: controller.signal });
      let data = null;
      try { data = await response.json(); } catch { /* handled below */ }
      if (!response.ok) throw new Error(`${options.method || 'GET'} ${url} returned ${response.status}`);
      if (data === null) throw new Error('Invalid JSON response');
      return { response, data };
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) await wait(attempt === 0 ? 500 : 1000);
    } finally { clearTimeout(timeout); }
  }
  throw lastError || new Error('Request failed');
}
function normalizeSearch(value) { return String(value ?? '').trim().toLocaleLowerCase('id-ID').replace(/\s+/g, ' '); }
function apiDataError(kind) { return kind === 'students' ? 'Data siswa belum tersedia. Periksa koneksi server lalu coba lagi.' : 'Data cabang belum tersedia. Periksa koneksi server lalu coba lagi.'; }
function persist() { localStorage.setItem(STORAGE_KEY, JSON.stringify(records)); localStorage.setItem(WA_KEY, JSON.stringify(waStatuses)); localStorage.setItem(BINDING_KEY, JSON.stringify(deviceBindings)); localStorage.setItem(RESET_LOG_KEY, JSON.stringify(deviceResetLog)); if (studentSession) localStorage.setItem(SESSION_KEY, JSON.stringify(studentSession)); else localStorage.removeItem(SESSION_KEY); }
function persistStaffSession() { if (staffSession) localStorage.setItem(STAFF_SESSION_KEY, JSON.stringify(staffSession)); else localStorage.removeItem(STAFF_SESSION_KEY); }
function profileIdentity() {
  if (studentSession) { const student = currentStudent(); return { name: student?.name || studentSession.name || 'Nama Siswa', role: 'Siswa', initials: initials(student?.name || studentSession.name || 'NA') }; }
  if (['teacher', 'admin'].includes(authRole) || staffSession) return { name: 'Student Mentor', role: 'Akses penuh', initials: 'SM' };
  return { name: 'Nama Siswa', role: 'Belum login', initials: 'NA' };
}
function renderProfileIdentity() {
  const wrap = $('.profile-menu-wrap'); const authenticated = Boolean(studentSession || staffSession || ['teacher', 'admin'].includes(authRole)); if (wrap) wrap.hidden = !authenticated; if (!authenticated) closeProfileMenu();
  const branchBarcodeNav = $('#branch-barcode-nav'); if (branchBarcodeNav) branchBarcodeNav.hidden = !['teacher', 'admin'].includes(authRole);
  const identity = profileIdentity(); const name = $('#profile-name'); const role = $('#profile-role'); const avatar = $('#profile-avatar'); if (!name || !role || !avatar) return;
  name.textContent = identity.name; role.textContent = identity.role;
  const photo = localStorage.getItem(PROFILE_PHOTO_KEY); avatar.textContent = photo ? '' : identity.initials; avatar.style.backgroundImage = photo ? `url("${photo}")` : ''; avatar.classList.toggle('has-photo', Boolean(photo));
}
function closeProfileMenu() { const menu = $('#profile-menu'); const trigger = $('#profile-trigger'); if (!menu || !trigger) return; menu.hidden = true; trigger.setAttribute('aria-expanded', 'false'); }
function toggleProfileMenu() { const menu = $('#profile-menu'); const trigger = $('#profile-trigger'); if (!menu || !trigger) return; menu.hidden = !menu.hidden; trigger.setAttribute('aria-expanded', String(!menu.hidden)); }
function logoutCurrentAccount() { studentSession = null; staffSession = null; authRole = null; persist(); persistStaffSession(); closeProfileMenu(); stopCamera(); setView('login'); renderProfileIdentity(); showToast('Anda telah keluar dari akun.'); }
function getDeviceToken() { let token = localStorage.getItem(DEVICE_KEY); if (!token) { token = crypto.randomUUID ? crypto.randomUUID() : `device-${Date.now()}-${Math.random().toString(36).slice(2)}`; localStorage.setItem(DEVICE_KEY, token); } return token; }
function hasDeviceToken() { return Boolean(localStorage.getItem(DEVICE_KEY)); }
function bindingFor(studentId) {
  const wanted = String(studentId || '').trim().toUpperCase();
  if (!wanted) return null;
  if (deviceBindings[studentId]) return deviceBindings[studentId];
  const match = Object.entries(deviceBindings).find(([id, binding]) => String(id || binding?.studentId || '').trim().toUpperCase() === wanted);
  return match ? match[1] : null;
}
function bindingStatus(binding) { const raw = String(binding?.status || '').trim().toLowerCase(); if (/reset|revoke|nonaktif|inactive|disabled/.test(raw)) return 'DI-RESET'; if (binding?.deviceToken || binding?.deviceId || /terdaftar|registered|aktif|active/.test(raw)) return 'TERDAFTAR'; return 'BELUM_TERDAFTAR'; }
function staffHeaders() { return staffSession?.token && !API_BASE.includes('script.google.com') ? { 'X-Staff-Session': staffSession.token } : {}; }
function apiUrl(path, query = {}) {
  const params = new URLSearchParams(query);
  if (API_BASE.includes('script.google.com')) {
    params.set('route', path);
    return `${API_BASE}?${params.toString()}`;
  }
  const base = API_BASE.replace(/\/$/, '');
  return `${base}/${path}${params.toString() ? `?${params.toString()}` : ''}`;
}
function staffUrl(path) { return apiUrl(path, staffSession?.token ? { token: staffSession.token } : {}); }
function requestHeaders(extra = {}) { return { 'Content-Type': API_BASE.includes('script.google.com') ? 'text/plain;charset=utf-8' : 'application/json', ...extra }; }
const AUTH_TIMEOUT_MS = 15000;
function authErrorMessage(code, role = 'teacher') {
  if (code === 'AUTH_CONFIG_MISSING' || code === 'ADMIN_TOKEN_NOT_CONFIGURED') return 'Konfigurasi autentifikasi staf belum lengkap.';
  if (code === 'AUTH_FAILED') return role === 'teacher' ? 'Password Student Mentor salah.' : 'Password Admin salah.';
  if (code === 'STAFF_NOT_FOUND') return 'Akun Student Mentor tidak ditemukan.';
  if (code === 'AUTH_TIMEOUT') return 'Server autentifikasi terlalu lama merespons.';
  if (code === 'AUTH_INVALID_RESPONSE') return 'Response server autentifikasi tidak valid.';
  return 'Server autentifikasi staf tidak tersedia. Silakan coba lagi.';
}
function studentAuthErrorMessage(code) {
  if (code === 'STUDENT_PASSWORD_REQUIRED') return 'Masukkan password siswa.';
  if (code === 'STUDENT_AUTH_FAILED') return 'PIN yang Anda masukkan tidak sesuai.';
  if (code === 'STUDENT_PASSWORD_NOT_CONFIGURED') return 'Password siswa belum dikonfigurasi. Hubungi Student Mentor.';
  if (code === 'AUTH_TIMEOUT') return 'Server autentifikasi siswa terlalu lama merespons.';
  if (code === 'AUTH_INVALID_RESPONSE') return 'Response server autentifikasi siswa tidak valid.';
  return 'Server autentifikasi siswa tidak tersedia. Silakan coba lagi.';
}
function deviceSessionValid(studentId) { const binding = bindingFor(studentId); const token = localStorage.getItem(DEVICE_KEY); return Boolean(binding?.status === 'TERDAFTAR' && token && binding.deviceToken === token); }
function tokenBelongsToAnotherStudent(studentId, token) { return Boolean(token && Object.entries(deviceBindings).some(([id, binding]) => id !== studentId && binding.status === 'TERDAFTAR' && binding.deviceToken === token)); }
function tokenWasReset(token) { return Boolean(token && deviceResetLog.some((entry) => entry.deviceToken === token && entry.status === 'DI-RESET')); }
function todayRecord(studentId) {
  const record = records[`${dateKey()}::${studentId}`];
  if (!record) return null;
  const checkIn = formatAttendanceTime(record.checkIn || '', record.date || dateKey());
  const checkOut = formatAttendanceTime(record.checkOut || '', record.date || dateKey());
  if (!checkIn && !checkOut) return null;
  return { ...record, checkIn, checkOut };
}
function normalizeWaStatus(value) { const blank = { status: 'unprocessed' }; if (!value) return { arrival: { ...blank }, departure: { ...blank } }; if (value.arrival || value.departure) return { arrival: { ...blank, ...(value.arrival || {}) }, departure: { ...blank, ...(value.departure || {}) } }; return { arrival: { ...blank, ...value }, departure: { ...blank } }; }
function normalizeWaStatusValue(value) { const raw = String(value || '').trim().toLowerCase(); if (/delivered|terkirim|sudah terkirim|sent/.test(raw)) return 'delivered'; if (/processed|diproses|sudah diproses/.test(raw)) return 'processed'; return 'unprocessed'; }
function waStatusFor(key, type) { return normalizeWaStatus(waStatuses[key])[type === 'departure' ? 'departure' : 'arrival']; }
function saveWaStatus(key, type, value) { const current = normalizeWaStatus(waStatuses[key]); current[type === 'departure' ? 'departure' : 'arrival'] = { ...current[type === 'departure' ? 'departure' : 'arrival'], ...value }; waStatuses[key] = current; return current[type === 'departure' ? 'departure' : 'arrival']; }
async function syncWaStatus(payload) {
  if (!API_BASE) return true;
  try {
    const response = await fetch(apiUrl('wa-status'), { method: 'POST', headers: requestHeaders(), body: JSON.stringify(payload), cache: 'no-store' });
    if (!response.ok) throw new Error(`wa-status endpoint returned ${response.status}`);
    const data = await response.json();
    if (data?.ok !== true) throw new Error('wa-status response was not acknowledged');
    return true;
  } catch (error) {
    console.warn('[WA] Sync failed', { message: error.message, studentId: payload.studentId, messageType: payload.messageType });
    return false;
  }
}
function allRows() { return students.map((student) => { const key = `${dateKey()}::${student.id}`; return { student, record: todayRecord(student.id), wa: normalizeWaStatus(waStatuses[key]) }; }); }
function branchById(id) { const wanted = String(id ?? '').trim().toUpperCase(); return branches.find((branch) => String(branch.id ?? '').trim().toUpperCase() === wanted && String(branch.status ?? '').trim().toLowerCase() !== 'nonaktif'); }
function currentStudent() { return studentSession ? students.find((student) => student.id === studentSession.id) || studentSession : null; }

async function loadStudents() {
  if (!API_BASE) return students;
  if (studentsLoadPromise) return studentsLoadPromise;
  studentsLoadState = 'loading';
  studentsLoadPromise = (async () => {
    try {
      const { data } = await fetchJsonWithRetry(apiUrl('students'));
      if (!Array.isArray(data.students)) throw new Error('Invalid students response');
      students = data.students.map((student) => ({ ...student, branchId: String(student.branchId || student.cabangId || '').trim(), branch: String(student.branch || student.branchName || '').trim() })).filter((student) => student.id && student.name);
      localStorage.setItem(STUDENTS_CACHE_KEY, JSON.stringify(students));
      studentsLoadState = 'ready';
      return students;
    } catch (error) {
      studentsLoadState = 'error';
      console.warn('[DATA] Students load failed', { message: error?.message || String(error) });
      showToast(apiDataError('students'), 'warn');
      return students;
    } finally { studentsLoadPromise = null; }
  })();
  return studentsLoadPromise;
}

async function loadBranches() {
  if (!API_BASE) return branches;
  if (branchesLoadPromise) return branchesLoadPromise;
  branchesLoadState = 'loading';
  branchesLoadPromise = (async () => {
    try {
      const { data } = await fetchJsonWithRetry(apiUrl('branches'));
      if (!Array.isArray(data.branches)) throw new Error('Invalid branches response');
      branches = data.branches.filter((branch) => branch?.id).map((branch) => ({ ...branch, id: String(branch.id).trim(), name: String(branch.name || '').trim(), status: String(branch.status || 'Aktif').trim() }));
      branchesLoadState = 'ready';
      renderBranchOptions();
      return branches;
    } catch (error) {
      branchesLoadState = 'error';
      console.warn('[DATA] Branches load failed', { message: error?.message || String(error) });
      showToast(apiDataError('branches'), 'warn');
      return branches;
    } finally { branchesLoadPromise = null; }
  })();
  return branchesLoadPromise;
}

async function loadDeviceBindings() {
  if (!API_BASE) return;
  deviceBindingsLoadState = 'loading';
  try {
    const { data } = await fetchJsonWithRetry(apiUrl('device-bindings', { _: Date.now() }));
    if (data.bindings && typeof data.bindings === 'object') {
      deviceBindings = Object.entries(data.bindings).reduce((result, [id, binding]) => {
        const key = String(id || binding?.studentId || '').trim();
        if (!key) return result;
        result[key] = { ...binding, studentId: String(binding?.studentId || key).trim(), status: String(binding?.status || '').trim().toUpperCase() };
        return result;
      }, {});
      persist();
    }
    deviceBindingsLoadState = 'ready';
  } catch (error) {
    deviceBindingsLoadState = 'error';
    console.warn('[DEVICE BINDING] Load failed', { message: error?.message || String(error) });
    showToast('Gagal mengambil data Device Binding. Silakan coba lagi.', 'warn');
  }
}

async function loadWaStatuses() {
  if (!API_BASE) return;
  try {
    const { data } = await fetchJsonWithRetry(apiUrl('wa-status', { date: dateKey(), _: Date.now() }));
    (data.entries || []).forEach((entry) => {
      const date = String(entry.Tanggal || entry.date || '').slice(0, 10); const studentId = String(entry['ID Siswa'] || entry.studentId || '').trim(); if (!date || !studentId) return;
      const type = String(entry['Jenis WA'] || entry.messageType || 'arrival').toLowerCase() === 'departure' ? 'departure' : 'arrival'; const status = normalizeWaStatusValue(entry['Status WA'] || entry.status || 'unprocessed');
      saveWaStatus(`${date}::${studentId}`, type, { studentId, status, processedAt: entry['Waktu Diproses'] || entry.processedAt || '', deliveredAt: entry['Waktu Terkirim'] || entry.deliveredAt || '' });
    });
  } catch (error) { console.warn('[WA] Load failed', { message: error.message }); /* status WA lokal tetap digunakan bila endpoint belum tersedia */ }
}

async function loadDashboardData() {
  await Promise.all([loadDeviceBindings(), loadAttendance(), loadWaStatuses()]);
  classSummaryLoadState = 'ready';
  renderAll();
  if ($('#admin-view')?.classList.contains('active-view')) renderDeviceManagement();
}

async function loadAttendance() {
  if (!API_BASE) return;
  try {
    const today = dateKey();
    const { data } = await fetchJsonWithRetry(apiUrl('attendance', { date: today }));
    const entries = Array.isArray(data.entries) ? data.entries : [];
    entries.forEach((entry) => {
      const date = String(entry.Tanggal || entry.date || '').slice(0, 10);
      const studentId = String(entry['ID Siswa'] || entry.studentId || '').trim();
      if (!studentId || date !== today) return;
      const key = `${date}::${studentId}`;
      const previous = records[key] || {};
      const normalizedCheckIn = formatAttendanceTime(entry['Jam Datang'] || entry.checkIn || previous.checkIn || '', date);
      const normalizedCheckOut = formatAttendanceTime(entry['Jam Pulang'] || entry.checkOut || previous.checkOut || '', date);
      if (!normalizedCheckIn && !normalizedCheckOut) { delete records[key]; return; }
      records[key] = {
        ...previous,
        date,
        studentId,
        name: String(entry['Nama Siswa'] || entry.name || previous.name || ''),
        className: String(entry.Kelas || entry.className || previous.className || ''),
        branchId: String(entry['ID Cabang'] || entry.branchId || previous.branchId || ''),
        branch: String(entry.Cabang || entry.branch || previous.branch || ''),
        checkIn: normalizedCheckIn,
        checkOut: normalizedCheckOut,
        status: String(entry.Status || entry.status || previous.status || ''),
      };
    });
    persist();
  } catch (error) {
    console.warn('[ATTENDANCE] Load failed', { message: error.message });
  }
}

async function serverDeviceCheck(student, token) {
  if (!API_BASE) return { status: 'local' };
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(apiUrl('device-binding/check'), { method: 'POST', headers: requestHeaders(), body: JSON.stringify({ studentId: student.id, deviceToken: token || null }), signal: controller.signal });
    const data = await response.json();
    if (data.message && !data.status) return { status: 'error', message: data.message };
    if (!response.ok) return { status: 'error', message: data.message || 'Perangkat tidak dapat divalidasi.' };
    return data;
  } catch (error) { return { status: 'error', message: error.name === 'AbortError' ? 'Proses membutuhkan waktu lebih lama dari biasanya. Silakan coba lagi.' : 'Server sedang tidak dapat dihubungi. Silakan coba lagi.' }; } finally { clearTimeout(timeout); }
}

async function loginStaff(role, password) {
  if (!API_BASE) return showToast('Backend autentikasi staf belum tersedia.', 'warn');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS);
  try {
    const endpoint = apiUrl('staff/login');
    const response = await fetch(endpoint, { method: 'POST', headers: requestHeaders(), body: JSON.stringify({ role, password }), signal: controller.signal });
    let data;
    try { data = await response.json(); } catch { console.warn('[AUTH] Invalid JSON response', { endpoint, status: response.status }); return showToast(authErrorMessage('AUTH_INVALID_RESPONSE', role), 'warn'); }
    console.info('[AUTH] Response received', { endpoint, status: response.status, code: data?.code || null });
    if (!response.ok || data?.success === false || data?.message && !data?.token) {
      const code = data?.code || (response.status === 401 ? 'AUTH_FAILED' : response.status === 503 ? 'AUTH_CONFIG_MISSING' : '');
      return showToast(code ? authErrorMessage(code, role) : (data?.message || 'Autentifikasi staf gagal.'), 'warn');
    }
    if (!data?.token || !data?.role) return showToast(authErrorMessage('AUTH_INVALID_RESPONSE', role), 'warn');
    staffSession = { role: data.role, token: data.token }; studentSession = null; authRole = data.role; persist(); persistStaffSession(); renderProfileIdentity(); setView('dashboard'); showToast('Login Student Mentor berhasil.'); loadDashboardData();
  } catch (error) {
    const code = error?.name === 'AbortError' ? 'AUTH_TIMEOUT' : 'AUTH_UNAVAILABLE';
    console.warn('[AUTH] Request failed', { endpoint: apiUrl('staff/login'), code });
    showToast(authErrorMessage(code, role), 'warn');
  } finally { clearTimeout(timeout); }
}

async function bindDevice(student) {
  if (bindInProgress) return;
  bindInProgress = true;
  const button = $('#bind-confirm');
  const originalButton = button?.innerHTML;
  const copy = $('#bind-modal-copy');
  const originalCopy = copy?.textContent;
  if (button) { button.disabled = true; button.innerHTML = '🔄 Mendaftarkan perangkat...'; }
  if (copy) copy.textContent = 'Perangkat sedang didaftarkan. Mohon jangan tutup halaman.';
  const token = getDeviceToken();
  try {
    if (tokenWasReset(token)) return showToast('Perangkat lama sudah di-reset. Gunakan perangkat baru atau hubungi Admin.', 'warn');
    if (tokenBelongsToAnotherStudent(student.id, token)) return showToast('Perangkat ini sudah terdaftar pada akun siswa lain.', 'warn');
    const boundAt = new Date().toISOString();
    if (API_BASE) {
      try {
        const response = await fetch(apiUrl('device-binding/bind'), { method: 'POST', headers: requestHeaders(staffHeaders()), body: JSON.stringify({ studentId: student.id, deviceToken: token, studentName: student.name }) });
        const data = await response.json();
        if (!response.ok || data.message) return showToast(response.status === 409 ? 'Perangkat ini sudah terdaftar pada akun siswa lain.' : (data.message || 'Perangkat belum berhasil didaftarkan.'), 'warn');
      } catch { return showToast('Server sedang tidak dapat dihubungi. Silakan coba lagi.', 'warn'); }
    }
    deviceBindings[student.id] = { studentId: student.id, studentName: student.name, deviceToken: token, status: 'TERDAFTAR', boundAt, updatedAt: boundAt };
    persist(); $('#bind-modal').hidden = true; pendingBindStudent = null; completeStudentLogin(student); showToast('✅ Perangkat berhasil didaftarkan.');
  } finally {
    bindInProgress = false;
    if (button) { button.disabled = false; button.innerHTML = originalButton || 'Daftarkan perangkat'; }
    if (copy && $('#bind-modal').hidden === false) copy.textContent = originalCopy || '';
  }
}

function completeStudentLogin(student) { studentSession = { id: student.id, name: student.name, className: student.className, branch: student.branch, branchId: student.branchId }; staffSession = null; authRole = 'student'; persist(); persistStaffSession(); renderProfileIdentity(); renderSession(); loadAttendance().then(renderAll); }

function getCurrentLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('GPS_NOT_SUPPORTED'));
    navigator.geolocation.getCurrentPosition(resolve, error => reject(new Error(error.code === 1 ? 'GPS_PERMISSION_DENIED' : error.code === 3 ? 'GPS_TIMEOUT' : 'GPS_UNAVAILABLE')), { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
  });
}
async function saveAttendance(student, type, location, branch) {
  const key = `${dateKey()}::${student.id}`;
  const current = records[key] || { date: dateKey(), studentId: student.id, name: student.name, className: student.className, branchId: student.branchId, branch: student.branch, status: 'Belum Pulang' };
  const time = nowTime();
  const next = { ...current };
  if (type === 'in') next.checkIn = time;
  if (type === 'out') { next.checkOut = time; next.status = 'Hadir'; }
  if (API_BASE) {
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(apiUrl('attendance'), { method: 'POST', headers: requestHeaders(), body: JSON.stringify({ ...next, branchId: branch.id, branch: branch.name, latitude: location.latitude, longitude: location.longitude, deviceToken: getDeviceToken() }), signal: controller.signal });
      let data = {}; try { data = await response.json(); } catch { /* handled below */ }
      if (!response.ok || data.ok !== true) { const error = new Error(data.code || 'ATTENDANCE_REJECTED'); error.serverMessage = data.message; throw error; }
    } finally { clearTimeout(timeout); }
  }
  records[key] = next;
  persist();
  return next;
}

async function processScanUnlocked(rawBranchId) {
  if (!studentSession) return showScanResult('Silakan login sebagai siswa sebelum melakukan presensi.', 'warning');
  if (API_BASE && branchesLoadState === 'loading') return showScanResult('⏳ <b>Data cabang sedang dimuat.</b><br>Silakan coba scan kembali sebentar lagi.', 'processing');
  if (API_BASE && branchesLoadState === 'error') return showScanResult('⚠️ <b>Data cabang tidak tersedia.</b><br>Segarkan halaman lalu coba lagi.', 'warning');
  const branchId = rawBranchId.trim().toUpperCase();
  const branch = branchById(branchId);
  const student = currentStudent();
  if (!branch) return showScanResult('QR Cabang tidak terdaftar.', 'warning');
  if (!student) return showScanResult('Akun siswa tidak ditemukan. Silakan login kembali.', 'warning');
  if ((!API_BASE && !deviceSessionValid(student.id)) || (API_BASE && !hasDeviceToken())) { studentSession = null; authRole = null; persist(); setView('login'); return showScanResult('Perangkat tidak dikenali. Silakan hubungi Admin untuk reset perangkat.', 'warning'); }
  if (student.branchId && student.branchId.toUpperCase() !== branch.id) return showScanResult(`⚠️ <b>QR cabang tidak sesuai dengan data siswa.</b><br>Anda terdaftar di Cabang <strong>${esc(student.branch)}</strong>.`, 'warning');
  showScanResult(`✅ <b>QR Cabang ditemukan</b><br><strong>${esc(branch.name)}</strong><br>📍 Mendapatkan lokasi Anda…`, 'processing');
  let location;
  try {
    location = await getCurrentLocation();
  } catch (error) {
    const messages = { GPS_PERMISSION_DENIED: 'Izin lokasi diperlukan untuk melakukan presensi.', GPS_TIMEOUT: 'Lokasi GPS terlalu lama ditemukan. Pastikan GPS aktif lalu coba lagi.', GPS_UNAVAILABLE: 'Lokasi GPS tidak tersedia. Pastikan layanan lokasi aktif.', GPS_NOT_SUPPORTED: 'Perangkat atau browser ini tidak mendukung validasi GPS.' };
    return showScanResult(`⚠️ <b>Presensi belum dicatat.</b><br>${messages[error.message] || 'Lokasi GPS tidak dapat divalidasi.'}`, 'warning');
  }
  if (!Number.isFinite(Number(branch.latitude)) || !Number.isFinite(Number(branch.longitude))) return showScanResult('⚠️ <b>Presensi belum dicatat.</b><br>Koordinat GPS cabang belum dikonfigurasi. Hubungi Student Mentor.', 'warning');
  showScanResult(`✅ <b>QR Cabang ditemukan</b><br><strong>${esc(branch.name)}</strong><br>📍 Memeriksa jarak dari cabang…<br>🔄 Memproses presensi…<br>Data kehadiran sedang disimpan.`, 'processing');
  const current = todayRecord(student.id);
  try {
  if (!current) {
    const record = await saveAttendance(student, 'in', location.coords, branch);
    showScanResult(`🎉 <b>Presensi Jam Datang Berhasil!</b><br><strong>${esc(student.name)}</strong><br>📍 ${esc(branch.name)}<br>🕐 Jam Datang: <strong>${esc(record.checkIn)}</strong> WITA<br>📅 ${dateKey()}`, 'success');
    showToast(`${student.name} tercatat Jam Datang ${record.checkIn}`, 'success');
  } else if (!current.checkOut) {
    const record = await saveAttendance(student, 'out', location.coords, branch);
    showScanResult(`🎉 <b>Presensi Jam Pulang Berhasil!</b><br><strong>${esc(student.name)}</strong><br>📍 ${esc(branch.name)}<br>🕐 Jam Datang: <strong>${esc(record.checkIn)}</strong> WITA<br>🕐 Jam Pulang: <strong>${esc(record.checkOut)}</strong> WITA<br>📅 ${dateKey()}`, 'success');
    showToast(`${student.name} tercatat Jam Pulang ${record.checkOut}`, 'success');
  } else {
    showScanResult(`ℹ️ <b>Presensi hari ini sudah lengkap.</b><br>Jam datang: <strong>${current.checkIn}</strong><br>Jam pulang: <strong>${current.checkOut}</strong>`, 'warning');
  }
  } catch (error) {
    const messages = { OUTSIDE_BRANCH_RADIUS: `Anda berada di luar area presensi ${branch.name}.`, BRANCH_GPS_NOT_CONFIGURED: 'Koordinat GPS cabang belum dikonfigurasi. Hubungi Student Mentor.', BRANCH_MISMATCH: 'Siswa tidak dapat presensi di cabang ini.' };
    const fallback = error?.name === 'AbortError' ? 'Proses membutuhkan waktu lebih lama dari biasanya. Silakan coba lagi.' : /fetch|network/i.test(error?.message || '') ? 'Server sedang tidak dapat dihubungi. Silakan coba lagi.' : 'Presensi belum berhasil disimpan. Silakan coba lagi.';
    return showScanResult(`⚠️ <b>Presensi belum dicatat.</b><br>${esc(messages[error.message] || error.serverMessage || fallback)}`, 'warning');
  }
  $('#barcode-input').value = '';
  renderAll();
}

async function processScan(rawBranchId) {
  if (scanInProgress) return;
  scanInProgress = true;
  scannerLocked = true;
  try { return await processScanUnlocked(rawBranchId); } finally { scanInProgress = false; scannerLocked = false; }
}

function showScanResult(html, kind) { const box = $('#scan-result'); box.innerHTML = html; box.className = `scan-result show ${kind}`; box.setAttribute('role', kind === 'success' || kind === 'processing' ? 'status' : 'alert'); if (kind === 'success') navigator.vibrate?.(180); if (kind === 'success' || kind === 'processing') requestAnimationFrame(() => box.scrollIntoView({ behavior: 'smooth', block: 'center' })); }
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
  const query = normalizeSearch($('#search-input').value || '');
  const branchValue = $('#branch-filter').value; const classValue = $('#class-filter').value; const attendance = $('#attendance-filter').value; const waFilter = $('#wa-filter').value;
  const filtered = rows.filter(({ student, record, wa }) => {
    const matchQuery = !query || normalizeSearch(student.name).includes(query) || normalizeSearch(student.id).includes(query);
    const matchBranch = branchValue === 'all' || String(student.branchId || '').trim().toUpperCase() === String(branchValue).trim().toUpperCase() || normalizeSearch(student.branch) === normalizeSearch(branchValue);
    const matchClass = classValue === 'all' || student.className === classValue;
    const matchAttendance = attendance === 'all' || (attendance === 'present' && record) || (attendance === 'absent' && !record) || (attendance === 'out' && record?.checkOut) || (attendance === 'not-out' && record && !record.checkOut);
    const matchWa = waFilter === 'all' || wa.arrival.status === waFilter || wa.departure.status === waFilter;
    return matchQuery && matchBranch && matchClass && matchAttendance && matchWa;
  });
  $('#table-total').textContent = rows.length; $('#table-showing').textContent = filtered.length;
  const activeFilters = [branchValue !== 'all', classValue !== 'all', attendance !== 'all', waFilter !== 'all'].filter(Boolean).length; $('#filter-count').textContent = activeFilters; $('#filter-count').classList.toggle('show', activeFilters > 0);
  $('#attendance-body').innerHTML = filtered.map(({ student, record, wa }) => {
    const attendanceBadge = !record ? '<span class="attendance-badge absent">Belum Hadir</span>' : record.checkOut ? '<span class="attendance-badge present">Sudah Pulang</span>' : '<span class="attendance-badge not-out">Belum Pulang</span>';
    const waLabel = (type, label, available) => { const status = wa[type].status; const text = status === 'delivered' ? '✓ Sudah Terkirim' : status === 'processed' ? '◷ Sudah Diproses' : 'Belum Diproses'; const disabled = !available ? ' disabled' : ''; return `<button class="wa-badge ${status}${disabled}" data-status-id="${esc(student.id)}" data-status-type="${type}"${disabled}>${label}: ${text}</button>`; };
    const waButton = `<div class="wa-actions"><button class="wa-action${record ? '' : ' disabled'}" aria-label="Kirim WA jam datang" title="Kirim WA jam datang" data-wa="${esc(student.id)}" data-wa-type="arrival"${record ? '' : ' disabled'}>▣ Kirim WA</button><button class="wa-action${record?.checkOut ? '' : ' disabled'}" aria-label="Kirim WA jam pulang" title="Kirim WA jam pulang" data-wa="${esc(student.id)}" data-wa-type="departure"${record?.checkOut ? '' : ' disabled'}>▣ Kirim WA</button></div>`;
    return `<tr><td><div class="student-cell"><span class="student-avatar">${initials(student.name)}</span><div><b>${esc(student.name)}</b><small>${esc(student.id)}</small></div></div></td><td>${esc(student.className)}</td><td>${esc(record?.branch || student.branch || '—')}</td><td class="time-cell">${record?.checkIn || '<span class="dash">—</span>'}</td><td class="time-cell">${record?.checkOut || '<span class="dash">—</span>'}</td><td>${attendanceBadge}</td><td><div class="wa-status-group">${waLabel('arrival', 'Datang', Boolean(record))}${waLabel('departure', 'Pulang', Boolean(record?.checkOut))}</div></td><td>${waButton}</td></tr>`;
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

function renderBranchOptions() {
  const select = $('#branch-filter');
  if (!select) return;
  const current = select.value;
  const available = [...new Map(branches.filter((branch) => branch?.id && String(branch.status || 'Aktif').toLowerCase() !== 'nonaktif').map((branch) => [String(branch.id).trim().toUpperCase(), branch])).values()];
  select.innerHTML = '<option value="all">Semua cabang</option>' + available.map((branch) => `<option value="${esc(branch.id)}">${esc(branch.name || branch.id)}</option>`).join('');
  select.value = available.some((branch) => String(branch.id).toUpperCase() === String(current).toUpperCase()) ? current : 'all';
}

function renderDeviceManagement() {
  const query = ($('#device-search').value || '').trim().toLowerCase();
  const statusFilter = $('#device-status-filter').value;
  const loading = API_BASE && deviceBindingsLoadState === 'loading';
  const failed = API_BASE && deviceBindingsLoadState === 'error';
  const rows = loading || failed ? [] : students.map((student) => ({ student, binding: bindingFor(student.id) })).filter(({ student, binding }) => {
    const status = bindingStatus(binding);
    return (!query || student.name.toLowerCase().includes(query) || student.id.toLowerCase().includes(query)) && (statusFilter === 'all' || status === statusFilter);
  });
  $('#device-total').textContent = students.length; $('#device-showing').textContent = rows.length;
  $('#device-body').innerHTML = rows.map(({ student, binding }) => {
    const status = bindingStatus(binding);
    const statusLabel = status === 'TERDAFTAR' ? '🟢 Aktif' : status === 'DI-RESET' ? '↺ Di-Reset' : '🔴 Belum Terdaftar';
    const date = binding?.boundAt ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(binding.boundAt)) : '—';
    const action = status === 'TERDAFTAR' ? `<button class="wa-action reset-device-action" data-reset-device="${esc(student.id)}">Reset Device</button>` : '<span class="dash">—</span>';
    return `<tr><td><div class="student-cell"><span class="student-avatar">${initials(student.name)}</span><div><b>${esc(student.name)}</b><small>${esc(student.className)}</small></div></div></td><td class="time-cell">${esc(student.id)}</td><td><span class="device-status-badge ${status.toLowerCase().replace(/[^a-z-]/g, '')}">${statusLabel}</span></td><td>${date}</td><td>${action}</td></tr>`;
  }).join('');
  const empty = $('#device-empty');
  const emptyTitle = $('#device-empty-title');
  const emptyCopy = $('#device-empty-copy');
  if (emptyTitle && emptyCopy) {
    if (loading) { emptyTitle.textContent = 'Memuat data device...'; emptyCopy.textContent = 'Mengambil data dari Google Sheets.'; }
    else if (failed) { emptyTitle.textContent = 'Gagal mengambil data Device Binding.'; emptyCopy.textContent = 'Periksa koneksi Apps Script lalu klik Segarkan.'; }
    else if (!rows.length && statusFilter === 'TERDAFTAR') { emptyTitle.textContent = 'Belum ada device yang terdaftar.'; emptyCopy.textContent = 'Belum ada binding aktif yang cocok dengan filter.'; }
    else { emptyTitle.textContent = 'Data device tidak ditemukan'; emptyCopy.textContent = 'Coba ubah pencarian atau filter.'; }
  }
  empty.hidden = rows.length !== 0;
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

function renderAll() { renderSummary(); renderDashboard(); renderClassSummary(); }

function classSummaryRecordFor(student) {
  const record = todayRecord(student.id);
  const wa = normalizeWaStatus(waStatuses[`${dateKey()}::${student.id}`]);
  const binding = bindingFor(student.id);
  const registered = bindingStatus(binding) === 'TERDAFTAR';
  const present = Boolean(record?.checkIn);
  const out = Boolean(record?.checkOut);
  const waArrival = present ? wa.arrival : { status: 'unprocessed' };
  const waDeparture = out ? wa.departure : { status: 'unprocessed' };
  return { student, record, binding, registered, present, out, waArrival, waDeparture };
}

function waCounts(items, type) {
  const field = type === 'departure' ? 'waDeparture' : 'waArrival';
  const eligible = items.filter((item) => type === 'departure' ? item.out : item.present);
  const statuses = eligible.map((item) => normalizeWaStatusValue(item[field]?.status));
  return {
    eligible,
    unprocessed: statuses.filter((status) => status !== 'processed' && status !== 'delivered').length,
    processed: statuses.filter((status) => status === 'processed' || status === 'delivered').length,
    delivered: statuses.filter((status) => status === 'delivered').length,
  };
}

function buildClassSummaryRows() {
  const groups = new Map();
  const uniqueStudents = new Map();
  students.forEach((student) => {
    const id = String(student.id || '').trim();
    if (!id) return;
    const normalizedId = id.toUpperCase();
    if (uniqueStudents.has(normalizedId)) return;
    uniqueStudents.set(normalizedId, student);
    const className = String(student.className || student.class || 'Kelas belum diisi').trim() || 'Kelas belum diisi';
    const branchId = String(student.branchId || '').trim().toUpperCase();
    const branchName = String(student.branch || student.branchName || branchId || 'Cabang belum diisi').trim();
    const key = `${branchId}::${className.toLocaleLowerCase('id-ID')}`;
    if (!groups.has(key)) groups.set(key, { key, className, branchId, branchName, items: [] });
    groups.get(key).items.push(classSummaryRecordFor(student));
  });
  return [...groups.values()].map((group) => {
    const { items } = group;
    const arrival = waCounts(items, 'arrival');
    const departure = waCounts(items, 'departure');
    return {
      ...group,
      total: items.length,
      registered: items.filter((item) => item.registered).length,
      unregistered: items.filter((item) => !item.registered).length,
      present: items.filter((item) => item.present).length,
      absent: items.filter((item) => !item.present).length,
      out: items.filter((item) => item.out).length,
      notOut: items.filter((item) => item.present && !item.out).length,
      waArrival: arrival,
      waDeparture: departure,
    };
  }).sort((a, b) => a.className.localeCompare(b.className, 'id-ID') || a.branchName.localeCompare(b.branchName, 'id-ID'));
}

function classSummaryFilters() {
  const branch = $('#class-summary-branch-filter')?.value || 'all';
  const className = $('#class-summary-class-filter')?.value || 'all';
  return classSummaryRowsState.filter((row) => {
    const branchMatch = branch === 'all' || row.branchId === String(branch).trim().toUpperCase() || normalizeSearch(row.branchName) === normalizeSearch(branch);
    return branchMatch && (className === 'all' || row.className === className);
  });
}

function detailButton(metric, value, rowKey, label = '') {
  const displayValue = value === undefined || value === null ? 0 : value;
  return `<button type="button" class="summary-number-button" data-class-detail="${esc(metric)}" data-class-key="${esc(rowKey)}" aria-label="${esc(label || metric)} ${esc(displayValue)}">${esc(displayValue)}</button>`;
}

function renderClassSummaryFilters(rows) {
  const branchSelect = $('#class-summary-branch-filter');
  const classSelect = $('#class-summary-class-filter');
  if (!branchSelect || !classSelect) return;
  const branchValue = branchSelect.value || 'all';
  const classValue = classSelect.value || 'all';
  const branchesForSummary = [...new Map(rows.filter((row) => row.branchId || row.branchName).map((row) => [row.branchId || row.branchName, row])).values()];
  branchSelect.innerHTML = '<option value="all">Semua cabang</option>' + branchesForSummary.sort((a, b) => a.branchName.localeCompare(b.branchName, 'id-ID')).map((row) => `<option value="${esc(row.branchId || row.branchName)}">${esc(row.branchName)}</option>`).join('');
  branchSelect.value = branchesForSummary.some((row) => (row.branchId || row.branchName) === branchValue) ? branchValue : 'all';
  const selectedBranch = branchSelect.value;
  const classNames = [...new Set(rows.filter((row) => selectedBranch === 'all' || row.branchId === selectedBranch || normalizeSearch(row.branchName) === normalizeSearch(selectedBranch)).map((row) => row.className))].sort((a, b) => a.localeCompare(b, 'id-ID'));
  classSelect.innerHTML = '<option value="all">Semua kelas</option>' + classNames.map((name) => `<option value="${esc(name)}">${esc(name)}</option>`).join('');
  classSelect.value = classNames.includes(classValue) ? classValue : 'all';
}

function summaryAggregate(rows) {
  const items = rows.flatMap((row) => row.items);
  const unique = new Map(items.map((item) => [String(item.student.id).trim().toUpperCase(), item]));
  const all = [...unique.values()];
  const arrival = waCounts(all, 'arrival');
  const departure = waCounts(all, 'departure');
  return { total: all.length, registered: all.filter((item) => item.registered).length, present: all.filter((item) => item.present).length, out: all.filter((item) => item.out).length, arrival, departure };
}

function renderClassSummaryStats(rows) {
  const stats = $('#class-summary-stats');
  if (!stats) return;
  const aggregate = summaryAggregate(rows);
  const cards = [
    ['Total Siswa', aggregate.total, 'total', 'blue'],
    ['Perangkat Terdaftar', aggregate.registered, 'registered', 'green'],
    ['Hadir', aggregate.present, 'present', 'green'],
    ['Pulang', aggregate.out, 'out', 'purple'],
    ['WA Kehadiran', `${aggregate.arrival.processed} / ${aggregate.arrival.delivered}`, 'waArrival', 'orange'],
    ['WA Kepulangan', `${aggregate.departure.processed} / ${aggregate.departure.delivered}`, 'waDeparture', 'orange'],
  ];
  stats.innerHTML = cards.map(([label, value, metric, tone]) => `<div class="summary-stat-card"><div class="stat-card-top"><span class="stat-label">${esc(label.toUpperCase())}</span><span class="stat-card-icon ${tone}">◫</span></div><button type="button" class="summary-stat-value" data-class-summary-stat="${metric}">${esc(value)}</button><small>Hari ini</small></div>`).join('');
}

function renderClassSummary() {
  const loading = $('#class-summary-loading');
  const error = $('#class-summary-error');
  const content = $('#class-summary-content');
  const body = $('#class-summary-body');
  const empty = $('#class-summary-empty');
  if (!body || !content) return;
  if ($('#class-summary-date')) $('#class-summary-date').textContent = new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Asia/Makassar' }).format(new Date());
  if (classSummaryLoadState === 'loading' || (API_BASE && (studentsLoadState === 'loading' || deviceBindingsLoadState === 'loading'))) {
    loading.hidden = false; error.hidden = true; content.hidden = true; return;
  }
  if (classSummaryLoadState === 'error' || (API_BASE && (studentsLoadState === 'error' || deviceBindingsLoadState === 'error'))) {
    loading.hidden = true; error.hidden = false; content.hidden = true; return;
  }
  loading.hidden = true; error.hidden = true; content.hidden = false;
  classSummaryRowsState = buildClassSummaryRows();
  renderClassSummaryFilters(classSummaryRowsState);
  const rows = classSummaryFilters();
  renderClassSummaryStats(rows);
  body.innerHTML = rows.map((row) => `<tr><td><b>${esc(row.className)}</b><small class="summary-branch-label">${esc(row.branchName)}</small></td><td>${detailButton('total', row.total, row.key, 'Total siswa')}</td><td>${detailButton('registered', row.registered, row.key, 'Perangkat terdaftar')}</td><td>${detailButton('unregistered', row.unregistered, row.key, 'Belum terdaftar')}</td><td>${detailButton('present', row.present, row.key, 'Hadir')}</td><td>${detailButton('absent', row.absent, row.key, 'Belum hadir')}</td><td>${detailButton('out', row.out, row.key, 'Pulang')}</td><td>${detailButton('notOut', row.notOut, row.key, 'Belum pulang')}</td><td>${detailButton('waArrival', `${row.waArrival.processed} / ${row.waArrival.delivered}`, row.key, 'WA Kehadiran')}</td><td>${detailButton('waDeparture', `${row.waDeparture.processed} / ${row.waDeparture.delivered}`, row.key, 'WA Kepulangan')}</td></tr>`).join('');
  empty.hidden = rows.length !== 0;
}

function detailItemsFor(row, metric) {
  if (metric === 'registered') return row.items.filter((item) => item.registered);
  if (metric === 'unregistered') return row.items.filter((item) => !item.registered);
  if (metric === 'present') return row.items.filter((item) => item.present);
  if (metric === 'absent') return row.items.filter((item) => !item.present);
  if (metric === 'out') return row.items.filter((item) => item.out);
  if (metric === 'notOut') return row.items.filter((item) => item.present && !item.out);
  if (metric === 'waArrival') return row.waArrival.eligible;
  if (metric === 'waDeparture') return row.waDeparture.eligible;
  return row.items;
}

function detailStatus(item, type) {
  const status = normalizeWaStatusValue(item[type]?.status);
  return status === 'delivered' ? 'Sudah Terkirim' : status === 'processed' ? 'Sudah Diproses' : 'Belum Diproses';
}

function openClassDetail(metric, rowKey, breakdownStatus = '') {
  const row = classSummaryRowsState.find((item) => item.key === rowKey);
  if (!row) return;
  const titleMap = { total: 'Total Siswa', registered: 'Perangkat Terdaftar', unregistered: 'Belum Terdaftar', present: 'Hadir', absent: 'Belum Hadir', out: 'Pulang', notOut: 'Belum Pulang', waArrival: 'WA Kehadiran', waDeparture: 'WA Kepulangan' };
  const type = metric === 'waDeparture' ? 'departure' : 'arrival';
  let items = detailItemsFor(row, metric);
  if (breakdownStatus && (metric === 'waArrival' || metric === 'waDeparture')) items = items.filter((item) => normalizeWaStatusValue(item[type === 'departure' ? 'waDeparture' : 'waArrival']?.status) === breakdownStatus);
  classDetailState = { title: `${titleMap[metric] || 'Detail'} — ${row.className}`, items, metric, rowKey, type, breakdownStatus };
  $('#class-detail-title').textContent = `${classDetailState.title} (${items.length})`;
  const breakdown = $('#class-detail-breakdown');
  const counts = metric === 'waArrival' ? row.waArrival : metric === 'waDeparture' ? row.waDeparture : null;
  breakdown.innerHTML = counts ? [['unprocessed', 'Belum Diproses', counts.unprocessed], ['processed', 'Sudah Diproses', counts.processed], ['delivered', 'Sudah Terkirim', counts.delivered]].map(([status, label, count]) => `<button type="button" class="detail-breakdown-button${breakdownStatus === status ? ' active' : ''}" data-class-breakdown="${status}"><b>${count}</b><span>${label}</span></button>`).join('') : '';
  $('#class-detail-search').value = '';
  $('#class-detail-modal').hidden = false;
  renderClassDetail();
}

function renderClassDetail() {
  const list = $('#class-detail-list');
  if (!list) return;
  const query = normalizeSearch($('#class-detail-search')?.value || '');
  const items = classDetailState.items.filter((item) => !query || normalizeSearch(item.student.name).includes(query) || normalizeSearch(item.student.id).includes(query));
  const { metric, type } = classDetailState;
  list.innerHTML = items.length ? items.map((item, index) => {
    const student = item.student; const status = type ? detailStatus(item, type === 'departure' ? 'waDeparture' : 'waArrival') : '';
    const registeredDate = item.binding?.boundAt ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeZone: 'Asia/Makassar' }).format(new Date(item.binding.boundAt)) : 'Terdaftar';
    const details = metric === 'registered' ? `${student.className || '—'} · ${registeredDate} · 🟢 Aktif` : metric === 'unregistered' || metric === 'absent' ? `${student.className || '—'} · ${metric === 'absent' ? '🔴 Belum Hadir' : '🔴 Belum Terdaftar'}` : metric === 'waArrival' || metric === 'waDeparture' ? `${student.className || '—'} · ${status}` : `${student.className || '—'} · Datang ${item.record?.checkIn || '—'} · Pulang ${item.record?.checkOut || '—'}`;
    return `<div class="class-detail-item"><span class="detail-index">${index + 1}</span><span class="student-avatar">${initials(student.name)}</span><div><b>${esc(student.name)}</b><small>${esc(details)}</small></div></div>`;
  }).join('') : '<div class="class-detail-empty">Siswa tidak ditemukan.</div>';
}

function closeClassDetail() { $('#class-detail-modal').hidden = true; classDetailState = { title: '', items: [], metric: '' }; }

function openClassSummaryStat(metric, breakdownStatus = '') {
  const rows = classSummaryFilters();
  const allItems = rows.flatMap((row) => row.items);
  const unique = [...new Map(allItems.map((item) => [String(item.student.id).trim().toUpperCase(), item])).values()];
  const type = metric === 'waDeparture' ? 'departure' : 'arrival';
  let items = metric === 'registered' ? unique.filter((item) => item.registered) : metric === 'present' ? unique.filter((item) => item.present) : metric === 'out' ? unique.filter((item) => item.out) : metric === 'waArrival' ? unique.filter((item) => item.present) : metric === 'waDeparture' ? unique.filter((item) => item.out) : unique;
  if (breakdownStatus && (metric === 'waArrival' || metric === 'waDeparture')) items = items.filter((item) => normalizeWaStatusValue(item[type === 'departure' ? 'waDeparture' : 'waArrival']?.status) === breakdownStatus);
  const titleMap = { total: 'Total Siswa', registered: 'Perangkat Terdaftar', present: 'Hadir', out: 'Pulang', waArrival: 'WA Kehadiran', waDeparture: 'WA Kepulangan' };
  const counts = metric === 'waArrival' ? waCounts(unique, 'arrival') : metric === 'waDeparture' ? waCounts(unique, 'departure') : null;
  classDetailState = { title: `${titleMap[metric] || 'Detail'} — Semua Kelas`, items, metric, type, breakdownStatus };
  $('#class-detail-title').textContent = `${classDetailState.title} (${items.length})`;
  $('#class-detail-breakdown').innerHTML = counts ? [['unprocessed', 'Belum Diproses', counts.unprocessed], ['processed', 'Sudah Diproses', counts.processed], ['delivered', 'Sudah Terkirim', counts.delivered]].map(([status, label, count]) => `<button type="button" class="detail-breakdown-button${breakdownStatus === status ? ' active' : ''}" data-class-summary-breakdown="${status}"><b>${count}</b><span>${label}</span></button>`).join('') : '';
  $('#class-detail-search').value = ''; $('#class-detail-modal').hidden = false; renderClassDetail();
}

async function renderBranchBarcodes() {
  const grid = $('#branch-barcode-grid'); if (!grid) return;
  if (!branches.length) { grid.innerHTML = '<div class="empty-state"><div>▤</div><b>Data cabang belum tersedia</b><span>Isi Database Cabang terlebih dahulu.</span></div>'; return; }
  grid.innerHTML = branches.filter(branch => branch.status !== 'Nonaktif').map(branch => `<article class="branch-barcode-card" data-branch-code="${esc(branch.id)}"><div class="branch-barcode-heading"><div><span class="section-kicker">ID CABANG</span><h2>${esc(branch.name)}</h2><small>${esc(branch.id)}</small></div><span class="branch-status">${esc(branch.status || 'Aktif')}</span></div><div class="barcode-surface"><canvas class="branch-qr" role="img" aria-label="QR Code ${esc(branch.name)}"></canvas><p class="barcode-fallback">${esc(branch.id)}</p></div><button class="outline-button branch-print-button" type="button" data-print-branch="${esc(branch.id)}">▣ Cetak QR</button></article>`).join('');
  try {
    await Promise.all($$('.branch-barcode-card').map(card => QRCode.toCanvas($('.branch-qr', card), card.dataset.branchCode, { width: 180, margin: 2, color: { dark: '#7a1f3d', light: '#ffffff' } })));
  } catch (error) { console.warn('[QR] Generator failed', { message: error.message }); $$('.branch-barcode-card').forEach(card => card.classList.add('barcode-unavailable')); showToast('QR tidak dapat dibuat. ID cabang tetap dapat dicetak.', 'warn'); }
}
function printBranchBarcode(branchId) {
  $$('.branch-barcode-card').forEach(card => { card.classList.toggle('print-target', card.dataset.branchCode === branchId); });
  window.print();
  $$('.branch-barcode-card').forEach(card => card.classList.remove('print-target'));
}

function setView(view) {
  if (view === 'dashboard' && !['teacher', 'admin'].includes(authRole)) { showToast('Dashboard khusus Student Mentor. Silakan login sebagai Student Mentor.', 'warn'); return setView('login'); }
  if (view === 'class-summary' && !['teacher', 'admin'].includes(authRole)) { showToast('Rekap Kelas khusus Student Mentor. Silakan login sebagai Student Mentor.', 'warn'); return setView('login'); }
  if (view === 'admin' && !['teacher', 'admin'].includes(authRole)) { showToast('Manajemen Device hanya dapat diakses Student Mentor.', 'warn'); return setView('login'); }
  if (view === 'branch-barcode' && !['teacher', 'admin'].includes(authRole)) { showToast('Pembuatan QR Cabang hanya dapat diakses Student Mentor.', 'warn'); return setView('login'); }
  $$('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  $('#login-view').classList.toggle('active-view', view === 'login'); $('#scan-view').classList.toggle('active-view', view === 'scan'); $('#dashboard-view').classList.toggle('active-view', view === 'dashboard'); $('#class-summary-view').classList.toggle('active-view', view === 'class-summary'); $('#admin-view').classList.toggle('active-view', view === 'admin'); $('#branch-barcode-view').classList.toggle('active-view', view === 'branch-barcode');
  $('#page-context').textContent = view === 'scan' ? 'Presensi / Scan' : view === 'login' ? 'Login Siswa' : view === 'admin' ? 'Manajemen Device' : view === 'class-summary' ? 'Rekap Kelas' : view === 'branch-barcode' ? 'QR Cabang' : 'Dashboard Student Mentor';
  if (view === 'admin') { renderDeviceManagement(); loadDeviceBindings().then(renderDeviceManagement); }
  if (view === 'class-summary') {
    classSummaryLoadState = 'loading'; renderClassSummary();
    Promise.all([loadStudents(), loadDeviceBindings(), loadAttendance(), loadWaStatuses()]).then(() => { classSummaryLoadState = 'ready'; renderClassSummary(); }).catch((error) => { classSummaryLoadState = 'error'; console.warn('[CLASS SUMMARY] Load failed', { message: error?.message || String(error) }); renderClassSummary(); });
  }
  if (view === 'branch-barcode') renderBranchBarcodes();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function populateStudentAccounts() {
  const select = $('#student-account');
  const search = normalizeSearch($('#student-search')?.value || '');
  const selected = select.value;
  const results = $('#student-results');
  if (API_BASE && studentsLoadState === 'loading') {
    if (results) { results.innerHTML = '<div class="student-result-empty">Memuat data siswa...</div>'; results.hidden = false; $('#student-search').setAttribute('aria-expanded', 'true'); }
    return;
  }
  if (API_BASE && studentsLoadState === 'error') {
    if (results) { results.innerHTML = '<div class="student-result-empty">Data siswa tidak dapat dimuat. Coba segarkan halaman.</div>'; results.hidden = false; $('#student-search').setAttribute('aria-expanded', 'true'); }
    return;
  }
  const matches = students.filter((student) => !search || `${normalizeSearch(student.name)} ${normalizeSearch(student.className)} ${normalizeSearch(student.id)}`.includes(search));
  select.innerHTML = '<option value="">Pilih nama siswa</option>' + matches.map((student) => `<option value="${esc(student.id)}">${esc(student.name)} · ${esc(student.className || 'Kelas belum diisi')}</option>`).join('');
  select.value = matches.some((student) => student.id === selected) ? selected : '';
  const password = $('#student-password');
  if (password && !select.value) { password.value = ''; password.disabled = true; }
  if (!results) return;
  if (!search) { results.hidden = true; $('#student-search').setAttribute('aria-expanded', 'false'); return; }
  const visibleMatches = matches.slice(0, 50);
  results.innerHTML = visibleMatches.length ? visibleMatches.map((student) => `<button type="button" class="student-result" role="option" data-student-id="${esc(student.id)}"><b>${esc(student.name)}</b><small>${esc(student.className || 'Kelas belum diisi')}</small></button>`).join('') : '<div class="student-result-empty">Nama siswa tidak ditemukan.</div>';
  results.hidden = false;
  $('#student-search').setAttribute('aria-expanded', 'true');
}

function chooseStudent(studentId) {
  const student = students.find((item) => item.id === studentId);
  if (!student) return;
  $('#student-account').value = student.id;
  $('#student-search').value = student.name;
  $('#student-results').hidden = true;
  $('#student-search').setAttribute('aria-expanded', 'false');
  const password = $('#student-password');
  if (password) { password.disabled = false; password.focus(); }
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
  if (API_BASE && studentsLoadState === 'loading') return showToast('Data siswa sedang dimuat. Silakan tunggu sebentar.', 'warn');
  if (API_BASE && studentsLoadState === 'error') return showToast('Data siswa belum berhasil dimuat. Segarkan halaman lalu coba lagi.', 'warn');
  const student = students.find((item) => item.id === $('#student-account').value);
  if (!student) return showToast('Data siswa tidak ditemukan.', 'warn');
  if (!student.branchId) return showToast('Cabang siswa belum dipetakan oleh admin.', 'warn');
  const password = String($('#student-password')?.value || '');
  if (!password) return showToast('Masukkan password siswa.', 'warn');
  const token = localStorage.getItem(DEVICE_KEY);
  if (token && tokenBelongsToAnotherStudent(student.id, token)) return showToast('Perangkat ini sudah terdaftar untuk akun siswa lain. Silakan gunakan perangkat yang terdaftar atau hubungi Admin.', 'warn');
  let serverCheck = { status: 'local' };
  if (API_BASE) {
    setProcessing(true, 'Memproses...', 'Sedang memverifikasi data siswa...');
    const authenticate = (async () => {
      const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS); const endpoint = apiUrl('student/login');
      try {
        const response = await fetch(endpoint, { method: 'POST', headers: requestHeaders(), body: JSON.stringify({ studentId: student.id, password }), signal: controller.signal });
        let data; try { data = await response.json(); } catch { return { ok: false, code: 'AUTH_INVALID_RESPONSE' }; }
        console.info('[STUDENT AUTH] Response received', { endpoint, status: response.status, code: data?.code || null });
        return response.ok && data?.success !== false && data?.authenticated === true ? { ok: true } : { ok: false, code: data?.code || (response.status === 401 ? 'STUDENT_AUTH_FAILED' : '') };
      } catch (error) { const code = error?.name === 'AbortError' ? 'AUTH_TIMEOUT' : 'AUTH_UNAVAILABLE'; console.warn('[STUDENT AUTH] Request failed', { endpoint, code }); return { ok: false, code }; }
      finally { clearTimeout(timeout); }
    })();
    setProcessing(true, 'Memproses...', 'Sedang memeriksa perangkat...');
    const [bindingResult, authResult] = await Promise.all([serverDeviceCheck(student, token), authenticate]);
    serverCheck = bindingResult;
    if (!authResult.ok) return showToast(studentAuthErrorMessage(authResult.code || 'STUDENT_AUTH_FAILED'), 'warn');
  } else {
    serverCheck = await serverDeviceCheck(student, token);
  }
  $('#student-password').value = '';
  if (serverCheck.status === 'error') return showToast(serverCheck.message, 'warn');
  if (API_BASE && serverCheck.status === 'TERDAFTAR') { completeStudentLogin(student); showToast('✅ Login berhasil.'); return; }
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

async function startStudentLogin() {
  if (loginInProgress) return;
  loginInProgress = true;
  try { return await loginStudent(); } finally { loginInProgress = false; }
}

function logoutStudent() { studentSession = null; authRole = null; persist(); stopCamera(); renderProfileIdentity(); $('#scan-result').className = 'scan-result'; setView('login'); showToast('Anda telah keluar dari akun siswa.'); }

function sendWA(studentId, type = 'arrival') {
  const row = allRows().find(({ student }) => student.id === studentId); if (!row?.record || (type === 'departure' && !row.record.checkOut)) return;
  const { student, record } = row;
  const branch = record.branch || student.branch || 'cabang';
  const date = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Makassar' }).format(new Date(`${record.date || dateKey()}T00:00:00+08:00`));
  const message = type === 'departure'
    ? `Halo Ayah/Bunda 😊\n\nKami ingin menginformasikan bahwa *${student.name}* telah selesai mengikuti pembelajaran di *Brain Academy ${branch}*.\n\n📅 *Tanggal:* ${date}\n🕐 *Jam Datang:* ${record.checkIn} WITA\n🕐 *Jam Pulang:* ${record.checkOut} WITA\n\nSemoga ${student.name} mendapatkan pengalaman belajar yang baik hari ini dan terus semangat dalam proses belajarnya. 💪😊\n\nJangan lupa untuk mengingatkan ${student.name} *mereview kembali materi yang sudah diajarkan hari ini*, dan menyelesaikan target harian Drill Soal. 📚✨\n\nTerima kasih atas perhatian dan dukungan Ayah/Bunda dalam mendampingi proses belajar ${student.name}. 🙏\n\nSalam hangat,\n*Student Mentor*`
    : `Halo Ayah/Bunda 😊\n\nKami ingin menginformasikan bahwa *${student.name}* sudah hadir di *Brain Academy ${branch}*\n\n📅 *Tanggal:* ${date}\n🕐 *Jam Datang:* ${record.checkIn} WITA\n\nSemoga ${student.name} dapat mengikuti pembelajaran dengan lancar dan mendapatkan pengalaman belajar yang baik hari ini.\n\nTerima kasih atas perhatian dan dukungan Ayah/Bunda dalam mendampingi proses belajar ${student.name}. 🙏\n\nSalam hangat,\n*Student Mentor*`;
  const phone = String(student.parentPhone || '').replace(/\D/g, '');
  if (!phone) return showToast('Nomor WhatsApp orang tua belum tersedia.', 'warn');
  const key = `${dateKey()}::${student.id}`;
  const processedAt = new Date().toISOString(); saveWaStatus(key, type, { status: 'processed', processedAt, studentId: student.id }); persist();
  syncWaStatus({ date: dateKey(), studentId: student.id, messageType: type, status: 'processed', processedAt });
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer');
  showToast(`WhatsApp ${type === 'departure' ? 'pulang' : 'datang'} untuk ${student.name} dibuka. Status: Sudah Diproses.`); renderDashboard();
}

function openConfirm(studentId, type = 'arrival') { pendingDeliveredId = studentId; pendingDeliveredType = type; $('#confirm-modal').querySelector('p').innerHTML = `Tandai pesan WhatsApp ${type === 'departure' ? 'jam pulang' : 'jam datang'} sebagai sudah terkirim setelah Anda memastikan pesan telah dikirim.`; $('#confirm-modal').hidden = false; }
function confirmDelivered() { if (!pendingDeliveredId || !pendingDeliveredType) return; const key = `${dateKey()}::${pendingDeliveredId}`; const type = pendingDeliveredType; const deliveredAt = new Date().toISOString(); const studentId = pendingDeliveredId; saveWaStatus(key, type, { status: 'delivered', deliveredAt, studentId }); persist(); syncWaStatus({ date: dateKey(), studentId, messageType: type, status: 'delivered', deliveredAt }); $('#confirm-modal').hidden = true; pendingDeliveredId = null; pendingDeliveredType = null; renderDashboard(); showToast(`Status WA ${type === 'departure' ? 'pulang' : 'datang'} diubah menjadi Sudah Terkirim.`); }

async function activateCamera() {
  if (!navigator.mediaDevices?.getUserMedia) return showToast('Kamera tidak tersedia di browser ini. Gunakan input ID manual.', 'warn');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); cameraStream = stream;
    const stage = $('#scanner-stage'); let video = $('#camera-preview');
    if (!video) { video = document.createElement('video'); video.id = 'camera-preview'; video.autoplay = true; video.muted = true; video.playsInline = true; video.style.cssText = 'position:absolute;inset:16px;width:calc(100% - 32px);height:150px;object-fit:cover;border-radius:8px;opacity:.8;z-index:3'; stage.prepend(video); }
    video.srcObject = stream; $('#camera-button').innerHTML = '<span>■</span> Kamera aktif'; showToast('Kamera aktif. Arahkan QR cabang ke area pemindaian.');
    if ('BarcodeDetector' in window) barcodeDetector = new BarcodeDetector({ formats: ['qr_code', 'code_128', 'code_39', 'ean_13'] });
    else barcodeDetector = null;
    scanCanvas = scanCanvas || document.createElement('canvas'); scanVideo(video);
  } catch { showToast('Izin kamera ditolak. Anda tetap dapat memasukkan ID manual.', 'warn'); }
}
async function scanVideo(video) {
  if (!cameraStream || scannerLocked) return;
  try {
    let value = '';
    if (barcodeDetector) {
      const codes = await barcodeDetector.detect(video); value = codes[0]?.rawValue || '';
    } else if (video.readyState >= 2) {
      const width = video.videoWidth; const height = video.videoHeight;
      if (width && height) { scanCanvas.width = width; scanCanvas.height = height; const context = scanCanvas.getContext('2d', { willReadFrequently: true }); context.drawImage(video, 0, 0, width, height); const result = jsQR(context.getImageData(0, 0, width, height).data, width, height, { inversionAttempts: 'attemptBoth' }); value = result?.data || ''; }
    }
    if (value) { scannerLocked = true; stopCamera(); await processScan(value); return; }
  } catch { /* continue scanning */ }
  cameraTimer = setTimeout(() => scanVideo(video), 300);
}
function stopCamera() { cameraStream?.getTracks().forEach((track) => track.stop()); cameraStream = null; if (cameraTimer) clearTimeout(cameraTimer); barcodeDetector = null; const button = $('#camera-button'); if (button) { button.disabled = false; button.innerHTML = '<span>◉</span> Aktifkan kamera'; } }

document.addEventListener('click', (event) => {
  const profileTrigger = event.target.closest('#profile-trigger'); if (profileTrigger) return toggleProfileMenu();
  if (!event.target.closest('.profile-menu-wrap')) closeProfileMenu();
  const editPhoto = event.target.closest('#edit-profile-photo'); if (editPhoto) return $('#profile-photo-input').click();
  const profileLogout = event.target.closest('#profile-logout'); if (profileLogout) return logoutCurrentAccount();
  const studentResult = event.target.closest('[data-student-id]'); if (studentResult) chooseStudent(studentResult.dataset.studentId);
  if (!event.target.closest('.student-picker')) { const results = $('#student-results'); if (results) { results.hidden = true; $('#student-search').setAttribute('aria-expanded', 'false'); } }
  const nav = event.target.closest('[data-view]'); if (nav) { if (nav.dataset.view === 'dashboard' && ['teacher', 'admin'].includes(authRole)) { setProcessing(true, 'Sedang memproses...', 'Menyiapkan Dashboard Student Mentor.'); setTimeout(() => { setView('dashboard'); setProcessing(false); }, 350); } else setView(nav.dataset.view); }
  const summaryMetric = event.target.closest('[data-class-detail]'); if (summaryMetric) return openClassDetail(summaryMetric.dataset.classDetail, summaryMetric.dataset.classKey);
  const summaryStat = event.target.closest('[data-class-summary-stat]'); if (summaryStat) return openClassSummaryStat(summaryStat.dataset.classSummaryStat);
  const detailBreakdown = event.target.closest('[data-class-breakdown]'); if (detailBreakdown) return openClassDetail(classDetailState.metric, classDetailState.rowKey, detailBreakdown.dataset.classBreakdown);
  const summaryBreakdown = event.target.closest('[data-class-summary-breakdown]'); if (summaryBreakdown) return openClassSummaryStat(classDetailState.metric, summaryBreakdown.dataset.classSummaryBreakdown);
  const role = event.target.closest('[data-role]'); if (role) { $$('.role-tab').forEach((tab) => tab.classList.toggle('active', tab === role)); const studentRole = role.dataset.role === 'student'; const teacherRole = role.dataset.role === 'teacher'; $('#student-login-panel').hidden = !studentRole; $('#teacher-login-panel').hidden = !teacherRole; }
  const resetDevice = event.target.closest('[data-reset-device]'); if (resetDevice) openResetDevice(resetDevice.dataset.resetDevice);
  const wa = event.target.closest('[data-wa]'); if (wa && !wa.disabled) sendWA(wa.dataset.wa, wa.dataset.waType);
  const status = event.target.closest('[data-status-id]'); if (status && !status.disabled && waStatusFor(`${dateKey()}::${status.dataset.statusId}`, status.dataset.statusType).status === 'processed') openConfirm(status.dataset.statusId, status.dataset.statusType);
});
$('#scan-form').addEventListener('submit', (event) => { event.preventDefault(); processScan($('#barcode-input').value); });
$('#student-login-submit').addEventListener('click', () => runWithProcessing($('#student-login-submit'), startStudentLogin, 'Memproses...'));
$('#student-search').addEventListener('input', () => { $('#student-account').value = ''; $('#student-password').value = ''; $('#student-password').disabled = true; populateStudentAccounts(); });
$('#teacher-login-submit').addEventListener('click', () => runWithProcessing($('#teacher-login-submit'), () => loginStaff('teacher', $('#teacher-password').value), 'Sedang membuka dashboard...'));
$('#profile-photo-input').addEventListener('change', (event) => { const file = event.target.files?.[0]; if (!file) return; if (!file.type.startsWith('image/')) return showToast('Pilih file foto yang valid.', 'warn'); if (file.size > 2 * 1024 * 1024) return showToast('Ukuran foto maksimal 2 MB.', 'warn'); const reader = new FileReader(); reader.onload = () => { localStorage.setItem(PROFILE_PHOTO_KEY, String(reader.result)); renderProfileIdentity(); closeProfileMenu(); showToast('Foto profil berhasil diperbarui.'); }; reader.readAsDataURL(file); event.target.value = ''; });
$('#logout-button').addEventListener('click', logoutStudent);
$('#bind-cancel').addEventListener('click', cancelBind); $('#bind-confirm').addEventListener('click', () => { if (pendingBindStudent) runWithProcessing($('#bind-confirm'), () => bindDevice(pendingBindStudent), 'Mendaftarkan perangkat...'); });
$('#reset-device-cancel').addEventListener('click', () => { pendingResetStudentId = null; $('#reset-device-modal').hidden = true; }); $('#reset-device-confirm').addEventListener('click', confirmResetDevice);
$('#clear-input').addEventListener('click', () => { $('#barcode-input').value = ''; $('#barcode-input').focus(); });
$('#camera-button').addEventListener('click', activateCamera);
$('#search-input').addEventListener('input', renderDashboard); $('#branch-filter').addEventListener('change', renderDashboard); $('#class-filter').addEventListener('change', renderDashboard); $('#attendance-filter').addEventListener('change', renderDashboard); $('#wa-filter').addEventListener('change', renderDashboard);
$('#filter-toggle').addEventListener('click', () => $('#filter-row').classList.toggle('show'));
$('#reset-filter').addEventListener('click', () => { $('#branch-filter').value = 'all'; $('#class-filter').value = 'all'; $('#attendance-filter').value = 'all'; $('#wa-filter').value = 'all'; $('#search-input').value = ''; renderDashboard(); });
$('#device-search').addEventListener('input', renderDeviceManagement); $('#device-status-filter').addEventListener('change', renderDeviceManagement); $('#refresh-device-button').addEventListener('click', async (event) => {
  const button = event.currentTarget; if (button.disabled) return;
  const original = button.innerHTML; button.disabled = true; button.setAttribute('aria-busy', 'true'); button.innerHTML = '↻ Memuat...'; deviceBindingsLoadState = 'loading'; renderDeviceManagement();
  try {
    await Promise.all([loadStudents(), loadDeviceBindings()]);
    populateStudentAccounts(); renderDeviceManagement();
    if (deviceBindingsLoadState === 'error') showToast('Gagal mengambil data Device Binding. Silakan coba lagi.', 'warn');
    else showToast('Daftar device berhasil disegarkan.');
  } catch (error) {
    deviceBindingsLoadState = 'error'; console.warn('[DEVICE BINDING] Refresh failed', { message: error?.message || String(error) }); renderDeviceManagement(); showToast('Gagal mengambil data Device Binding. Silakan coba lagi.', 'warn');
  } finally { button.disabled = false; button.removeAttribute('aria-busy'); button.innerHTML = original; }
});
$('#refresh-branch-barcode').addEventListener('click', renderBranchBarcodes); $('#print-all-branch-barcode').addEventListener('click', () => { $$('.branch-barcode-card').forEach(card => card.classList.add('print-target')); window.print(); $$('.branch-barcode-card').forEach(card => card.classList.remove('print-target')); });
$('#class-summary-branch-filter').addEventListener('change', renderClassSummary); $('#class-summary-class-filter').addEventListener('change', renderClassSummary); $('#class-detail-search').addEventListener('input', renderClassDetail); $('#class-detail-close').addEventListener('click', closeClassDetail); $('#class-detail-modal').addEventListener('click', (event) => { if (event.target.id === 'class-detail-modal') closeClassDetail(); });
$('#refresh-class-summary').addEventListener('click', async (event) => { const button = event.currentTarget; if (button.disabled) return; const original = button.innerHTML; button.disabled = true; button.innerHTML = '↻ Memuat...'; classSummaryLoadState = 'loading'; renderClassSummary(); try { await Promise.all([loadStudents(), loadDeviceBindings(), loadAttendance(), loadWaStatuses()]); classSummaryLoadState = 'ready'; renderClassSummary(); showToast('Rekap kelas berhasil disegarkan.'); } catch (error) { classSummaryLoadState = 'error'; console.warn('[CLASS SUMMARY] Refresh failed', { message: error?.message || String(error) }); renderClassSummary(); showToast('Data rekap kelas belum dapat dimuat. Silakan coba lagi.', 'warn'); } finally { button.disabled = false; button.innerHTML = original; } });
document.addEventListener('click', event => { const printButton = event.target.closest('[data-print-branch]'); if (printButton) printBranchBarcode(printButton.dataset.printBranch); });
$('#refresh-button').addEventListener('click', async () => { await Promise.all([loadAttendance(), loadWaStatuses()]); renderAll(); showToast('Rekap berhasil disegarkan.'); });
$('#export-button').addEventListener('click', () => { const rows = allRows(); const csv = [['Siswa', 'ID', 'Kelas', 'ID Cabang', 'Cabang', 'Jam Datang', 'Jam Pulang', 'Status', 'Status WA Datang', 'Status WA Pulang'], ...rows.map(({ student, record, wa }) => [student.name, student.id, student.className, record?.branchId || student.branchId || '', record?.branch || student.branch || '', record?.checkIn || '', record?.checkOut || '', record ? (record.checkOut ? 'Hadir' : 'Belum Pulang') : 'Belum Hadir', wa.arrival.status, wa.departure.status])].map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n'); const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); link.download = `rekap-presensi-${dateKey()}.csv`; link.click(); URL.revokeObjectURL(link.href); showToast('Rekap CSV berhasil diunduh.'); });
$('#modal-cancel').addEventListener('click', () => { $('#confirm-modal').hidden = true; pendingDeliveredId = null; pendingDeliveredType = null; }); $('#modal-confirm').addEventListener('click', confirmDelivered);
window.addEventListener('beforeunload', stopCamera);

const formattedToday = new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Makassar' }).format(new Date());
$('#display-date').textContent = formattedToday;
if ($('#table-date')) $('#table-date').textContent = formattedToday;
populateStudentAccounts(); renderBranchOptions(); renderClassOptions(); renderAll(); renderProfileIdentity();
Promise.all([loadStudents(), loadBranches()]).then(() => { populateStudentAccounts(); renderBranchOptions(); renderClassOptions(); renderAll(); renderProfileIdentity(); if ($('#admin-view')?.classList.contains('active-view')) renderDeviceManagement(); return resumeStudentSession(); }).catch(() => {});
if (staffSession) loadDashboardData();
renderProfileIdentity();
