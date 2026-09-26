# Backend Google Apps Script

Folder ini berisi backend yang membaca dan menulis Google Sheets tanpa menyimpan credential di frontend.

## Setup singkat

1. Buka Google Sheet data siswa, lalu pilih **Extensions → Apps Script** (cara ini mengikat script ke spreadsheet yang benar).
2. Salin isi `Code.gs` ke editor Apps Script.
3. Jalankan fungsi `setupProperties()` sekali. Izinkan akses Sheets jika diminta.
4. Buka **Project Settings → Script properties**, lalu ganti:
   - `PRESENSI_STAFF_PASSWORD` dengan password Student Mentor.
   - `PRESENSI_ADMIN_PASSWORD` dengan password Admin.
   - `SPREADSHEET_ID` dengan ID Google Sheet sekolah jika berbeda.
5. Isi sheet `Database Cabang` yang dibuat oleh `setupProperties()`. Pemetaan cabang siswa dapat dilakukan melalui `Siswa Cabang`, atau dengan menambahkan kolom `Nama Cabang` pada `Database Siswa`; nama tersebut akan dicocokkan otomatis ke `Database Cabang` untuk mendapatkan ID cabang.
6. Pilih **Deploy → New deployment → Web app**.
   - Execute as: **Me**
   - Who has access: **Anyone**
7. Salin URL yang berakhiran `/exec`.

## Deploy otomatis dari GitHub Actions

Repository ini menyediakan workflow `.github/workflows/deploy-apps-script.yml`.
Workflow berjalan otomatis setiap push ke `main` yang mengubah folder `apps-script/`, atau dapat dijalankan manual dari tab **Actions**. Workflow melakukan `clasp push` lalu memperbarui deployment Web App yang sudah ada; workflow tidak mengubah isi Google Sheets.

Konfigurasi satu kali di GitHub repository:

1. Di Google Apps Script buka **Project Settings → IDs**, salin **Script ID**.
2. Pastikan deployment Web App yang dipakai aplikasi sudah ada. ID deployment adalah bagian setelah `/macros/s/` pada URL `/exec` yang sedang digunakan.
3. Di **Settings → Secrets and variables → Actions → Variables**, buat:
   - `CLASP_SCRIPT_ID` = Script ID dari Project Settings.
   - `CLASP_DEPLOYMENT_ID` = ID deployment Web App yang sudah ada.
4. Di **Settings → Secrets and variables → Actions → Secrets**, buat `CLASP_CREDENTIALS` berisi JSON kredensial OAuth clasp dari komputer yang memiliki akses edit ke project Apps Script. Buat kredensial dengan `clasp login`, lalu salin isi file `.clasprc.json`; jangan commit file tersebut.
5. Pastikan **Apps Script API** aktif pada akun Google yang memiliki project.

Setelah variabel dan secret tersedia, push ke `main` akan mengirim `Code.gs` dan `appsscript.json` ke project Apps Script serta memperbarui deployment yang sama, sehingga URL `/exec` aplikasi tetap digunakan. Jika salah satu konfigurasi belum ada, workflow berhenti dengan pesan konfigurasi yang jelas dan tidak menjalankan perubahan apa pun.

Sheet `Database Siswa` dibaca tanpa mengubah data. Sheet tambahan yang dibuat:
`Database Cabang`, `Siswa Cabang`, `Presensi`, `StatusWA`, `Device Binding`, dan `Device Reset Log`.

Sheet `StatusWA` menyimpan status pesan secara terpisah untuk `arrival` (jam datang) dan `departure` (jam pulang). Kolomnya: `Tanggal, ID Siswa, Status WA, Waktu Diproses, Waktu Terkirim, Jenis WA`.

### Password siswa

Endpoint `student/login` membaca kolom `Password` yang sudah ada pada `Database Siswa` berdasarkan `User Serial`, sehingga tidak perlu menambah kolom baru untuk mulai menggunakannya. Password hanya dibandingkan di Apps Script dan tidak pernah dikirim ke browser. Untuk keamanan yang lebih baik, gunakan `setupStudentPasswordColumns()` lalu `setStudentPassword('ID_SISWA', 'PasswordAwal')` agar akun beralih ke `Password Hash` + `Password Salt`; jika keduanya tersedia, hash selalu diprioritaskan. Jangan mencatat password di log.

## Menghubungkan ke GitHub Pages

Di repository GitHub, buka **Settings → Secrets and variables → Actions → Variables**, buat variable:

```text
VITE_ATTENDANCE_API_URL=https://script.google.com/macros/s/ID_DEPLOYMENT/exec
```

Push atau jalankan ulang workflow Pages. Jangan menaruh password di variable GitHub atau di kode frontend; password hanya berada di Script Properties.
