/**
 * Backend Apps Script untuk Aplikasi Presensi Siswa.
 *
 * Deploy: Deploy > New deployment > Web app, execute as you, access anyone.
 * Simpan konfigurasi melalui setupProperties() lalu isi Script Properties:
 * SPREADSHEET_ID, PRESENSI_STAFF_PASSWORD, PRESENSI_ADMIN_PASSWORD,
 * PRESENSI_ADMIN_TOKEN (opsional).
 */
const SHEETS = {
  students: 'Database Siswa',
  branches: 'Database Cabang',
  studentBranches: 'Siswa Cabang',
  attendance: 'Presensi',
  wa: 'StatusWA',
  bindings: 'Device Binding',
  resetLog: 'Device Reset Log',
};

function doGet(e) { return handle_(e, 'GET'); }
function doPost(e) { return handle_(e, 'POST'); }

function setupProperties() {
  PropertiesService.getScriptProperties().setProperties({
    SPREADSHEET_ID: SpreadsheetApp.getActiveSpreadsheet().getId(),
    PRESENSI_STAFF_PASSWORD: 'GANTI_PASSWORD_WALI',
    PRESENSI_ADMIN_PASSWORD: 'GANTI_PASSWORD_ADMIN',
    PRESENSI_ADMIN_TOKEN: '',
  }, false);
  setupSheets_();
}

function setupSheets() {
  setupSheets_();
}

function handle_(e, method) {
  try {
    const route = route_(e);
    if (route === 'health') return json_({ ok: true, service: 'presensi-apps-script' }, e);
    if (method === 'GET') {
      if (route === 'students') return json_({ students: students_() }, e);
      if (route === 'branches') return json_({ branches: branches_() }, e);
      if (route === 'attendance') return json_({ entries: attendanceRows_(e && e.parameter && e.parameter.date) }, e);
      if (route === 'device-bindings') return json_({ bindings: publicBindings_() }, e);
      if (route === 'device-reset-log') return json_({ entries: rows_(sheet_(SHEETS.resetLog)) }, e);
      if (route === 'wa-status') return json_({ entries: waStatusRows_(e && e.parameter && e.parameter.date) }, e);
    }
    const payload = body_(e);
    if (method === 'POST') {
      if (route === 'staff/login') return staffLogin_(payload);
      if (route === 'student/login') return studentLogin_(payload);
      if (route === 'staff/validate') return staffValidate_(e);
      if (route === 'device-binding/check') return bindingCheck_(payload);
      if (route === 'device-binding/bind') return bindingBind_(payload);
      if (route === 'device-binding/reset') return bindingReset_(e, payload);
      if (route === 'attendance') return attendance_(payload);
      if (route === 'wa-status') return waStatus_(payload);
    }
    return json_({ success: false, code: 'ENDPOINT_NOT_FOUND', message: 'Endpoint tidak ditemukan.' }, e, 404);
  } catch (error) {
    console.error('[AUTH] Request failed: ' + String(error && error.message || error));
    return json_({ success: false, code: 'SERVER_ERROR', message: 'Server autentifikasi mengalami masalah.' }, e, 500);
  }
}

