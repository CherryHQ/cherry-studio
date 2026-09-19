# Bu fork hakkında (her oturum başında oku)

Kişisel fork. Yukarı akışa PR açılmıyor. Amaç: elde birden çok ücretsiz/limitli API anahtarıyla
çalışan tek bir AI orkestratörü.

## Önce buraya bak, kodu baştan keşfetme

| Dosya | İçerik |
|---|---|
| `GOREVLER-2.md` | **Güncel iş listesi.** Faz B–Z. Durum tablosu en üstte |
| `GOREVLER.md` | Eski liste (Faz 0–7), tamamlandı |
| `SISTEM-MIMARISI.md` | Eklenen yönlendirme/sağlık/kota katmanının teknik anlatımı |
| `C:\Users\ag\.claude\plans\keen-hugging-glacier.md` | Eski plan, tarihsel |

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
- **Dosyaları UTF-8 yaz — PowerShell'de asla `Set-Content`/`Out-File` varsayılanıyla değil.**
  `Set-Content` sistem ANSI kod sayfasını kullanır; `-Encoding utf8` şart. En güvenlisi `Write`
  aracı veya `fs.writeFileSync(path, text, 'utf8')`.
  **Bu kural bedelini ödetti:** `7acf1c5` (2026-09-17) 13 dile 4 anahtar eklerken 8 dil dosyasını
  cp1252 ile yeniden yazdı ve **30.412 mevcut çeviriyi bozdu** (`添加智能体失败` → `æ·»åŠ æ™ºèƒ½ä½"å¤±è´¥`).
  İki gün kimse fark etmedi; `pnpm i18n:check` bunu **yakalamıyor**. Locale dosyasına dokunan her
  iş bittikten sonra bozuk kodlama taraması yap — sıralama ve placeholder kontrolü yetmez.
- **Derleme:** `./node_modules/.bin/electron-vite build` sonra
  `./node_modules/.bin/electron-builder --win --x64 --dir --config.npmRebuild=false`
  → `dist/win-unpacked/Cherry Studio.exe`. NSIS kurulum paketi `node-pty` yüzünden üretilemiyor.

## Çalışma kuralları

- **Her görev tek modüle dokunur.** Mevcut kodu toptan okuma.
- **Görev bitince** `GOREVLER-2.md`'deki durum tablosuna tek satır not. Fazlar arası rapor üretme.
- **Sorma, yap.** Kullanıcı hızlı sonuç istiyor. Sadece geri alınamaz veya gerçekten onun kararı
  olan şeylerde dur.

### "Eksik görevleri yap" denince ne yapılacak

Kullanıcı geniş bir cümle kurabilir: *"eksik görevleri yerine getir"*, *"devam et"*, *"kalanları bitir"*.
Bu **"hepsini birden yap"** demek değildir — `GOREVLER-2.md`'de 150'den fazla alt madde var ve
hepsine birden girişmek tam olarak bu projeyi bozan şeydir.

Böyle bir cümle şu anlama gelir:

1. `GOREVLER-2.md`'nin en üstündeki **durum tablosunu** oku, neyin bittiğini gör.
2. **Sıra ve bağımlılıklar** bölümündeki dizilimden **sıradaki tek maddeyi** al.
3. Onu bitir, doğrula (aşağıdaki "bitti" ölçütü — **uygulamayı açmak dahil**), commit'le,
   tabloya tek satır yaz.
4. **Sonra dur ve ne yaptığını söyle.** Kullanıcı devam derse bir sonrakine geç.

Kullanıcıdan ayrıca istemesini bekleme: "devam et" cümlesi 3. adımdaki uygulama kontrolünü
**içerir**. Arayüze dokunan bir maddeyi ekranda görmeden commit'leme.

Madde "güçlü model gerekir" kutusundaysa ve sen Haiku'ysan: başlama, söyle ve dur.

### Otonom döngü — komut beklemeden ilerleme

Kullanıcının açık isteği (2026-09-19): *"ben açık bırakayım benden komut bekleme, görevler belli
isteklerim belli, aşama aşama kendin otomatik ilerle, eksiksiz olsun, bişey bitmeden diğerine
geçilmesin."* Yani 4. adımdaki "dur ve bekle" **kalkar**; rapor verip bir sonraki maddeye geçilir.

Her turda sırayla:

1. Sıradaki **tek** maddeyi al (yukarıdaki 1–2. adım).
2. Bitir. **Yarım bırakma, paralel ikinci maddeye başlama.** Bir madde bitmeden commit yok,
   commit olmadan sonraki madde yok.
3. Doğrula ("bitti" ölçütü) → commit → `GOREVLER-2.md` tablosuna tek satır.
4. Tek paragraf rapor + `ScheduleWakeup` ile bir sonraki turu planla.

