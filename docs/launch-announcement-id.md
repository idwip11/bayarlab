# Draf pengumuman peluncuran (Bahasa Indonesia)

Status: **draf**. Isi versi, tautan repository, dan perintah instalasi baru boleh diumumkan setelah paket benar-benar terbit serta kandidat lolos gate audit dan CI. Jangan mengirim draf ini ke komunitas sebelum maintainer meninjau klaim dan tautannya.

## X / Threads

BayarLab 0.1.0 adalah simulator webhook pembayaran yang berjalan lokal. Kirim event sintetis Midtrans, Xendit, dan DOKU ke receiver sendiri; uji duplikasi, respons gagal, dan verifikasi signature tanpa membuat transaksi atau memakai kredensial live.

Rilis ini hanya mencakup profil provider yang terdokumentasi—bukan semua metode pembayaran atau sertifikasi provider. Node.js 22.13+.

Mulai: https://github.com/idwip11/bayarlab · Install setelah rilis: `npm install -g bayarlab@0.1.0`

## Komunitas developer Indonesia

Halo! Saya sedang menyiapkan BayarLab 0.1.0, simulator lokal untuk membantu menguji endpoint webhook pembayaran dengan event sintetis. Perintah CLI dapat mengirim event ke receiver lokal, mengulang payload untuk menguji idempotensi, dan mengirim signature yang sengaja invalid untuk menguji penolakan. Tersedia juga dashboard loopback dan runner skenario YAML untuk CI.

Profil yang saat ini disertakan: Midtrans Classic BNI VA dan beberapa notifikasi kartu; Xendit Payments API v3 DANA; serta DOKU Direct API non-SNAP Mandiri VA. Fixture failure yang disusun manual ditandai sebagai komposisi, bukan callback sandbox asli. Tidak ada pembayaran yang dibuat atau gateway provider yang dihubungi.

Repository/dokumentasi: https://github.com/idwip11/bayarlab

Perintah instalasi saat paket terbit: `npm install -g bayarlab@0.1.0` (Node.js 22.13+).

Masukan yang paling saya cari: kejelasan payload untuk receiver lokal, alur replay/idempotensi, dan kemudahan menjalankan skenario YAML di CI. Mohon jangan kirim kredensial merchant atau payload pelanggan.