function route_(e) {
  const path = String(e && e.pathInfo || e && e.parameter && (e.parameter.route || e.parameter.path) || '').replace(/^\/+|\/+$/g, '');
  return path.replace(/^api\//, '');
}

function body_(e) {
  if (!e || !e.postData || !e.postData.contents) return {};
  try { return JSON.parse(e.postData.contents); } catch (_) { return e.parameter || {}; }
}

function json_(value, e, status) {
  const output = ContentService.createTextOutput(JSON.stringify(value));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}

function props_() { return PropertiesService.getScriptProperties(); }
function property_(name) { return props_().getProperty(name) || ''; }
function book_() {
  const id = property_('SPREADSHEET_ID');
  if (!id) throw new Error('SPREADSHEET_ID belum diisi di Script Properties.');
  return SpreadsheetApp.openById(id);
}
function sheet_(name) {
  const sheet = book_().getSheetByName(name);
  if (!sheet) throw new Error('Sheet belum dibuat: ' + name);
  return sheet;
}
function rows_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0].map(String);
  return values.slice(1).filter(row => row.some(value => value !== '')).map(row => {
    const item = {}; headers.forEach((header, index) => item[header] = row[index]); return item;
  });
}
function normalizeHeader_(value) { return String(value == null ? '' : value).trim().toLowerCase().replace(/\s+/g, ' '); }
function headerMap_(sheet) {
  const headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
  const headerMap = {}; headers.forEach((header, index) => headerMap[normalizeHeader_(header)] = index);
  return headerMap;
}
function value_(row, map, ...names) {
  for (const name of names) { const index = map[normalizeHeader_(name)]; if (index !== undefined) return row[index]; }
  return '';
}
function sha256_(value) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value), Utilities.Charset.UTF_8);
  return bytes.map(byte => (byte < 0 ? byte + 256 : byte).toString(16).padStart(2, '0')).join('');
}
function iso_(value) { return value instanceof Date ? value.toISOString() : value ? String(value) : ''; }
function dateKey_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Makassar', 'yyyy-MM-dd'); }
function normalizeDate_(value) {
  if (value instanceof Date) return Utilities.formatDate(value, Session.getScriptTimeZone() || 'Asia/Makassar', 'yyyy-MM-dd');
  const text = String(value || '').trim();
  if (!text) return '';
  const iso = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? text.slice(0, 10) : Utilities.formatDate(parsed, Session.getScriptTimeZone() || 'Asia/Makassar', 'yyyy-MM-dd');
}

function students_() {
  const source = sheet_(SHEETS.students); const values = source.getDataRange().getValues();
  if (values.length < 2) return [];
  const map = headerMap_(source); const branchMap = {}; const branchByName = {};
  rows_(sheet_(SHEETS.branches)).forEach(row => {
    const id = String(row['ID Cabang'] || row['id cabang'] || row['id'] || '').trim();
    const name = String(row['Nama Cabang'] || row['nama cabang'] || row['name'] || '').trim();
    if (id && name) branchByName[name.toLocaleLowerCase()] = { branchId: id, branch: name };
  });
  rows_(sheet_(SHEETS.studentBranches)).forEach(row => {
    const id = String(row['ID Siswa'] || row['id siswa'] || row['User Serial'] || '').trim();
    if (id) branchMap[id] = { branchId: String(row['ID Cabang'] || row['id cabang'] || '').trim(), branch: String(row['Nama Cabang'] || row['nama cabang'] || '').trim() };
  });
  return values.slice(1).filter(row => row.some(value => value !== '')).map(row => {
    const id = String(value_(row, map, 'User Serial', 'ID Siswa', 'id') || '').trim(); const name = String(value_(row, map, 'Nama Siswa', 'name') || '').trim(); const branch = branchMap[id] || {};
    const directBranchId = String(value_(row, map, 'ID Cabang', 'branchId') || '').trim();
    const directBranchName = String(value_(row, map, 'Nama Cabang Siswa', 'Nama Cabang', 'Cabang', 'branchName', 'branch') || '').trim();
    const catalogBranch = branchByName[directBranchName.toLocaleLowerCase()] || {};
    return { id, name, parentPhone: String(value_(row, map, 'No Ortu', 'Nomor WhatsApp', 'parentPhone') || '').trim(), grade: String(value_(row, map, 'Grade', 'grade') || '').trim(), className: String(value_(row, map, 'Kelas', 'className') || '').trim(), branchId: branch.branchId || directBranchId || catalogBranch.branchId || '', branch: branch.branch || directBranchName || catalogBranch.branch || '' };
  }).filter(student => student.id && student.name);
}

function studentLogin_(payload) {
  const studentId = String(payload.studentId || '').trim();
  const password = String(payload.password || '');
  if (!studentId || !password) return json_({ success: false, authenticated: false, code: 'STUDENT_PASSWORD_REQUIRED', message: 'Password siswa wajib diisi.' }, null, 400);
  const source = sheet_(SHEETS.students); const values = source.getDataRange().getValues(); const map = headerMap_(source);
  const row = values.slice(1).find(item => String(value_(item, map, 'User Serial', 'ID Siswa', 'id') || '').trim() === studentId);
  if (!row) return json_({ success: false, authenticated: false, code: 'STUDENT_AUTH_FAILED', message: 'Password siswa salah.' }, null, 401);
  const storedHash = String(value_(row, map, 'PIN Hash', 'Password Hash', 'Password Siswa Hash', 'Kata Sandi Hash') || '').trim().toLowerCase();
  const storedPassword = String(value_(row, map, 'Password', 'Password Siswa', 'Kata Sandi') || '');
  const salt = String(value_(row, map, 'Password Salt', 'Student Password Salt') || '').trim();
  if (!storedHash && !storedPassword) {
    console.warn('[STUDENT AUTH] Password hash is not configured for student: ' + studentId);
    return json_({ success: false, authenticated: false, code: 'STUDENT_PASSWORD_NOT_CONFIGURED', message: 'Password siswa belum dikonfigurasi.' }, null, 503);
  }
  const valid = storedHash
    ? (salt ? sha256_(salt + ':' + password) : sha256_(password)) === storedHash
    : password === storedPassword;
  if (!valid) return json_({ success: false, authenticated: false, code: 'STUDENT_AUTH_FAILED', message: 'Password siswa salah.' }, null, 401);
  return json_({ success: true, authenticated: true, student: { id: studentId } });
}

