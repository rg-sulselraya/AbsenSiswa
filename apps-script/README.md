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