**Nerede durulur** (bunlar için gerçekten bekle):
- Geri alınamaz veya dışarı çıkan bir şey: uzak depoya push, yayın, dış servise veri gönderme.
- Kullanıcının kararı olan tasarım tercihi (iki makul yol var ve seçim onun zevkine bağlı).
- Üst üste iki turda aynı madde bitmediyse: dur, neyin tıkadığını söyle.
- Çalışan API anahtarı gerektiren bir doğrulama: yapabildiğini yap, **yapamadığını açıkça yaz**,
  maddeyi "kod bitti, canlı doğrulanmadı" diye işaretle ve devam et.

**Bağlam/maliyet kontrolü** — döngü uzun sürecek, şunlara dikkat:
- Tur başına **tek madde**. Bağlam şişerse özetlenir; erken toparlama derdine düşme.
- Mekanik işi (çeviri, katalog verisi, tercih anahtarı, arama) **alt ajana** ver.
- Büyük dosyayı baştan sona okuma; `Grep` ile ilgili satırı bul.
- **`pnpm run test:renderer` tüm paketi bu makinede 10 dakikadan uzun sürüyor.** Her madde için
  çalıştırma. Değişen dosyanın testi + o klasörün testleri + `typecheck:node`/`typecheck:web` yeter;
  tüm paketi yalnızca renderer geneline dokunan bir değişiklikten sonra çalıştır.

### Bir görev ne zaman "bitti" sayılır

Tip kontrolünün ve kendi yazdığın testin geçmesi **yetmez**. Bir oturumda öyle sayıldı ve beş kusur
geçti: her model seçicisini düşüren bir çökme, hiç çalışmayan yedekleme, yazıcısı olmayan bir
özellik, aynı veriye iki farklı kural uygulayan iki kod yolu, ve üretimde imkânsız bir veri
biçimini sınayan yeşil test.

Bitti demeden önce dördünü de yap:

1. **Yazıcı + okuyucu + ekran.** Özelliği *yazan* kod, *okuyan* kod ve kullanıcının onu yaptığı
   *ekran* — üçü de var mı? Biri eksikse özellik bitmemiştir, cephedir. Yeni bir alan eklediysen:
   onu API şeması kabul ediyor mu, servis yazıyor mu, arayüzde girilebiliyor mu?
2. **Değiştirdiğin dosyanın testini çalıştır**, sadece yeni yazdığını değil. `X.ts`'i
   değiştirdiysen `__tests__/X.test.ts` kırmızıysa görev bitmemiştir.
3. **Paket testini çalıştır:** `pnpm run test:renderer` ve `pnpm run test:shared`. Dar doğrulama
   19 kırmızı testin fark edilmemesine yol açtı.
4. **Uygulamayı aç ve gör.** Madde arayüze veya ana süreç servis kaydına dokunuyorsa
   uygulamayı çalıştır ve şu üçünü doğrula:
   - Uygulama **açılıyor** (açılış logunda `Bootstrap complete`, servis hata satırı yok).
   - Eklediğin şey **ekranda görünüyor** — düğme, satır, sütun, neyse.
   - Bir kez **çalıştırıp** sonucu gör.

   **Uygulamayı kullanıcıya açtırma — kendin aç.** Açık isteği: *"değişiklik her olduğunda
   kontrol edeceğim, programı direk açacak şekilde olsun, bana soruyorsun programı açıp
   bakamıyorum ki."* Yani her arayüz değişikliğinden sonra sırayla sen yap:

   ```powershell
   Get-Process -Name electron -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
   $deadline=(Get-Date).AddSeconds(30)
   while ((Get-Process -Name electron -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }
   ./node_modules/.bin/electron-vite build
   Start-Process ".\node_modules\electron\dist\electron.exe" -ArgumentList "."
   ```

   **Çıkışı gerçekten bekle, sabit `Start-Sleep` koyma.** Sabit 1.2 sn ile denendi ve
   2026-09-19 03:49'da patladı: önceki süreç SQLite kilidini bırakmadan yenisi açıldı,
   `Failed to configure WAL mode disk I/O error` → `V2MigrationGate: Migration status check
   failed`. Uygulama hiç açılmadı. (Veri bozulmadı — göç kapısı yazmadan önce düştü — ama
   bir sonraki sefer o kadar şanslı olmayabilir.) Açılıştan sonra logda `Bootstrap complete`
   **ve** `level: error` satırı olup olmadığına bak; sadece `Bootstrap complete` aramak bu
   hatayı kaçırır çünkü o satır hiç yazılmaz.

   Sonra `$env:APPDATA\CherryStudioDev\logs\app.<tarih>.log` içinden `Bootstrap complete`
   ve servis hatalarını oku. Kullanıcıya "şunu aç ve bak" deme; pencere önünde açık olur,
   sadece *ne göreceğini* söyle. Ekran görüntüsü ancak kendi göremeyeceğin bir şeyse iste.

   `pnpm dev` **kullanma** — Vite optimizer yarışı yüzünden açılışta takılıyor, derlenmiş
   sürüm takılmıyor. Kullanıcının masaüstünde `Cherry Studio (dev).cmd` kısayolu da var
   (aynı komut); `electron.exe`'yi çift tıklamak Electron karşılama ekranını açar, uygulamayı değil.

   Testler "buton görünmüyor", "düzen bozuldu", "açılışta çöküyor" gibi şeyleri yakalamaz.
   Bu oturumda sekiz commit tek kez bile ekranda görülmeden yazıldı — bir daha olmayacak.

   > **Not:** `cherry-electron-dev` becerisi bu depoda kayıtlı ama oturumda **kurulu değil**
   > (denendi, `Unknown skill`). Üstteki "Hazır beceriler" listesine güvenip onu çağırma.