function ensureColumn_(sheet, name) {
  const map = headerMap_(sheet); const key = String(name).trim().toLowerCase();
  if (map[key] !== undefined) return map[key] + 1;
  const column = Math.max(sheet.getLastColumn(), 1) + 1; sheet.getRange(1, column).setValue(name); return column;
}

function setupStudentPasswordColumns() {
  const sheet = sheet_(SHEETS.students); ensureColumn_(sheet, 'Password Hash'); ensureColumn_(sheet, 'Password Salt');
}

/** Run manually from the Apps Script editor for each student; the raw password is never stored. */
function setStudentPassword(studentId, password) {
  const id = String(studentId || '').trim(); const value = String(password || '');
  if (!id || !value) throw new Error('studentId dan password wajib diisi.');
  const sheet = sheet_(SHEETS.students); const values = sheet.getDataRange().getValues(); const map = headerMap_(sheet);
  const idColumn = map['user serial'] !== undefined ? map['user serial'] : map['id siswa'];
  if (idColumn === undefined) throw new Error('Kolom User Serial/ID Siswa tidak ditemukan.');
  const rowIndex = values.slice(1).findIndex(row => String(row[idColumn]).trim() === id);
  if (rowIndex < 0) throw new Error('Siswa tidak ditemukan.');
  const hashColumn = ensureColumn_(sheet, 'Password Hash'); const saltColumn = ensureColumn_(sheet, 'Password Salt'); const salt = Utilities.getUuid();
  sheet.getRange(rowIndex + 2, hashColumn).setValue(sha256_(salt + ':' + value)); sheet.getRange(rowIndex + 2, saltColumn).setValue(salt);
}

function branches_() {
  const source = sheet_(SHEETS.branches); const values = source.getDataRange().getValues(); if (values.length < 2) return [];
  const map = headerMap_(source); return values.slice(1).filter(row => row.some(value => value !== '')).map(row => ({
    id: String(value_(row, map, 'ID Cabang', 'id') || '').trim(), name: String(value_(row, map, 'Nama Cabang', 'name') || '').trim(), status: String(value_(row, map, 'Status', 'status') || 'Aktif').trim(),
    latitude: number_(value_(row, map, 'Latitude', 'Lat')), longitude: number_(value_(row, map, 'Longitude', 'Lng', 'Long')), radius: number_(value_(row, map, 'Radius (meter)', 'Radius Meter', 'Radius', 'GPS Radius')) || 100
  })).filter(branch => branch.id);
}

function number_(value) { const parsed = Number(String(value ?? '').replace(',', '.').trim()); return Number.isFinite(parsed) ? parsed : null; }
function distanceMeters_(lat1, lon1, lat2, lon2) {
  const radians = value => value * Math.PI / 180; const earthRadius = 6371000; const dLat = radians(lat2 - lat1); const dLon = radians(lon2 - lon1); const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLon / 2) ** 2; return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function branchById_(branchId) { return branches_().find(branch => String(branch.id).toUpperCase() === String(branchId || '').trim().toUpperCase() && branch.status !== 'Nonaktif'); }
function studentBranchId_(studentId) { const student = students_().find(item => String(item.id) === String(studentId)); return student?.branchId || ''; }

