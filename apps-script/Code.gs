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
      if (route === 'device-bindings') return json_({ bindings: publicBindings_() }, e);
      if (route === 'device-reset-log') return json_({ entries: rows_(sheet_(SHEETS.resetLog)) }, e);
      if (route === 'wa-status') return json_({ entries: rows_(sheet_(SHEETS.wa)) }, e);
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
function headerMap_(sheet) {
  const headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
  const map = {}; headers.forEach((header, index) => map[String(header).trim().toLowerCase()] = index);
  return map;
}
function value_(row, map, ...names) {
  for (const name of names) { const index = map[String(name).toLowerCase()]; if (index !== undefined) return row[index]; }
  return '';
}
function sha256_(value) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value), Utilities.Charset.UTF_8);
  return bytes.map(byte => (byte < 0 ? byte + 256 : byte).toString(16).padStart(2, '0')).join('');
}
function iso_(value) { return value instanceof Date ? value.toISOString() : value ? String(value) : ''; }
function dateKey_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Makassar', 'yyyy-MM-dd'); }

function students_() {
  const source = sheet_(SHEETS.students); const values = source.getDataRange().getValues();
  if (values.length < 2) return [];
  const map = headerMap_(source); const branchMap = {};
  rows_(sheet_(SHEETS.studentBranches)).forEach(row => {
    const id = String(row['ID Siswa'] || row['id siswa'] || row['User Serial'] || '').trim();
    if (id) branchMap[id] = { branchId: String(row['ID Cabang'] || row['id cabang'] || '').trim(), branch: String(row['Nama Cabang'] || row['nama cabang'] || '').trim() };
  });
  return values.slice(1).filter(row => row.some(value => value !== '')).map(row => {
    const id = String(value_(row, map, 'User Serial', 'ID Siswa', 'id') || '').trim(); const branch = branchMap[id] || {};
    return { id, name: String(value_(row, map, 'Nama Siswa', 'name') || '').trim(), parentPhone: String(value_(row, map, 'No Ortu', 'Nomor WhatsApp', 'parentPhone') || '').trim(), grade: String(value_(row, map, 'Grade', 'grade') || '').trim(), className: String(value_(row, map, 'Kelas', 'className') || '').trim(), branchId: branch.branchId || String(value_(row, map, 'ID Cabang', 'branchId') || '').trim(), branch: branch.branch || String(value_(row, map, 'Cabang', 'branch') || '').trim() };
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
  const map = headerMap_(source); return values.slice(1).filter(row => row.some(value => value !== '')).map(row => ({ id: String(value_(row, map, 'ID Cabang', 'id') || '').trim(), name: String(value_(row, map, 'Nama Cabang', 'name') || '').trim(), status: String(value_(row, map, 'Status', 'status') || 'Aktif').trim() })).filter(branch => branch.id);
}

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
function binding_(studentId) { return bindingRows_().find(row => String(row['ID Siswa']) === String(studentId)); }
function publicBindings_() { const result = {}; bindingRows_().forEach(row => { if (row['ID Siswa']) result[row['ID Siswa']] = { studentId: row['ID Siswa'], studentName: row['Nama Siswa'], status: row['Status'], boundAt: iso_(row['Tanggal Bind']), resetAt: iso_(row['Tanggal Reset']), updatedAt: iso_(row['Updated At']) }; }); return result; }
function tokenInUse_(token, exceptId) { return bindingRows_().some(row => String(row['ID Siswa']) !== String(exceptId) && row['Status'] === 'TERDAFTAR' && String(row['Device Token']) === String(token)); }
function writeRow_(sheet, rowNumber, values) { sheet.getRange(rowNumber, 1, 1, values.length).setValues([values]); }
function bindingCheck_(payload) { const binding = binding_(payload.studentId); if (tokenInUse_(payload.deviceToken, payload.studentId)) return json_({ status: 'DEVICE_DIPAKAI', message: 'Perangkat ini sudah terdaftar untuk akun siswa lain.' }, null, 409); if (!binding) return json_({ status: 'BELUM_TERDAFTAR' }); if (binding.Status === 'DI-RESET') return json_({ status: 'DI-RESET' }); if (!payload.deviceToken) return json_({ status: 'DEVICE_TIDAK_DIkenal', message: 'Perangkat tidak dikenali.' }, null, 409); if (String(binding['Device Token']) !== String(payload.deviceToken)) return json_({ status: 'DEVICE_LAIN', message: 'Akun ini sudah terdaftar pada perangkat lain.' }, null, 409); return json_({ status: 'TERDAFTAR' }); }
function bindingBind_(payload) { if (!payload.studentId || !payload.deviceToken) return json_({ message: 'studentId dan deviceToken wajib diisi.' }, null, 400); if (tokenInUse_(payload.deviceToken, payload.studentId)) return json_({ message: 'Perangkat ini sudah terdaftar untuk akun siswa lain.' }, null, 409); const sheet = sheet_(SHEETS.bindings); const current = binding_(payload.studentId); if (current && current.Status === 'TERDAFTAR' && String(current['Device Token']) !== String(payload.deviceToken)) return json_({ message: 'Akun ini sudah terdaftar pada perangkat lain.' }, null, 409); const now = new Date(); const row = [payload.studentId, payload.studentName || current?.['Nama Siswa'] || '', payload.deviceToken, 'TERDAFTAR', current?.['Tanggal Bind'] || now, '', now]; if (current) writeRow_(sheet, bindingRows_().indexOf(current) + 2, row); else sheet.appendRow(row); return json_({ status: 'TERDAFTAR' }); }

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
function bindingReset_(e, payload) { const role = session_(e); if (role !== 'teacher' && role !== 'admin') return json_({ message: 'Hanya Student Mentor yang dapat melakukan Reset Device.' }, null, 403); const current = binding_(payload.studentId); if (!current) return json_({ message: 'Binding siswa tidak ditemukan.' }, null, 404); const now = new Date(); const bindingSheet = sheet_(SHEETS.bindings); writeRow_(bindingSheet, bindingRows_().indexOf(current) + 2, [current['ID Siswa'], current['Nama Siswa'], '', 'DI-RESET', current['Tanggal Bind'], now, now]); sheet_(SHEETS.resetLog).appendRow(['RESET-' + Date.now(), current['ID Siswa'], current['Nama Siswa'], now, 'Student Mentor', payload.reason || 'Reset Device', 'DI-RESET', current['Device Token']]); return json_({ status: 'DI-RESET' }); }

function attendance_(payload) { const sheet = sheet_(SHEETS.attendance); const data = rows_(sheet); const index = data.findIndex(row => String(row['Tanggal']) === String(payload.date) && String(row['ID Siswa']) === String(payload.studentId)); const values = [payload.date || dateKey_(), payload.studentId || '', payload.name || '', payload.className || '', payload.branchId || '', payload.branch || '', payload.checkIn || '', payload.checkOut || '', payload.status || 'Belum Pulang']; if (index >= 0) writeRow_(sheet, index + 2, values); else sheet.appendRow(values); return json_({ ok: true }); }
function waStatus_(payload) { const sheet = sheet_(SHEETS.wa); const type = payload.messageType === 'departure' ? 'departure' : 'arrival'; const lastColumn = sheet.getLastColumn(); const headers = headerMap_(sheet); if (headers['jenis wa'] === undefined) sheet.getRange(1, lastColumn + 1).setValue('Jenis WA'); const data = rows_(sheet); const index = data.findIndex(row => String(row['Tanggal']) === String(payload.date) && String(row['ID Siswa']) === String(payload.studentId) && String(row['Jenis WA'] || 'arrival') === type); const values = [payload.date || dateKey_(), payload.studentId || '', payload.status || 'processed', payload.processedAt || '', payload.deliveredAt || '', type]; if (index >= 0) writeRow_(sheet, index + 2, values); else sheet.appendRow(values); return json_({ ok: true }); }
