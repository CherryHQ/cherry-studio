# Bu fork hakkında (her oturum başında oku)

Kişisel fork. Yukarı akışa PR açılmıyor. Amaç: elde birden çok ücretsiz/limitli API anahtarıyla
çalışan tek bir AI orkestratörü.

## Önce buraya bak, kodu baştan keşfetme

| Dosya | İçerik |
|---|---|
| `GOREVLER.md` | İlerleme listesi. **İşaretlenmemiş ilk maddeden devam et.** |
| `SISTEM-MIMARISI.md` | Eklenen yönlendirme/sağlık/kota katmanının teknik anlatımı |
| `C:\Users\ag\.claude\plans\keen-hugging-glacier.md` | Tam plan: fazlar, mimari kararlar, doğrulama |

Cherry Studio'nun kendi yetenekleri geniş: MCP dosya araçları, görsel üretimi, bilgi bankası + RAG,
web arama, ajan sistemi, token muhasebesi (`AiUsageRecordService`) **zaten var**. Bir özellik
eksik görünüyorsa önce "kapalı mı?" diye bak — çoğu kez yazılmamış değil, açılmamış.

## Hazır beceriler (skill) — tekrar yazma

- **`cherry-electron-dev`** — uygulamayı takipli bir Electron örneğinde çalıştırır, DevTools'a
  bağlanır, gecikme/bellek/açılış profili çıkarır. **"Uygulamada şu çalışmıyor" denince bunu kullan**,
  tahmin yürütme veya kör kod okuma yapma.
- `vercel-react-best-practices` — renderer tarafı React işleri için.
- `gh-create-pr`, `gh-create-issue`, `gh-pr-review`, `prepare-release`, `cherry-pr-test` — bu forkta
  gerekmiyor (yukarı akışa PR açılmıyor).

Genel beceriler: `/code-review` (değişikliği hata için tara), `/simplify` (sadeleştir).

## Dil

Kullanıcı Türkçe yazıyor, cevaplar Türkçe. **Kod, yorum ve commit mesajları İngilizce** (üst proje
İngilizce). Arayüz metinleri i18next üzerinden — `en-us.json` kaynak, sonra `pnpm i18n:sync`.

## Bu makineye özel gerçekler (yeniden keşfetme)

- **pnpm PATH'te değil.** PowerShell'de önce: `$env:PATH += ";C:\Users\ag\AppData\Roaming\npm"`
- **Bash aracı Windows yollarını bozuyor** (`C:\Users\...` → `C:Users...`). Yol içeren komutlar için
  PowerShell kullan; Bash'i heredoc gerektiren `git commit` için kullan.
- **`better-sqlite3` Electron için derli.** Gerçek veritabanı açan testler düz Node'da
  `NODE_MODULE_VERSION` hatası verir — **beklenen durum, kod hatası değil**. Node'a geri derlemek
  uygulamayı bozar; ikisi aynı anda mümkün değil.
- **Commit'ler imzasız.** Makinede GPG/SSH anahtarı yok; `git commit --signoff` kullan, `-S` değil.
  (Üst `CLAUDE.md` imza şart koşuyor — o kural yukarı akış PR'ları için, burada geçerli değil.)
- **Pre-commit hook dosyaları biçimlendirir** ve hazırlanmamış değişikliklerle çakışıp commit'i
  düşürebilir. Takılırsa: `./node_modules/.bin/oxfmt --write .` çalıştır, `git add -u`, tekrar dene.
- **Derleme:** `./node_modules/.bin/electron-vite build` sonra
  `./node_modules/.bin/electron-builder --win --x64 --dir --config.npmRebuild=false`
  → `dist/win-unpacked/Cherry Studio.exe`. NSIS kurulum paketi `node-pty` yüzünden üretilemiyor.

## Çalışma kuralları

- **Her görev tek modüle dokunur.** Mevcut kodu toptan okuma.
- **Görev bitince** `GOREVLER.md`'de `[ ]` → `[x]` ve **tek satır** not. Fazlar arası rapor üretme.
- **Doğrulama dar tut:** değişen alanın testi (`./node_modules/.bin/vitest run <yol>`) + gerekiyorsa
  `pnpm run typecheck:node` / `typecheck:web`. Tüm paneli gezme, `pnpm test`'i tek dosya için çalıştırma.
- **Basit ve yalıtılmış işleri alt ajana ver:** i18n çevirisi, tekrarlayan sağlayıcı adaptörleri,
  mekanik test yazımı.
- **Sorma, yap.** Kullanıcı hızlı sonuç istiyor. Sadece geri alınamaz veya gerçekten onun kararı
  olan şeylerde dur.

## Bozulmaması gereken tasarım kuralları

1. **Elle model seçimi her zaman kazanır.** Yönlendirme yalnızca *varsayılanı* değiştirir.
2. **Hiçbir istek reddedilmez.** Sağlık başarısız, kota dolu veya sorgu patladıysa yine dene —
   sağlayıcı iyileşmiş olabilir.
3. **Yönlendirme optimizasyondur, engel değil.** Bozuk yapılandırma mesajı durdurmaz.
4. **Sağlık sonucu eleme yapmaz, sıralamayı değiştirir.** Tek istisna: sohbet turunu *hiç*
   cevaplayamayan model (embedding, rerank, salt-görsel) kategoriden çıkarılır.
5. **Üretilen dosyalar elle düzenlenmez** (`preferenceSchemas.ts`, `bootConfigSchemas.ts`,
   `*Mappings.ts`) — `target-key-definitions.json` düzenle, `cd scripts/data-classify && node scripts/generate-all.js`.
6. **Yayınlanmış migrasyon asla değiştirilmez** — şema değişikliği yeni eklemeli migrasyon.