function setupSheets_() {
  const definitions = {};
  definitions[SHEETS.branches] = ['ID Cabang', 'Nama Cabang', 'Status'];
  definitions[SHEETS.studentBranches] = ['ID Siswa', 'Nama Siswa', 'ID Cabang', 'Nama Cabang'];
  definitions[SHEETS.attendance] = ['Tanggal', 'ID Siswa', 'Nama Siswa', 'Kelas', 'ID Cabang', 'Cabang', 'Jam Datang', 'Jam Pulang', 'Status'];
  definitions[SHEETS.wa] = ['Tanggal', 'ID Siswa', 'Status WA', 'Waktu Diproses', 'Waktu Terkirim', 'Jenis WA'];
  definitions[SHEETS.bindings] = ['ID Siswa', 'Nama Siswa', 'Device Token', 'Status', 'Tanggal Bind', 'Tanggal Reset', 'Updated At'];
  definitions[SHEETS.resetLog] = ['ID', 'ID Siswa', 'Nama Siswa', 'Waktu Reset', 'Admin', 'Alasan', 'Status', 'Device Token'];
  const book = book_(); Object.keys(definitions).forEach(name => { let sheet = book.getSheetByName(name); if (!sheet) sheet = book.insertSheet(name); if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, definitions[name].length).setValues([definitions[name]]); });
}

function bindingRows_() { return rows_(sheet_(SHEETS.bindings)); }
function bindingId_(value) { return String(value || '').trim().toUpperCase(); }
function bindingField_(row, ...names) {
  const wanted = names.map(name => String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, ''));
  const key = Object.keys(row || {}).find(header => wanted.includes(String(header).trim().toLowerCase().replace(/[^a-z0-9]+/g, '')));
  return key === undefined ? '' : row[key];
}
function bindingTime_(value) { if (value instanceof Date) return value.getTime(); const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime(); }
function bindingStudentId_(row) { return String(bindingField_(row, 'ID Siswa', 'User Serial', 'Student ID', 'studentId', 'id siswa', 'id') || '').trim(); }
function bindingName_(row) { return String(bindingField_(row, 'Nama Siswa', 'Student Name', 'studentName', 'nama siswa', 'name') || '').trim(); }
function bindingDevice_(row) { return String(bindingField_(row, 'Device Token', 'Device ID', 'DeviceId', 'device_token', 'device_id', 'deviceToken') || '').trim(); }
function bindingStatus_(row) { const raw = String(bindingField_(row, 'Status', 'Device Status', 'Binding Status', 'status') || '').trim().toLowerCase(); if (/reset|revoke|nonaktif|inactive|disabled/.test(raw)) return 'DI-RESET'; if (bindingDevice_(row) || /terdaftar|registered|aktif|active/.test(raw)) return 'TERDAFTAR'; return raw ? raw.toUpperCase() : 'BELUM_TERDAFTAR'; }
function bindingBoundAt_(row) { return bindingField_(row, 'Tanggal Bind', 'Terdaftar Sejak', 'Registered At', 'Bound At', 'registeredAt', 'boundAt'); }
function bindingResetAt_(row) { return bindingField_(row, 'Tanggal Reset', 'Reset At', 'resetAt'); }
function bindingUpdatedAt_(row) { return bindingField_(row, 'Updated At', 'Diperbarui', 'updatedAt'); }
function bindingIndex_(rows, studentId) { const wanted = bindingId_(studentId); let index = -1; let latest = -1; rows.forEach((row, rowIndex) => { if (bindingId_(bindingStudentId_(row)) !== wanted) return; const updated = bindingTime_(bindingUpdatedAt_(row) || bindingBoundAt_(row)); if (updated >= latest) { latest = updated; index = rowIndex; } }); return index; }
function binding_(studentId) { const rows = bindingRows_(); const index = bindingIndex_(rows, studentId); return index >= 0 ? rows[index] : null; }
function publicBindings_() { const result = {}; const rows = bindingRows_(); let active = 0; rows.forEach((row, index) => { const id = bindingStudentId_(row); if (!id || bindingIndex_(rows, id) !== index) return; const status = bindingStatus_(row); if (status === 'TERDAFTAR') active += 1; result[id] = { studentId: id, studentName: bindingName_(row), status, boundAt: iso_(bindingBoundAt_(row)), resetAt: iso_(bindingResetAt_(row)), updatedAt: iso_(bindingUpdatedAt_(row)) }; }); console.info('[DEVICE BINDING] Sheets rows: %s, bindings: %s, active devices: %s', rows.length, Object.keys(result).length, active); return result; }
function tokenInUse_(token, exceptId) { const wanted = bindingId_(exceptId); return bindingRows_().some(row => bindingId_(bindingStudentId_(row)) !== wanted && bindingStatus_(row) === 'TERDAFTAR' && bindingDevice_(row) === String(token || '').trim()); }
function writeRow_(sheet, rowNumber, values) { sheet.getRange(rowNumber, 1, 1, values.length).setValues([values]); }
function bindingCheck_(payload) { const binding = binding_(payload.studentId); if (tokenInUse_(payload.deviceToken, payload.studentId)) return json_({ status: 'DEVICE_DIPAKAI', message: 'Perangkat ini sudah terdaftar untuk akun siswa lain.' }, null, 409); if (!binding) return json_({ status: 'BELUM_TERDAFTAR' }); if (bindingStatus_(binding) === 'DI-RESET') return json_({ status: 'DI-RESET' }); if (!payload.deviceToken) return json_({ status: 'DEVICE_TIDAK_DIkenal', message: 'Perangkat tidak dikenali.' }, null, 409); if (bindingDevice_(binding) !== String(payload.deviceToken).trim()) return json_({ status: 'DEVICE_LAIN', message: 'Akun ini sudah terdaftar pada perangkat lain.' }, null, 409); return json_({ status: 'TERDAFTAR' }); }
function bindingBind_(payload) {
  if (!payload.studentId || !payload.deviceToken) return json_({ message: 'studentId dan deviceToken wajib diisi.' }, null, 400);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return json_({ message: 'Server sedang memproses pendaftaran perangkat lain. Silakan coba lagi.' }, null, 409);
  try {
    if (tokenInUse_(payload.deviceToken, payload.studentId)) return json_({ message: 'Perangkat ini sudah terdaftar untuk akun siswa lain.' }, null, 409);
    const sheet = sheet_(SHEETS.bindings); const rows = bindingRows_(); const index = bindingIndex_(rows, payload.studentId); const current = index >= 0 ? rows[index] : null;
    if (current && bindingStatus_(current) === 'TERDAFTAR' && bindingDevice_(current) !== String(payload.deviceToken).trim()) return json_({ message: 'Akun ini sudah terdaftar pada perangkat lain.' }, null, 409);
    const now = new Date(); const row = [payload.studentId, payload.studentName || bindingName_(current || {}) || '', payload.deviceToken, 'TERDAFTAR', bindingBoundAt_(current || {}) || now, '', now];
    if (index >= 0) writeRow_(sheet, index + 2, row); else sheet.appendRow(row);
    return json_({ status: 'TERDAFTAR' });
  } finally { lock.releaseLock(); }
}

