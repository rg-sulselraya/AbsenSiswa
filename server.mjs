import http from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import crypto from 'node:crypto';

const PORT = Number(process.env.PORT || process.env.PRESENSI_API_PORT || 8787);
const HOST = process.env.PRESENSI_API_HOST || '0.0.0.0';
const DATA_DIR = new URL('./.data/', import.meta.url);
const BINDINGS_FILE = new URL('./.data/device-bindings.json', import.meta.url);
const RESET_LOG_FILE = new URL('./.data/device-reset-log.json', import.meta.url);
// In production, replace this development adapter with the existing authenticated
// session middleware. If configured, the reset endpoint also requires this token.
const ADMIN_API_TOKEN = process.env.PRESENSI_ADMIN_TOKEN || '';
const STAFF_PASSWORD = process.env.PRESENSI_STAFF_PASSWORD || '';
const ADMIN_PASSWORD = process.env.PRESENSI_ADMIN_PASSWORD || '';
const staffSessions = new Map();

async function readJson(url, fallback) { try { return JSON.parse(await readFile(url, 'utf8')); } catch { return fallback; } }
async function writeJson(url, value) { await mkdir(DATA_DIR, { recursive: true }); await writeFile(url, JSON.stringify(value, null, 2)); }
async function body(request) { let raw = ''; for await (const chunk of request) raw += chunk; return raw ? JSON.parse(raw) : {}; }
function send(response, status, payload) { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' }); response.end(JSON.stringify(payload)); }
function publicBindings(bindings) { return Object.fromEntries(Object.entries(bindings).map(([id, binding]) => [id, { ...binding, deviceToken: undefined }])); }
function staffFromRequest(request) { const token = request.headers['x-staff-session']; return token ? staffSessions.get(token) : null; }

const server = http.createServer(async (request, response) => {
  if (request.method === 'OPTIONS') return send(response, 204, {});
  try {
    const bindings = await readJson(BINDINGS_FILE, {});
    const resetLog = await readJson(RESET_LOG_FILE, []);
    if (request.method === 'GET' && request.url === '/api/health') return send(response, 200, { ok: true, service: 'device-binding' });
    if (request.method === 'GET' && request.url === '/api/device-bindings') return send(response, 200, { bindings: publicBindings(bindings) });
    if (request.method === 'GET' && request.url === '/api/device-reset-log') return send(response, 200, { entries: resetLog });
    if (request.method === 'POST' && request.url === '/api/staff/login') {
      const { role, password } = await body(request);
      const validRole = role === 'teacher' || role === 'admin';
      const expected = role === 'admin' ? ADMIN_PASSWORD : STAFF_PASSWORD;
      if (!validRole || !expected) return send(response, 503, { message: 'Autentikasi staf belum dikonfigurasi di server.' });
      if (password !== expected) return send(response, 401, { message: 'Password staf tidak valid.' });
      const token = crypto.randomUUID(); staffSessions.set(token, { role, createdAt: Date.now() });
      return send(response, 200, { role, token });
    }
    if (request.method === 'POST' && request.url === '/api/staff/validate') {
      const staff = staffFromRequest(request); if (!staff) return send(response, 401, { message: 'Sesi staf tidak valid.' }); return send(response, 200, staff);
    }
    if (request.method === 'POST' && request.url === '/api/device-binding/check') {
      const { studentId, deviceToken } = await body(request);
      const other = Object.entries(bindings).find(([id, binding]) => id !== studentId && binding.status === 'TERDAFTAR' && binding.deviceToken === deviceToken);
      if (other) return send(response, 409, { status: 'DEVICE_DIPAKAI', message: 'Perangkat ini sudah terdaftar untuk akun siswa lain.' });
      const binding = bindings[studentId];
      if (!binding) return send(response, 200, { status: 'BELUM_TERDAFTAR' });
      if (binding.status === 'DI-RESET') {
        if (deviceToken && resetLog.some((entry) => entry.studentId === studentId && entry.deviceToken === deviceToken)) return send(response, 409, { status: 'DEVICE_DI_RESET', message: 'Perangkat lama sudah di-reset. Gunakan perangkat baru.' });
        return send(response, 200, { status: 'DI-RESET' });
      }
      if (!deviceToken) return send(response, 409, { status: 'DEVICE_TIDAK_DIkenal', message: 'Perangkat tidak dikenali. Silakan hubungi Admin untuk reset perangkat.' });
      if (binding.deviceToken !== deviceToken) return send(response, 409, { status: 'DEVICE_LAIN', message: 'Akun ini sudah terdaftar pada perangkat lain. Silakan hubungi Admin untuk melakukan reset perangkat.' });
      return send(response, 200, { status: 'TERDAFTAR' });
    }
    if (request.method === 'POST' && request.url === '/api/device-binding/bind') {
      const { studentId, deviceToken, studentName } = await body(request);
      if (!studentId || !deviceToken) return send(response, 400, { message: 'studentId dan deviceToken wajib diisi.' });
      const other = Object.entries(bindings).find(([id, binding]) => id !== studentId && binding.status === 'TERDAFTAR' && binding.deviceToken === deviceToken);
      if (other) return send(response, 409, { message: 'Perangkat ini sudah terdaftar untuk akun siswa lain.' });
      const existing = bindings[studentId];
      if (existing?.status === 'TERDAFTAR' && existing.deviceToken !== deviceToken) return send(response, 409, { message: 'Akun ini sudah terdaftar pada perangkat lain.' });
      const timestamp = new Date().toISOString();
      bindings[studentId] = { studentId, studentName: studentName || existing?.studentName || '', deviceToken, status: 'TERDAFTAR', boundAt: existing?.boundAt || timestamp, resetAt: null, updatedAt: timestamp };
      await writeJson(BINDINGS_FILE, bindings);
      return send(response, 200, { status: 'TERDAFTAR' });
    }
    if (request.method === 'POST' && request.url === '/api/device-binding/reset') {
      const staff = staffFromRequest(request); if (staff?.role !== 'admin' || (ADMIN_API_TOKEN && request.headers['x-admin-token'] !== ADMIN_API_TOKEN)) return send(response, 403, { message: 'Hanya Admin yang dapat melakukan Reset Device.' });
      const { studentId, admin = 'Admin', reason = 'Reset Device' } = await body(request);
      const existing = bindings[studentId];
      if (!existing) return send(response, 404, { message: 'Binding siswa tidak ditemukan.' });
      const resetAt = new Date().toISOString();
      resetLog.push({ id: `RESET-${Date.now()}`, studentId, studentName: existing.studentName, deviceToken: existing.deviceToken, resetAt, admin, reason, status: 'DI-RESET' });
      bindings[studentId] = { ...existing, deviceToken: null, status: 'DI-RESET', resetAt, updatedAt: resetAt };
      await writeJson(BINDINGS_FILE, bindings); await writeJson(RESET_LOG_FILE, resetLog);
      return send(response, 200, { status: 'DI-RESET' });
    }
    return send(response, 404, { message: 'Endpoint tidak ditemukan.' });
  } catch (error) { return send(response, 500, { message: 'Kesalahan server.', detail: error.message }); }
});

server.listen(PORT, HOST, () => console.log(`Device binding API listening on ${HOST}:${PORT}`));
