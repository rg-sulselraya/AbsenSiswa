# Aplikasi Presensi Siswa

MVP responsif untuk scan presensi dan dashboard wali kelas. Saat ini UI berjalan tanpa credential Google Sheets di browser: data presensi disimpan lokal sebagai fallback, sedangkan integrasi produksi diarahkan ke backend melalui `VITE_ATTENDANCE_API_URL`.

## Menjalankan

```bash
npm install
npm run dev
```

Build produksi: `npm run build`.

## Integrasi Google Sheets

Buat backend (atau serverless functions) yang membaca spreadsheet `17xq9XNJchMRE57MMNSYok_jr9uXjZAGKXpzoI1kYroE` menggunakan service account dari environment variable. Credential tidak boleh masuk ke `app.js` atau bundle frontend.

Flow frontend: login akun siswa → scan QR cabang (`CABANG-001`) → validasi cabang siswa → scan pertama mengisi Jam Datang → scan kedua mengisi Jam Pulang pada record yang sama. Wali Kelas hanya membuka dashboard; tidak ada scanner di dashboard.

Frontend mengharapkan endpoint berikut:

- `GET /students` → `{ "students": [{ "id", "name", "className", "branch", "grade", "parentPhone" }] }`
- `GET /branches` → `{ "branches": [{ "id", "name", "status" }] }`
- `POST /attendance` → menerima `{ date, studentId, name, className, branchId, branch, checkIn, checkOut, status }`
- `POST /wa-status` → menerima `{ date, studentId, status, processedAt?, deliveredAt? }`
- `GET /device-bindings` → data status binding tanpa mengembalikan token ke UI.
- `POST /device-binding/check` → validasi `studentId` + `deviceToken` terhadap binding server.
- `POST /device-binding/bind` → membuat binding pertama setelah konfirmasi siswa.
- `POST /device-binding/reset` → hanya Admin; meng-invalidate binding dan menulis audit log.

Reference backend minimal tersedia di [server.mjs](/Users/fa-13744/Documents/ChatGPT/Scan%20Barcode/server.mjs), dengan penyimpanan lokal `.data` untuk development. Jalankan `npm run server` dan gunakan `VITE_ATTENDANCE_API_URL=/api`; Vite mem-proxy `/api` ke port 8787. Untuk produksi, ganti adapter file tersebut dengan Google Sheets/database existing dan tetap pertahankan validasi server-side.
Jika `PRESENSI_ADMIN_TOKEN` diisi pada backend reference, endpoint reset juga menolak request tanpa header Admin. Pada produksi, gunakan session/role Admin yang sudah ada, bukan token frontend.
Login Wali Kelas/Admin sengaja tidak memiliki fallback frontend. Tanpa endpoint backend yang dikonfigurasi, pemilihan tab staf akan ditolak agar siswa tidak bisa menaikkan role dari browser.

Spreadsheet yang diberikan telah dicek read-only. Sheet `Database Siswa` memiliki header `User Serial`, `Nama Siswa`, `No Ortu`, `Nama Sekolah`, `Grade`, dan `Kelas`. Mapping backend: `User Serial → id`, `Nama Siswa → name`, `No Ortu → parentPhone`, `Grade → grade`, `Kelas → className`. Karena sheet existing belum memuat ID cabang, backend perlu menambahkan mapping akses (atau sheet master cabang) tanpa mengubah data siswa. Jangan mengubah sheet siswa existing. Jika diperlukan, gunakan sheet tambahan `Presensi` dengan kolom `Tanggal, ID Siswa, Nama Siswa, Kelas, ID Cabang, Cabang, Jam Datang, Jam Pulang, Status`, `Database Cabang` dengan kolom `ID Cabang, Nama Cabang, Status`, dan sheet `StatusWA` dengan kolom `Tanggal, ID Siswa, Status WA, Waktu Diproses, Waktu Terkirim`.

Untuk Google Sheets produksi, tambahkan sheet non-destruktif `Device Binding` (`ID Siswa, Nama Siswa, Device Token, Status, Tanggal Bind, Tanggal Reset, Updated At`) dan `Device Reset Log` (`ID, ID Siswa, Nama Siswa, Waktu Reset, Admin, Alasan, Status`). Token tidak pernah dikirim kembali ke browser admin sebagai nilai mentah.

Mode fallback memakai data preview lokal hanya agar alur UI dapat diuji sebelum endpoint tersedia. Ganti/disable `FALLBACK_STUDENTS` setelah backend Google Sheets aktif.

## Alur yang sudah dicakup

- Scan pertama → Jam Datang; scan kedua → Jam Pulang; scan ketiga ditolak.
- Device binding: satu akun siswa ↔ satu perangkat; binding pertama memerlukan konfirmasi, perangkat lain ditolak, dan reset hanya tersedia untuk Admin.
- ID tidak dikenal tidak membuat presensi.
- Dashboard dengan kartu ringkasan, pencarian, filter kelas/kehadiran/status WA, dan ekspor CSV.
- Send WA membuat link `wa.me` dari nomor orang tua, menyimpan `Sudah Diproses`, dan tidak mengklaim pesan benar-benar terkirim.
- Klik status `Sudah Diproses` → konfirmasi satu klik → `Sudah Terkirim`.