function session_(e) { const token = e && e.parameter && e.parameter.token || ''; return token ? CacheService.getScriptCache().get('staff:' + token) : ''; }
function staffLogin_(payload) {
  const role = String(payload.role || '');
  if (role !== 'teacher' && role !== 'admin') return json_({ success: false, authenticated: false, code: 'AUTH_INVALID_ROLE', message: 'Role staf tidak valid.' }, null, 400);
  const expected = role === 'admin' ? property_('PRESENSI_ADMIN_PASSWORD') : property_('PRESENSI_STAFF_PASSWORD');
  if (!expected || expected === 'GANTI_PASSWORD_WALI' || expected === 'GANTI_PASSWORD_ADMIN') {
    console.warn('[AUTH] Staff password is not configured for role: ' + role);
    return json_({ success: false, authenticated: false, code: 'AUTH_CONFIG_MISSING', message: 'Konfigurasi autentifikasi staf belum lengkap.' }, null, 503);
  }
  if (String(payload.password || '') !== expected) return json_({ success: false, authenticated: false, code: 'AUTH_FAILED', message: 'Autentifikasi staf gagal.' }, null, 401);
  const token = Utilities.getUuid();
  CacheService.getScriptCache().put('staff:' + token, role, 21600);
  return json_({ success: true, authenticated: true, staff: { role }, role, token });
}
function staffValidate_(e) { const role = session_(e); return role ? json_({ success: true, authenticated: true, staff: { role }, role }) : json_({ success: false, authenticated: false, code: 'AUTH_SESSION_INVALID', message: 'Sesi staf tidak valid.' }, null, 401); }
function bindingReset_(e, payload) { const role = session_(e); if (role !== 'teacher' && role !== 'admin') return json_({ message: 'Hanya Student Mentor yang dapat melakukan Reset Device.' }, null, 403); const bindingSheet = sheet_(SHEETS.bindings); const rows = bindingRows_(); const index = bindingIndex_(rows, payload.studentId); const current = index >= 0 ? rows[index] : null; if (!current) return json_({ message: 'Binding siswa tidak ditemukan.' }, null, 404); const now = new Date(); writeRow_(bindingSheet, index + 2, [bindingStudentId_(current), bindingName_(current), '', 'DI-RESET', bindingBoundAt_(current), now, now]); sheet_(SHEETS.resetLog).appendRow(['RESET-' + Date.now(), bindingStudentId_(current), bindingName_(current), now, 'Student Mentor', payload.reason || 'Reset Device', 'DI-RESET', bindingDevice_(current)]); return json_({ status: 'DI-RESET' }); }