5. **Neyi doğrulamadığını söyle.** Uygulamayı açamadıysan "çalışıyor" deme,
   "derleniyor ve testleri geçiyor ama ekranda görmedim" de.

### Bilinen kırmızılar — bunlar senin değil, düzeltmeye çalışma

Üçü de `2ad61dc` commit'inde, tertemiz çalışma ağacında da kırmızı (denendi, doğrulandı):

- `pnpm i18n:check` → 35 hata, `el-gr` ve `ru-ru`'da "şüpheli uzunlukta" uyarısı.
- `TopicNamingService.test.ts` → 7 hata, Latin olmayan dillerde oturum adı tanınmıyor.
- `AgentContextUsageSummary.test.tsx` → 3 hata.
- `MessageMetaTool.test.tsx` → 5 hata, hepsi yerelleştirme iddiası (`输出` gibi Çince metin
  bekliyor, İngilizce geliyor). 2026-09-19'da stash'lenmiş temiz ağaçta doğrulandı.

Ayrıca gerçek veritabanı açan testler bu makinede `NODE_MODULE_VERSION` ile düşer — beklenen.

### Çıktı kısa olacak

Kullanıcının açık isteği: *"çıktılar da az olsun, bana yapıldıktan sonra şunu yaptım demesi yeterli."*

- Bir görev bitince **tek cümle**: ne değişti. Dosya listesi, kod bloğu, madde madde özet yok.
- Ne yapacağını anlatma, yap ve sonucu söyle.
- İstenmedikçe rapor/özet dosyası üretme.
- **İstisna:** bir şey bozuksa, bir varsayım yanlış çıktıysa veya kullanıcının bilmesi gereken bir
  ödünleşim varsa — onu söyle. Kısalık, kötü haberi gizlemek için değil.

### İş hangi modele gider

Kurulu Haiku alt ajanları — mekanik iş bunlara gider, ana bağlamı kirletmez:

| Ajan | Ne zaman |
|---|---|
| `i18n-translator` | `pnpm i18n:sync` `[to be translated]:` bıraktığında |
| `preference-key-adder` | Yeni `usePreference` anahtarı gerektiğinde (üretilen dosya tuzağını bilir) |
| `catalog-data-writer` | Sağlayıcı ön ayarı, model denklik haritası, site adaptörü gibi toplu veri |
| `cherry-builder` | **Sonnet.** `GOREVLER-2.md`'deki bir maddeyi baştan commit'e kadar götürür. Yalnız "küçük modelle güvenli" listesindekiler için |
| `Explore` (yerleşik) | "Bu nerede tanımlı" aramaları |

Ana oturum: tasarım kararı, mimari, hata ayıklama, yeni özellik.
**Mekanik bir iş 3+ dosyaya yayılıyorsa ve karar gerektirmiyorsa alt ajana ver.**

### Token bütçesi — varsayılan olarak `cherry-builder`'a ver

Kullanıcı **Pro** planda ve haftalık bütçe gerçek bir sınır (2026-09-19'da bir gecede %36
harcanmıştı). Ana oturum pahalı modelde çalışıyor; iş orada yapılırsa bütçe erken biter.

Kural: `GOREVLER-2.md`'de **"küçük modelle güvenli"** listesindeki bir maddeye ana oturumda
başlama — `cherry-builder`'a (Sonnet) ver, sonucunu oku, gerekirse düzelt. Ana oturum yalnızca
"başlama, söyle ve dur" listesindeki maddeleri kendi yapar.

**Kendi modelini/eforunu değiştiremezsin** — araç bunu tasarım gereği reddediyor. Bütçe sıkışıksa
kullanıcıya söyle: model seçicisinden daha ucuz bir model, ve **Max → high** efor. Max en pahalı
ayar ve rutin iş için gereksiz.
Yeni ajan gerekirse `.claude/agents/<isim>.md` aç, `model: haiku` yaz; `i18n-translator.md` örnek.

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
