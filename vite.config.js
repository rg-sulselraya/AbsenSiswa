import { defineConfig } from 'vite';

export default defineConfig({
  // Relative assets work both on localhost and on the project Pages path
  // (/AbsenSiswa/), avoiding absolute-root asset 404s.
  base: './',
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },
});