function attendance_(payload) {
  const branch = branchById_(payload.branchId); if (!branch) return json_({ ok: false, code: 'BRANCH_NOT_FOUND', message: 'Cabang presensi tidak ditemukan.' }, null, 400);
  const mappedBranchId = studentBranchId_(payload.studentId); if (!mappedBranchId || String(mappedBranchId).toUpperCase() !== String(payload.branchId || '').toUpperCase()) return json_({ ok: false, code: 'BRANCH_MISMATCH', message: 'Siswa tidak dapat presensi di cabang ini.' }, null, 403);
  if (!Number.isFinite(branch.latitude) || !Number.isFinite(branch.longitude)) return json_({ ok: false, code: 'BRANCH_GPS_NOT_CONFIGURED', message: 'Koordinat GPS cabang belum dikonfigurasi.' }, null, 503);
  const latitude = number_(payload.latitude); const longitude = number_(payload.longitude); if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return json_({ ok: false, code: 'GPS_REQUIRED', message: 'Lokasi GPS wajib diaktifkan untuk presensi.' }, null, 400);
  const distance = distanceMeters_(latitude, longitude, branch.latitude, branch.longitude); if (distance > branch.radius) return json_({ ok: false, code: 'OUTSIDE_BRANCH_RADIUS', message: `Anda berada di luar radius ${branch.radius} meter dari cabang.` }, null, 403);
  const sheet = sheet_(SHEETS.attendance); const data = rows_(sheet); const index = data.findIndex(row => normalizeDate_(row['Tanggal']) === normalizeDate_(payload.date || dateKey_()) && String(row['ID Siswa']) === String(payload.studentId)); const values = [payload.date || dateKey_(), payload.studentId || '', payload.name || '', payload.className || '', payload.branchId || '', payload.branch || '', payload.checkIn || '', payload.checkOut || '', payload.status || 'Belum Pulang']; if (index >= 0) writeRow_(sheet, index + 2, values); else sheet.appendRow(values); return json_({ ok: true, distance: Math.round(distance), radius: branch.radius });
}
function attendanceRows_(requestedDate) {
  const wanted = String(requestedDate || dateKey_()).slice(0, 10); const sheet = sheet_(SHEETS.attendance); const data = rows_(sheet);
  const grouped = {};
  data.forEach(row => {
    const rawDate = row['Tanggal']; const date = rawDate instanceof Date ? Utilities.formatDate(rawDate, Session.getScriptTimeZone() || 'Asia/Makassar', 'yyyy-MM-dd') : String(rawDate || '').slice(0, 10);
    if (date !== wanted) return;
    const normalized = { ...row, Tanggal: date, 'Jam Datang': timeValue_(row['Jam Datang'], date), 'Jam Pulang': timeValue_(row['Jam Pulang'], date) };
    const studentId = String(row['ID Siswa'] || '').trim();
    if (!studentId) return;
    const key = `${date}::${studentId}`;
    const current = grouped[key];
    // Keep the most complete row when old data contains duplicate scans.
    const score = (item) => (item['Jam Datang'] ? 1 : 0) + (item['Jam Pulang'] ? 2 : 0);
    if (!current || score(normalized) >= score(current)) grouped[key] = normalized;
  });
  return Object.values(grouped);
}
function timeValue_(value, expectedDate) {
  // Empty time cells can arrive from Sheets as the zero date/time. Treat that
  // sentinel as empty so students who have not scanned are not shown as 00:00.
  if (value instanceof Date) {
    // Sheets may represent a time-only cell with the base year 1899/1900.
    // Keep it when it has a real hour/minute, but discard a zero-time value.
    if (value.getFullYear() <= 1900) {
      if (value.getHours() === 0 && value.getMinutes() === 0) return '';
      return Utilities.formatDate(value, Session.getScriptTimeZone() || 'Asia/Makassar', 'HH:mm');
    }
    if (expectedDate && Utilities.formatDate(value, Session.getScriptTimeZone() || 'Asia/Makassar', 'yyyy-MM-dd') !== expectedDate) return '';
    const formatted = Utilities.formatDate(value, Session.getScriptTimeZone() || 'Asia/Makassar', 'HH:mm');
    return formatted === '00:00' ? '' : formatted;
  }
  const text = String(value || '').trim(); if (!text) return '';
  if (/^0{1,2}[.:]0{2}$/.test(text)) return '';
  if (/^\d{1,2}[.:]\d{2}$/.test(text)) return text.replace('.', ':');
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return text;
  if (expectedDate && /^\d{4}-\d{2}-\d{2}[T\s]/.test(text) && Utilities.formatDate(parsed, Session.getScriptTimeZone() || 'Asia/Makassar', 'yyyy-MM-dd') !== expectedDate) return '';
  if (parsed.getFullYear() <= 1900) return '';
  const formatted = Utilities.formatDate(parsed, Session.getScriptTimeZone() || 'Asia/Makassar', 'HH:mm');
  return formatted === '00:00' ? '' : formatted;
}
function waStatusRows_(requestedDate) {
  const wanted = requestedDate ? normalizeDate_(requestedDate) : '';
  return rows_(sheet_(SHEETS.wa)).map(row => {
    const type = String(row['Jenis WA'] || row.messageType || 'arrival').toLowerCase() === 'departure' ? 'departure' : 'arrival';
    return { ...row, Tanggal: normalizeDate_(row['Tanggal']), 'Jenis WA': type, 'Status WA': String(row['Status WA'] || row.status || 'unprocessed').toLowerCase() || 'unprocessed' };
  }).filter(row => !wanted || row.Tanggal === wanted);
}
function waStatus_(payload) {
  const sheet = sheet_(SHEETS.wa); const date = normalizeDate_(payload.date || dateKey_()); const type = String(payload.messageType || '').toLowerCase() === 'departure' ? 'departure' : 'arrival';
  const dateColumn = ensureColumn_(sheet, 'Tanggal'); const studentColumn = ensureColumn_(sheet, 'ID Siswa'); const statusColumn = ensureColumn_(sheet, 'Status WA'); const processedColumn = ensureColumn_(sheet, 'Waktu Diproses'); const deliveredColumn = ensureColumn_(sheet, 'Waktu Terkirim'); const typeColumn = ensureColumn_(sheet, 'Jenis WA');
  const data = rows_(sheet); const index = data.findIndex(row => normalizeDate_(row['Tanggal']) === date && String(row['ID Siswa'] || '').trim() === String(payload.studentId || '').trim() && (String(row['Jenis WA'] || 'arrival').toLowerCase() === type));
  const values = Array(Math.max(sheet.getLastColumn(), typeColumn)).fill(''); values[dateColumn - 1] = date; values[studentColumn - 1] = payload.studentId || ''; values[statusColumn - 1] = payload.status || 'processed'; values[processedColumn - 1] = payload.processedAt || ''; values[deliveredColumn - 1] = payload.deliveredAt || ''; values[typeColumn - 1] = type;
  if (index >= 0) {
    const rowNumber = index + 2; sheet.getRange(rowNumber, dateColumn).setValue(date); sheet.getRange(rowNumber, studentColumn).setValue(payload.studentId || ''); sheet.getRange(rowNumber, statusColumn).setValue(payload.status || 'processed'); if (payload.processedAt) sheet.getRange(rowNumber, processedColumn).setValue(payload.processedAt); if (payload.deliveredAt) sheet.getRange(rowNumber, deliveredColumn).setValue(payload.deliveredAt); sheet.getRange(rowNumber, typeColumn).setValue(type);
  } else sheet.appendRow(values);
  return json_({ ok: true, date, studentId: payload.studentId || '', messageType: type, status: payload.status || 'processed' });
}
