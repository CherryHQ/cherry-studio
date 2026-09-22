# GÖREVLER-2 — Orkestratör tamamlama planı

> Uygulama planı. `GOREVLER.md` (Faz 0–7) bitti. Faz A bitti. **Faz B'den itibaren yapılacak.**

## Bu planı uygulayacak modele — önce burayı oku

Bu plan büyük. **Hepsini birden yapmaya kalkma.** Çalışma şekli:

1. **Tek seferde tek madde.** Bir fazın bir alt maddesini al (ör. sadece B1), bitir, doğrula,
   `GOREVLER-2.md`'de `[x]` işaretle, sonra diğerine geç.
2. **Başlamadan önce "zaten var mı?" diye bak.** Bu depoda çok şey yazılmış ama açılmamış.
   Her maddede hangi dosyanın zaten var olduğunu yazdım — önce onu oku.
3. **Doğrulama dar olsun.** Değişen alanın testi + `pnpm run typecheck:node` / `typecheck:web`.
   `pnpm test`'i tek dosya için çalıştırma.
4. **Emin değilsen sor.** Varsayıp 40 dosya yazmak, sorup 1 dosya yazmaktan pahalı.

### Bu depoda seni yakacak tuzaklar

| Tuzak | Ne yapmalı |
|---|---|
| `pnpm` PATH'te yok | PowerShell'de önce: `$env:PATH += ";C:\Users\ag\AppData\Roaming\npm"` |
| Bash aracı Windows yollarını bozuyor | Yol içeren komutlar için PowerShell kullan |
| `preferenceSchemas.ts`, `bootConfigSchemas.ts`, `*Mappings.ts` **üretilen dosyalar** | Elle düzenleme. `scripts/data-classify/data/target-key-definitions.json` düzenle, sonra `cd scripts/data-classify && node scripts/generate-all.js` |
| `preferenceTypes.ts` üretilmiyor | Bu elle düzenlenir, karıştırma |
| Yayınlanmış migrasyon | **Asla değiştirme.** Şema değişikliği yeni eklemeli migrasyon (`pnpm db:migrations:generate`) |
| `better-sqlite3` Electron için derli | Düz Node testlerinde `NODE_MODULE_VERSION` hatası **beklenen durumdur**, kod hatası değil |
| ESLint `barrel/closed` | Derin import yapma; gerekiyorsa ilgili `index.ts` barrel'ına export ekle |
| Oxfmt pre-commit hook | Dosyaları biçimlendirip commit'i düşürebilir. Takılırsa `./node_modules/.bin/oxfmt --write .`, `git add -u`, tekrar dene |
| Commit imzası | Bu makinede GPG/SSH anahtarı yok. `git commit --signoff` kullan, `-S` **kullanma** |
| i18n | Yeni anahtar → `en-us.json` → `pnpm i18n:sync` → 12 dili çevir (`i18n-translator` alt ajanı) |
| `pnpm i18n:check` şu an 35 hata veriyor | **Bunlar senin değil** — el-gr/ru-ru'daki eski anahtarlar. Kendi hatan sanma |
| `@cherry/*` MCP sunucuları | `src/main/ai/mcp/servers/` içine bak — `browser`, `memory`, `filesystem`, `skills` zaten var |

### Hangi madde hangi modele veriliyor

Bu plandaki işler aynı zorlukta değil. Yanlış modele verilen iş, kazandırdığından çok
zaman kaybettirir.

**Haiku'ya uygun — mekanik, sınırları belli, tek dosya/birkaç dosya:**
`U1` (yedeği aç) · `U4` `U6` · `V1` (servis kapatma) · `B2` (alan ekleme) · `B3` ·
`B4` (switch genişletme) · `B5` (sayaç) · `L1` (sağlayıcı kaydı) · `L12` · `P6` · `R11` `R12` ·
`W2` (hata sözlüğü) · `Y1` `Y2` · i18n işleri · `Z7` (katalog verisi)

**Orta — birkaç dosya, mevcut deseni taklit ederek:**
`B1` `B6` `B7` · `C` · `J1` `J2` `J3` `J5` `J6` · `L4` `L6` `L7` `L10` · `P1`–`P5` `P7` ·
`Q` maddeleri · `R1` `R7` `R9` `R10` · `S4` `S5` `S7` · `U2` `U3` `U5` · `W1` `W3` `W4` ·
`X2` `X4` · `Z2` `Z4` `Z5` `Z6` `Z8`

**Güçlü model gerekir — mimari karar, çok dosya, ince değişmezler:**
`D` (baş kontrolcü — `AiStreamManager` + `PersistentChatContextProvider` iç işleyişi) ·
`F2` (adaptör motoru + öğretme modu) · `G2` `G3` (auto mode, görev kuyruğu) ·
`I` (masaüstü otomasyonu, yerli modül) · `K2` `K3` (hafıza katmanları) ·
`L5` (taslak-rötuş akışı) · `O1` `O4` (kontrol noktası, doğrula-düzelt döngüsü) ·
`R2` `R3` `R5` · `S1` `S2` `S3` (plan modu, canlı liste, önizleme) · `T1` `T2` ·
`X1` (kıyas testi) · `Z1` `Z3` (denklik haritası, şeffaf kaynak değiştirme)

**Kural:** Haiku bir maddeye başlar ve "bunu yapmak için şu 6 dosyayı değiştirmem gerekiyor"
diyorsa, o madde yanlış kutuda demektir — dur ve güçlü modele devret.

### Devretme düzeneği — Opus ana oturumda, Haiku alt ajanda

Model değiştirmek için sohbet değiştirmeye gerek yok. `.claude/agents/*.md` altındaki her dosya
bir alt ajan tanımlar; `model: haiku` yazan tanım o işi Haiku'da çalıştırır ve **ana oturumun
bağlamını kirletmez**. Ana oturum (Opus) şöyle çağırır:

```
Agent(subagent_type: "i18n-translator", prompt: "...")
```

**Kurulu alt ajanlar:**

| Ajan | Ne yapar | Ne zaman çağrılır |
|---|---|---|
| `i18n-translator` | 12 dilin çevirisini doldurur | `pnpm i18n:sync` placeholder bıraktığında |
| `preference-key-adder` | Tercih anahtarı ekler (üretilen dosya tuzağını bilir) | `C`, `G2`, `I`, `K`, `L`, `B2` — yeni `usePreference` anahtarı gerektiğinde |
| `catalog-data-writer` | Toplu veri kaydı doldurur | `F1` (ücretsiz sağlayıcılar), `Z1` (denklik haritası), `Z7` (keşif kataloğu), `F2` (site adaptörleri) |
| `Explore` (yerleşik) | "Bu nerede tanımlı" aramaları | Bir maddeye başlamadan "zaten var mı?" kontrolü |

**Opus'un devretme kuralı:** iş **mekanikse ve 3+ dosyaya yayılıyorsa** alt ajana ver; karar
gerektiriyorsa kendin yap. Çeviri, veri girişi, tercih anahtarı ve arama işlerini ana bağlamda
yapma — bağlamı gereksiz şişirir ve pahalıya gelir.

**Yeni ajan gerekirse:** `.claude/agents/<isim>.md` aç, frontmatter'a `name`, `description`,
`tools`, `model: haiku` yaz, altına yapılacak işi ve kuralları anlat. `i18n-translator.md`
örnek alınabilir.

### Kod yazarken

- Mümkün olduğunca **yeni dosya** yaz, mevcut dosyayı değiştirme (Ek 5 — fork ayrışması).
- Yorum yazma; sadece *neden* açık değilse tek satır.
- Kod/yorum/commit **İngilizce**; arayüz metni i18next üzerinden.
- `console.log` yok — `loggerService`.
- Yol için `application.getPath(...)`, `app.getPath()` değil.

## Projenin tek cümlesi

Bu parçaların hepsi şu an **birbirinden bağımsız sistemler olarak zaten var**:
yönlendirme, sağlık, kota, çoklu model, ajan, MCP dosya araçları, web arama, CLI entegrasyonu.
**Bu projenin işi yeni sistem yazmak değil — bunları tek bir orkestratörde birleştirmek.**
Bir özellik eksik görünüyorsa önce "kapalı mı?" diye bak; çoğu kez yazılmamış değil, açılmamış.

## Bozulmayacak kurallar

1. **Elle model seçimi her zaman kazanır.** Yönlendirme yalnızca varsayılanı değiştirir.
2. **Hiçbir istek reddedilmez.** Sağlık/kota kötüyse yine dene.
3. **Yönlendirme optimizasyondur, engel değil.**
4. **Üretilen dosyalar elle düzenlenmez** — `preferenceSchemas.ts`, `bootConfigSchemas.ts`,
   `*Mappings.ts`. Kaynak `scripts/data-classify/data/target-key-definitions.json`, sonra
   `cd scripts/data-classify && node scripts/generate-all.js`.
   (`preferenceTypes.ts` üretilmez, elle düzenlenir.)
5. **Yayınlanmış migrasyon değiştirilmez** — şema değişikliği yeni eklemeli migrasyon.
6. Commit `git commit --signoff` (imzasız). Kod/yorum/commit İngilizce.
7. Arayüz metni: `en-us.json` → `pnpm i18n:sync` → `i18n-translator` alt ajanı.

---

## Yapılanlar — güncel durum

| Faz | Durum | Commit / not |
|---|---|---|
| **A1–A3** | ✅ | Aşağıdaki tabloda |
| **B1–B7** | ✅ | `1f56fd0` — anahtar+model bazlı limit, takvim/yıldönümü yenilemesi, web sayacı, kota tablosu, seçicide `quota_exhausted` pasifliği |
| **U1** | ✅ | `2793c98` — yerel yedek varsayılan açık (günlük, 7 kopya), klasör seçilmemişse uygulamanın kendi `Backups` dizini, mevcut kurulumlar için yükseltme seed'i |
| **V1** | ✅ kısmi | `6049749` — `app.lite_mode` BootConfig anahtarı + Ayarlar→Genel düğmesi; `AnalyticsService` ve `CherryCloudService` hariç tutuluyor (~2 sn). **Yapılmadı:** `MainNetworkDevtoolsService` zaten yalnızca dev modda açık; `subWindow` warmup'ı `windowRegistry.ts:187`'deki açık değişmez uyarısı yüzünden elle bırakıldı |
| **J1** | ✅ | `6049749` — `createRetryableWrap`'e `onModelOutcome`; iptal, ağ hatası ve 401/429 hariç tutuluyor, yedek model devraldıysa yazılmıyor |
| **P4** | ✅ | `forecastQuotaExhaustion` + kota tablosunda "tükenir" sütunu; tablodaki i18n hataları da düzeltildi (iki sütun aynı anahtarı kullanıyordu, bazı başlıklar İngilizce sabitti, ikisi çeviriyi `.replace()` ile kesiyordu) |
| **L1** | ✅ zaten vardı | LM Studio sağlayıcı kaydı pakette hazır (`provider-registry/src/providers/lmstudio.ts`): `authOptional: true`, `localhost:1234`. Kod yazılmadı — kullanıcı ayarlardan açacak ve LM Studio'da "Local Server"ı başlatacak |
| **L2** | ✅ | `a616796` — `chat.routing.local_worker_model` tercihi; geçmiş sıkıştırma ve konu başlığı varsayılan olarak ona gidiyor. `TopicNamingService`'in çalışmayan CherryAI son çaresi de böylece atlanıyor |
| **L4** | ✅ | `694460a7` — LM Studio'nun `openai-embeddings` endpoint'ini sağlayıcı kaydına ekledi; yerel embedding modelleri bilgi tabanı indeksleme için otomatik keşfedilebiliyor. Model fetcher zaten embedding modelleri `type: 'embedding'` ile tanıyıp kapabilite atıyor; endpoint kaydı yapılmadığında arayüzde görünmüyordu. İnsansız tur, harici API kotasından tasarruf |
| **L6** | ✅ | `74c510c5` — `searchKnowledge` sonuçlarını `KNOWLEDGE_SEARCH_MAX_RESULTS = 8` ile sınırlı. İnsanlı modele 50 dosya yerine top 8 en ilgili gidiyor. Vektör araması zaten sıralı, burada ikinci süzgeç uygulanıyor. R2'nin üstüne kap katmanı |
| **L7** | ✅ | `29f50f22` — `ErrorSummarizerService` hata/log özetlemesi yerel modellerle. Stack trace/derleme/test çıktısı O4'e göndermeden önce LM Studio/Ollama modeline özetletiliyor (3–5 satıra indir). Yerel model yoksa `null` dönüyor. Mevcut `AiService.generateText` + sağlayıcı altyapısı, yeni mekanizma yok. Phase.WhenReady yaşam döngüsü, ön koşul: L1/L2 (yerel model sağlayıcıları) |
| **L10** | ✅ | `16020eac` — Basit görevleri (biçimlendirme, listeleme, isimlendirme, sınıflandırma) yerel modele yönlendirme. `isSimpleTask()` ve `reassignSimpleTasksToLocal()` fonksiyonları eklendi, `resolveControllerAssignments()` içine entegre. D2 orkestrasyon aşamasında, kontrolcü görevleri dağıttıktan sonra basit görevler `chat.routing.local_worker_model` tercihine göre otomatik yerel modele yeniden atanır. Uzak API kotası karmaşık düşünme işlerine ayrılır. 38 birim test |
| **B2/B3 arayüz** | ✅ | `cb6ef8a` — anahtar satırında tür (ücretsiz/ücretli/deneme) ve aylık kotalarda yenileme günü. **Bulunan boşluk:** `tier`/`renewalAnchor` şemada vardı ama `UpdateApiKeySchema` `strictObject` olduğu için API onları reddediyordu; şema + servis + arayüz birlikte tamamlandı |
| **C** | ✅ | Oto geçiş düğmesi composer'da (gönder düğmesinin yanı), varsayılan **kapalı**. Kapalıyken `readRetryPolicy` hiç yedek model döndürmüyor — aynı model üzerinde tekrar ve anahtar döndürme etkilenmiyor. Ayrıca kota dolmuş yedek model ve kota dolmuş anahtar artık gerçekten **atlanıyor** (`buildFallbackModels`, `buildApiKeyFallbackModels`), sadece sıralama değişmiyor |
| **U4 (kısmi)** | ✅ | `5158b41` — U1'in açtığı boşluk: klasör seçilmemişken yedek ekranı hem yolu hem durumu gizliyordu, yani çalışırken boş görünüyordu. Etkin klasör artık girdi ipucunda, durum satırı her koşulda görünüyor. `app.get_info`'ya `defaultBackupPath` eklendi |
| **U4** | ✅ | Ayarlar→Veri'nin en üstünde tek satır: **son yedek ne zaman**, ya da "açık ama hiç çalışmadı", ya da kırmızıyla "hiçbir şey yedeklenmiyor" + neyi kaybedeceğin. U1 yedeği açmıştı ama koruma görünmüyordu; görünmeyen riske kimse önlem almaz. Üç ayrım özellikle yapıldı: açık olmak yedek olmak değil, başarısız çalışma yedek değil, ve kapatılmış bir hedefin eski başarısı bugünkü makineye kefil olamaz. Arşivi yazıp eski kopyaları silemeyen çalışma **sayılır** (arşiv var). 6 test |
| **W4 (kısmi)** | ✅ | Yeni ekran açmadım — Ayarlar→MCP'de yerleşik sunucu listesi zaten vardı. Gerçek hata oradaydı: seeder bu sunucuları `isActive: false` ile kuruyor ama satır yeşil tikle **"Kurulu"** diyordu, yani hiçbir şey yapmayan bir yetenek açıkmış gibi görünüyordu. `@cherry/browser`'ın kapalı olduğunu bu oturumda ancak kaynak okuyarak öğrendim. Satır artık **Açık/Kapalı** gösteriyor ve oradan açılıyor. 4 test. **Kalan:** MCP dışındaki kapalı yetenekler (ör. sağlayıcı/özellik bayrakları) hâlâ tek ekranda toplanmış değil |
| **W2** | ✅ | Sözlüğün kendisi **zaten vardı** — `classifyError` → `error.diagnosis.*`, 20 kategori, Türkçesi dahil, sohbetteki hata kutusunda gösteriliyor. Eksik olan: anahtar kurarken bakılan ekranlar (model denetimi, anahtar listesi, anahtar denemesi) sağlayıcının ham metnini basıp susuyordu. Artık önce ne anlama geldiği, altında sağlayıcının kendi sözleri kanıt olarak. Sınıflandırıcı bilemezse hiçbir şey eklenmiyor — uydurma açıklama kullanıcıyı yanlış ayar sayfasına yollar. 5 test |
| **P2** | ✅ | Model seçicide, limiti tanımlı her modelin yanında **"N hak kaldı"**. Aynı model adı birden çok sağlayıcıda olduğu için ("deepseek" ara → DeepSeek, OpenRouter, SiliconFlow satırları) hangisinde yer kaldığını orada görüyorsun; hangi hesapta olduğunu hatırlamaya gerek yok. Ayrı ekran açılmadı — seçim zaten seçicide yapılıyor. **Sıralamaya dokunulmadı:** plan "kalan hakka göre sıralı" diyordu ama seçicideki sıra kullanıcının kendi model düzeni; sayıyı gösterip kararı ona bıraktım. Limiti olmayan anahtar "bilinmiyor" sayılıyor, "0" değil — aksi halde her model tükenmiş görünürdü. 7 test |
| **P3** | ✅ | Sağlayıcı başına anahtar sırası: **Sırayla dolaş** (bugünkü davranış, dakikalık oran sınırları için) veya **Birer birer** (bir anahtarı bitirmeden diğerine geçme, günlük yenilenen haklar için). Anahtar çekmecesinde, yalnız 2+ anahtar varken. `filterKeysWithinQuota` tükenmişleri zaten eliyor, o yüzden "birer birer" = listedeki ilk sağlam anahtar; yeni kota mantığı gerekmedi. Plan "anahtar başına" diyordu ama rotasyon sağlayıcı düzeyinde bir politika, oraya koydum. 2 test (biri varsayılanın değişmediğini sabitliyor) |
| **F1** | ✅ | Groq, Cerebras, OpenRouter, Gemini, HuggingFace vb. **zaten kayıtlıydı** ve anahtar alma adresi de kayıtta var — eksik olan, 60 sağlayıcı arasında hangisinin ücretsiz olduğunun hiçbir yerde yazmamasıydı. Forka ait tek dosya (`presets/freeTierProviders.ts`, üst projedeki 60 dosyaya dokunulmadı — Ek 5), sağlayıcı listesinde rozet (Ücretsiz / Ücretsiz model / Yerel) ve filtre menüsünde "Ücretsiz kullanılanlar". **Bilerek sayı uydurulmadı:** ücretsiz hak miktarları sık değişiyor, ipucu kullanıcıyı sağlayıcının kendi sayfasına yolluyor. Katalogdaki 13 kimliğin gerçekten kayıtlı olduğunu sınayan test var |
| **D3** | ✅ | Birleştirme turu. `stream.status === 'done'` zaten çok modelli turun **hepsi** bitince oluştuğu için zincirleme noktası oydu; `startNextChatTurn` artık kuyruktaki steer ile borçlu birleştirme arasında seçim yapıyor (**steer kazanır** — kullanıcı onu yazıp bekliyor, birleştirme ekrandaki cevaplar üzerinde defter tutmak). Birleştirme istemi model tarafındaki geçmişin son kullanıcı metnini değiştiriyor (işçi cevapları ek tur olarak taşınamayacak kadar uzun). Hata/iptal → birleştirme düşürülür, yarım turu tek kendinden emin cevaba katlamaktansa parçalı cevaplar ekranda kalır. 3 test. Ayrıca eski bir kırmızı düzeltildi: `a884580` `pinned_model` okumasını ekleyip testin mock'unu güncellememişti, 13 vaka birden patlıyordu |
| **D1–D2, D4** | ✅ | **D1** `orchestration/headController.ts` — saf modül: parçalama/birleştirme istemleri + `parseBreakdown`. İşçiler model kimliğiyle değil **sırayla** adreslenir (model kimliği er geç bozulur, bozulan kimlik bir görevi kaybettirir). Bozuk çıktıda `null` → orkestrasyon atlanır, normal tur gider. 20 test. **D2** `prepareDispatch` kontrolcüyü çağırıp her işçinin *model tarafındaki* kullanıcı mesajına görevini `<system-reminder>` olarak ekliyor — kalıcı satır değişmiyor, ek dosya/görsel parçaları duruyor. 30 sn zaman aşımı (kontrolcü takılırsa tur takılmasın — A2 dersi). **D4** composer'da "Baş kontrolcü" seçici, yalnız 2+ model seçiliyken görünür, × ile temizlenir. 5 test. **Kalan: D3 (birleştirme turu)** — şu an N işçi cevabı kardeş olarak görünüyor, tek cevapta birleşmiyor |
| **R1 (otomatik)** | ✅ | `useAutoContinueTruncated` — tur bitip `finishReason === 'length'` görülünce sürdürme kendiliğinden tetikleniyor, cevap başına **en fazla 3** kez. Renderer'da: aynı doğrulanmış `continue-truncated` yolunu çağırıyor, `AiStreamManager`'ın kabul mantığına dokunulmadı (A2'nin takılması tam orada yaşıyordu). Yalnız bu oturumda *görülen* bir bitişte çalışır — kesilmiş cevap içeren bir konuyu açmak istek tetiklemez. Ayarlar→Genel'de kapatma anahtarı. 7 test |
| **R1 (elle)** | ✅ | **Sinyal:** kesilme `MessageStats.finishReason`'a yazılıyor (`observers/usage.ts` `onStepFinish`, JSON sütunu, migrasyon gerekmedi). **Ekran:** kesilen asistan mesajının araç çubuğunda "Yanıtı sürdür" düğmesi — yalnız `finishReason === 'length'` iken. **Sürdürme:** yeni `continue-truncated` tetikleyicisi `prepareContinueDispatch`'e gidiyor; aynı satır, aynı model, geçmişin sonunda yarım cevap, `accumulatorSeed` yazılanı koruyor. Canlı akış varken reddediliyor. **Kalan:** otomatikleştirme (tercih + en fazla 3 deneme) |
| **P1 (deneme)** | ✅ | Anahtar kaydedilince sağlayıcının sohbet edebilen ilk modeline tek küçük istek gidiyor; satırda "Çalışıyor · N ms" / "Çalışmıyor" (hata metni ipucunda) görünüyor, şimşek düğmesiyle tekrar denenebiliyor. Mevcut `ai.provider.model.check` + `apiKeyOverride` kullanıldı, yeni IPC yok. **Kalan:** anahtar biçiminden sağlayıcı tahmini, `x-ratelimit-*` başlıklarından limit doldurma |
| **P7** | ✅ kısmi | **Şema + UI bitti.** `ProviderSettingsSchema`'ya `ProviderProxyConfig` (mode: 'system'/'direct'/'custom') eklendi, `ProviderProxySettings.tsx` bileşeni sağlayıcı settings drawer'ında radio + custom URL input sunuyor, 6 i18n anahtarı eklendi (`settings.provider.proxy_*`). **ProxyService runtime integasyonu yapılmadı:** Electron session proxy ve Node proxy controller'ı sağlayıcı başına override etmek sistem mimarisi genişletmesi gerektiriyor; başlama-söyle-dur listesine taşındı. Schema ve UI temel altyapı hazır, çalışma zamanı bağlantısı için ana oturum gerekiyor. `8277b20a` |
| **J2** | ✅ | `ProviderKeyScanService` — 30 dk'da bir bakar, **yarım gündür sessiz** kalan sağlayıcıya tur başına **tek** yoklama atar. Tasarım notu: plandaki "kota harcamayan istek" diye bir şey yok, en küçük yoklama bile 1 istek; o yüzden gerçek trafiğin tazelediği sağlayıcı atlanır (J1 zaten her isteğin sonucunu yazıyor), kotası dolmuş sağlayıcıya dokunulmaz, sağlayıcı başına günde en fazla ~2 istek. Sonuç mevcut `chat.retry.model_health`'e yazılıyor → model seçicideki pasif rozet ve yedek sıralaması zaten okuyor, yeni ekran gerekmedi. Ayarlar→Genel'de kapatma anahtarı. 9 test |
| **J3** | ⛔ gereksiz | `ProviderService.resolveApiKey` **zaten senkron round-robin** yapıyor, JS tek iş parçacıklı olduğu için anahtar seçiminde yarış durumu yok. Geriye kalan gerçek ihtiyaç — aynı anahtara paralel istekleri oran sınırına göre sıraya almak — **H1**'in işi, ayrı bir madde değil |
| **U6 (1/2)** | ✅ kısmi | **Onay zaten vardı:** tek/toplu konu silme (context menu + satırdaki çöp kutusu düğmesi) `topic.delete` action'ının `confirm` alanı üzerinden `ConfirmActionPopup`/`ActionConfirmDialog` gösteriyor, tekli metni zaten "geri alınamaz" diyordu. Asistan silme/asistanın tüm konularını temizleme de `popup.confirm` ile zaten soruyordu. **Gerçek boşluk ikiydi:** (1) toplu konu silme + asistan silme + asistan konularını temizleme onayları "eminmisin" diyordu ama "geri alınamaz" demiyordu — üç `en-us.json` metni düzeltildi (12 dile çevrildi). (2) `Topics.tsx`'teki günlük çöp/tekrar-tıkla-onayla simgesi (X → kırmızı çöp kutusu, 2 sn içinde tekrar tıkla) hiç metin uyarısı vermiyordu, sadece renk değişiyordu — armed haldeyken tooltip/aria-label artık konunun adını anıp "geri alınamaz" diyor (`chat.topics.delete.confirm_tip`, yeni test). **Çöp kutusu (2/2) yapılmadı, sadece araştırıldı:** `topic` ve `message` tabloları `deletedAt` sütununu **zaten** taşıyor (`createUpdateDeleteTimestamps`, `migrations/sqlite-drizzle/0000_orange_jasper_sitwell.sql`'de yayınlanmış — migrasyon gerekmez) ama `TopicService.delete`/`deleteManyByIdsTx` her zaman gerçek `DELETE` yapıyor ve mesajları anında `purgeByTopicIdsTx` ile siliyor; kod yorumu bunu "future soft-delete path" olarak zaten öngörmüş. 30 günlük çöp kutusu bu sütunu kullanabilir ama restore ekranı, liste ucu ve süresi geçince temizleyen bir görev hiçbir yerde emsal yok (dosya/asistan soft-delete'i de yalnızca gizliyor, geri getirmiyor) — çok dosyalı, karar gerektiren ayrı bir iş, bilerek bırakıldı |
| **W3** | ✅ | Ayarlar→Hakkında'ya yeni bir **"Sistem sağlığı"** bölümü, mevcut sayfaya eklendi — yeni rota/menü maddesi açılmadı. Hepsi zaten var olan durumdan okunuyor, hiçbir yeni istek atılmıyor: kaç sağlayıcı bağlı (`isProviderSettingsListVisibleProvider` ile CherryAI/yerel-gömülü embedding hariç tutulup kimlik doğrulaması gerektirmeyen yerel sağlayıcılar ve girişle çalışanlar dahil edilerek), kaç anahtar etkin, `chat.retry.model_health`'e göre kaç model yanıt veriyor/başarısız/hiç denenmedi, LM Studio/Ollama gibi yerel çalışma zamanlarının en son kayıtlı probu, kaç MCP sunucusu kurulu/açık ve en son MCP hatası (`McpRuntimeService`'in zaten tuttuğu paylaşımlı durumdan). `DiagnosticBundleService`'in teşhis paketi dışa aktarma düğmesi aynı sayfada hemen altında duruyor, dokunulmadı. Anahtar başına canlı deneme sonucu (`useApiKeyProbe`) kalıcı değil, oturuma özel olduğu için sayfada ayrı bir sayı uydurulmadı, bunun yerine anahtar listesinden canlı denemeye yönlendiren bir not var. Ekranda derlenmiş sürümle doğrulandı: "2/2 bağlı", "71 yanıt veriyor · 77 başarısız · 64 hiç denenmedi" gibi bu makinenin gerçek verileri göründü. 21 test |
| **W3 — bulunan hata: bayat sağlık verisi sonsuza dek geçerli sayılıyordu** | ✅ | `chat.retry.model_health` her kayda `checkedAt` yazıyordu ama üç yönlendirme dosyası da (`modelAvailability.ts`, `deriveRoutingTable.ts`, `categoryRouting.ts`) sadece `ok` alanına bakıyordu — bir model bir kez `false` yazdı mı, o model tam olarak yeniden yoklanana kadar sonsuza dek "başarısız" kalıyordu. Bu makinede tam olarak buydu: DeepSeek kredisi bitmiş bir geceden kalan + bir "başarısızları devre dışı bırak" toplu işleminden gelen kayıtlar, hesap düzelse de asla tazelenmiyordu. Tek yerden paylaşılan `MODEL_HEALTH_STALE_AFTER_MS` (24 sa, `src/shared/utils/modelHealth.ts`, yeni `freshModelHealth` yardımcısı) eklendi; süresi geçmiş kayıt "hiç yok" ile aynı sonucu üretiyor, başarı ve başarısızlık aynı pencereyle süzülüyor. Okuyan altı dosyanın hepsi güncellendi: `modelAvailability.ts`, `deriveRoutingTable.ts`, `categoryRouting.ts`, `healthSummary.ts`, `autoFallbackModels.ts`, `orderFallbackModels.ts`. `ProviderKeyScanService`'in kendi 12 saatlik "yoklamaya değer mi" penceresine dokunulmadı, ayrı bir soru. Veritabanı doğrudan sorgulanarak doğrulandı (aynı süzme mantığı Python'da tekrarlanıp W3'ün kendi sayılarıyla eşleştiği görüldü): Ayarlar→Hakkında **77 başarısız → 1**, **71 yanıt veriyor → 0** (ikisi de büyük ölçüde bayatmış — bu makinede son 24 saatte gerçekten yoklanmış tek bir model kalıyor). 19 yeni test, 6 dosyaya yayılmış (yeni `modelHealth.test.ts` dahil) |
| **U2** | ✅ zaten vardı, metin düzeltildi | **`LegacyBackupManager` zaten tek-dosya taşınabilir tam yedek yapıyor:** `Data` dizininin tamamı (sqlite → sohbetler, sağlayıcılar+API anahtarları, tüm Preference'lar dahil kota limitleri, bilgi bankaları + vektör mağazaları `KnowledgeBase/{id}/index.sqlite`, notlar, dosyalar, beceriler, ajan/proje verileri `Agents/`, MCP sunucu kayıtları tablosu, mini uygulamalar) + `cache.json` + IndexedDB + Local Storage tek zip'e giriyor; restore hostname/deviceId kontrolü yapmıyor, `metadata.platform` uyuşmazlığında sadece uyarıyor — **başka makineye taşınabilirlik zaten çalışıyor**, yeni format gerekmedi. **Gerçek boşluk:** `~/.cherrystudio` (CHERRY_HOME) yedeğin tamamen dışında — MCP OAuth token'ları, `@cherry/memory` sunucusunun kalıcı bilgi grafiği (`config/memory.json`), özel MCP registry, Copilot token hiç kopyalanmıyor. Kapatmadım: bunu eklemek atomik restore-journal/promotion-gate durum makinesini (`src/main/data/db/restore/`, "sadece userData içindeki yollar" değişmezini taşıyan) userData dışı bir köke genişletmek demek — bu maddenin "en küçük değişiklik" sınırını aşıyor, ayrı madde olarak bırakıldı. **API anahtarları doğrulandı: düz metin** — `userProvider.apiKeys` JSON sütunu, `src/main/data` içinde hiçbir yerde şifreleme yok, zip'in kendisi de parolasız (`archiver` şifreleme desteklemiyor) — bu **U5**'in işi, dokunulmadı. Kapatılan tek gerçek boşluk: ekran hiçbir yerde taşınabilir olduğunu ya da anahtarların düz metin gittiğini söylemiyordu. `settings.data.protection.covers` (Ayarlar→Veri, `6c1257c`'nin koruma özetinin hemen içinde) artık ne taşıdığını, **ne taşımadığını** (MCP oturumları + asistanın hafıza dosyası) ve anahtarların düz metin gittiğini söylüyor, 13 dile çevrildi. *(Denetimde düzeltildi: ajanın ilk metni kendi bulduğu boşlukla çelişip "her şey beraberinde gelir" diyordu.)* Derlenmiş sürümde CDP ile Ayarlar→Veri'ye gidilip yeni cümlenin ekranda göründüğü DOM üzerinden doğrulandı, `Bootstrap complete`, hata satırı yok |
| **Z8** | ✅ | Ayarlar'daki pasif "yenilenir tarihi" (`ApiKeyQuotaLimit`, B3b) artık ayrıca **bildiriyor** — yeni `useQuotaNotifications` (renderer, `MainWindowRuntime`'a bağlı): (1) `new_period` — bir limitin takvim dönemi ilerleyince (herhangi bir tier) tek seferlik toast; "yenilendi" demiyor, "takvime göre yeni dönem başladı" diyor, çünkü sağlayıcıya sorulmadı, sadece tarih hesaplandı. (2) `trial_exhausted` — `deneme` tier + `total` dönem anahtarı P4'ün `forecastQuotaExhaustion`'ı `'exhausted'` sayınca tek seferlik toast (bu havuz asla yenilenmiyor, B2). Tekrarı önleyen durum yeni `chat.routing.quota_notice_state` tercihinde (limitKey → son görülen dönem başlangıcı / uyarıldı mı), yeniden başlatmada kaybolmuyor. Limiti olmayan anahtar hiç işlenmiyor, ağ isteği yok. **Bulunan ama dokunulmayan hata:** `QuotaOverviewTable`'ın (P4) kullanım sorgusu, listede `'total'` dönemli bir limit varsa `from:0` gönderiyor; `/ai-usage-records/stats` şeması 366 günden uzun aralığı reddettiği için istek başarısız oluyor ve **tablodaki tüm satırlar** (o satır değil) kullanılan/kalan/tahmin sütununu sessizce boş gösteriyor. Kendi sorgumu 365 günlük pencereyle sınırlı tutup aynı tuzağa girmedim — üst tablonun düzeltmesi ayrı iş, dokunulmadı. 16 yeni test (`apiKeyLimit.test.ts` +10, `useQuotaNotifications.test.ts` +6), `typecheck:node`/`typecheck:web` temiz |
| **Z6** | ✅ kısmi | Kapsam bilerek daraltıldı: tam madde sağlayıcı-eşdeğerlik haritasına (Z1, "dokunma" listesinde) bağlı, o kısım yapılmadı. Yapılan: `routeDefaultModelId` (kategori/sabitlenmiş model/sağlık kurtarma) gönderimden önce **öngörülebiliyor** — composer'da göndermeden önce hedef modelin değişip değişmeyeceğini söyleyen sessiz bir gösterge. Bulunan: `routing.derived_table` zaten paylaşılan önbellekte ve `TaskRoutingSettings` onu okuyordu ama composer'da hiçbir iz yoktu — model tetikleyicisi düz seçili modeli gösteriyor, yönlendirmenin onu değiştirebileceğini söylemiyordu. `getRemainingQuota`/"N hak kaldı" rozeti zaten seçicide vardı, aynen kullanıldı, yeniden hesaplanmadı. Asıl risk: önizlemeyi ayrı mantıkla yazmak, gerçek karardan sessizce sapabilirdi (bu oturumdan önceki bir kusur tam bu şekildeydi — aynı veriye iki farklı kural). Onun yerine `routeDefaultModelId`'nin seçim çekirdeği `src/shared/utils/routingDecision.ts`'e çıkarıldı (`pickCategoryModel`, `bestHealthyModelId`), `categoryRouting.ts` artık onu çağırıyor — davranış birebir aynı, mevcut 18 test değişmeden geçiyor. Yeni `src/renderer/components/composer/variants/chat/routingPreview.ts` aynı paylaşılan fonksiyonları + zaten senkronize tercihleri/önbelleği kullanarak önizlemeyi hesaplıyor, main'i tekrar yazmıyor. Ekran: `RoutingDestinationHint`, `sendAccessory`'de `ChatComposerContextUsage`'ın yanına kondu (plan metninin işaret ettiği "Q1'in bağlam göstergesiyle aynı yer" — o gösterge zaten oradaydı). Yönlendirme hedefi göstermeyeceği sürece (elle seçim, @-mention, ya da zaten aynı model) **hiçbir şey göstermiyor** — seçili model zaten tetikleyicide yazılı, onu tekrar etmek gürültü olurdu. Değiştiğinde küçük bir "→ hedef model" ile, üstüne gelince sağlayıcı adı + neden (sabitlenmiş/kategori/sağlık kurtarma) + biliniyorsa kalan hak. Kota bilinmiyorsa (yaygın durum) o satır hiç yazılmıyor. 7+11+3 yeni test (`routingDecision`, `routingPreview`, `RoutingDestinationHint`), `categoryRouting.test.ts` (18) ve `ChatComposer.test.tsx` (149) değişmeden yeşil — ikincisi `RoutingDestinationHint`'i `ModelSpeedControl` gibi taklit ederek dışarıda bıraktı (kendi `useModels` çağrısı ChatComposer'ın kendi lazy-fetch testiyle çakışıyordu). 6 yeni i18n anahtarı 13 dile çevrildi; `git diff --stat` ile her dilde yalnızca 6 satır eklendiği doğrulandı — el-gr/ru-ru'daki komşu satırlarda **önceden var olan** (bu oturumdan önce, HEAD'de de mevcut) bozuk kodlama bulundu, dokunulmadı, bilinen kırmızı listesiyle eşleşiyor. `typecheck:node`/`typecheck:web` temiz. Derlenmiş sürüm `Bootstrap complete` ile hatasız açıldı, composer'a yazı yazıldı, gönder düğmesi ve diğer aksesuarlar (karıştırma düğmesi) çalıştı — ama bu profilde yönlendirme hiçbir modeli değiştirmediği için **göstergeyi canlı tetiklenmiş halde göremedim**; o görsel yol yalnızca kontrollü verili bileşen testiyle doğrulandı. Kalan: kanonik model eşdeğerleri arası "alternatifler ve tahmini maliyet" (Z1'in işi) |
| **W1** | ✅ kısmi | Onboarding zaten `ProviderSettingsPage`'in tamamını gömüyor — anahtar yapıştır → model listesini çek → sağlık kontrolü → sağlayıcıyı etkinleştir zinciri (P1'in dayandığı `ProviderApiSetupDialog`) onboarding'in "sağlayıcı" adımında **hazır olarak zaten çalışıyordu**; LM Studio da aynı akıştan geçiyor (auth gerektirmeyen sağlayıcı → "Modelleri ekle" düğmesi), L1'in notu bu yüzden "kod yazılmadı" diyordu. **Gerçek boşluk:** 60 sağlayıcılık listeye düşen kullanıcıya hangisinin bedava/yerel olduğunu söyleyen hiçbir şey yoktu — F1'in rozetleri sayfada vardı ama onboarding bunu hiç öne çıkarmıyordu. Kapatılan: onboarding'in sağlayıcı adımı artık listeyi **ücretsiz/yerel filtresiyle** açıyor (mevcut `filterModeHint` düzeneği — 'agent' için zaten vardı, `ProviderSettingsPage`'e opsiyonel prop olarak eklendi) ve LM Studio'yu adıyla anan kısa bir ipucu gösteriyor; filtre tek tıkla kaldırılabiliyor. **"Çalışma klasörünü seç" kapsam dışı bırakıldı:** bu G1'in `@cherry/filesystem` MCP `baseDir` seçicisini kodlama ekranına taşıma işi — henüz yapılmamış, ilgisiz bir özellik; onboarding'e ayrı bir klasör seçici eklemek G1'i erken ve yanlış yerde inşa etmek olurdu. 2 yeni test, `typecheck:node`/`typecheck:web` temiz, derlenmiş sürüm `Bootstrap complete` ile hatasız açıldı — ama bu makinede onboarding zaten tamamlanmış olduğu için ekranı bu profilde bizzat göremedim, o kısım testler + kod okumasıyla sınırlı doğrulandı |
| **Z5** | ✅ kısmi | Kapsam bilerek daraltıldı: "kanonik model başına sıra" Z1'in (denklik haritası, "dokunma" listesinde) verisine bağlı, o kısım yapılmadı. Yapılan: `orderFallbackModels.ts`'in mevcut sıralaması (sağlık: `ok < unknown < failed`, sonra kalite puanı) **korundu**, araya ikinci eksen eklendi — sağlığın ayıramadığı adaylar arasında sağlayıcının etkin anahtarlarından en ucuz katman (bedava → deneme → ücretli) önce gelir, kalite hâlâ son çeviricidir. Sağlık kasıtlı olarak daha güçlü sinyal kaldı: az önce başarısız olmuş bedava bir model, çalışan ücretli birinin önüne geçemiyor — yoksa yeniden deneme parayı sağlıktan önce koyup daha az güvenilir olurdu. Bir sağlayıcının kotası zaten `buildFallbackModels`/`isProviderQuotaExhausted` tarafında **atlanıyordu** (C notu); burada tekrar edilmedi, sıralama yalnızca sağlıkla ayrılamayan adaylar arasında ve `providerService.getApiKeys(id, {enabled:true})`'ın döndürdüğü anahtarlardan en ucuzu (`Math.min`) kazanıyor — bir sağlayıcıda tek bedava anahtar bile o sağlayıcıyı "bedava" yapar. `tier` boşsa "bedava" sayıldı (şemadaki belgelenmiş varsayılan, `useQuotaNotifications.ts`'teki `tier ?? 'free'` deseniyle aynı); anahtar sorgusu başarısız olursa (silinmiş sağlayıcı) "ücretli" — en tutucu sıra, hiçbir zaman gerçek bir bedavanın önüne geçmiyor. **Ücretli/ücretli (ucuz/pahalı) ayrımı yapılmadı:** `Model.pricing` alanı var ve preset modellerde `provider-registry` katalogundan geliyor, ama para birimi normalizasyonu yok, kademeli (`inputTokenTiers`) fiyatlandırmayı tek sayıya indirmiyor ve özel modellerde sık boş — bunu güvenle "ucuz/pahalı"ya çevirmek bu maddenin sınırını aşan ayrı bir tasarım kararı, uydurulmadı; ücretli tek kova kaldı. Ağ isteği yok, elle model seçimini etkilemiyor (yalnız otomatik yedek sırası), hiçbir aday elenmiyor. 7 yeni test (`orderFallbackModels.test.ts`, toplam 13) + dizindeki 71 test yeşil, `typecheck:node`/`typecheck:web` temiz. Arayüze dokunulmadı, yeni i18n anahtarı yok. Derlenmiş sürüm `Bootstrap complete (841.705ms)` ile hatasız açıldı — değişiklik görünür bir ekran öğesi değil, doğrulama log + testlerle sınırlı |
| **Q2** | ✅ | **Denetim önce:** iki kaba mekanizma zaten vardı — "yeni bağlam başlat" (`hasClearContextPart`/`startNewContext`, composer'daki silgi aracı + kesikli çizgi ayırıcı) bir noktadan **öncesinin tamamını** atıyor; `chat.context_settings.max_messages` asistan ayarı son **N** mesajı tutuyor. İkisi de kullanıcının "hangi eski mesaj" dediği tek-tek seçimi karşılamıyor — ortadan bir mesajı atlayıp sonrasını tutamıyorlar. `useMessageSelectionController`'ın çoklu-seçimi kasıtlı olarak kullanılmadı: kopyala/kaydet/sil'e adanmış, konu değişince ve seçim modu kapanınca temizleniyor — kalıcı dışlama için yeniden kullanmak "sil" ile çakışırdı. Yapılan: `PersistentChatContextProvider.resolveCompactedHistory`'de **tek satırlık filtre** — `messagePath`'in temizlik sınırından sonraki dilimi, yeni `chat.context_settings.excluded_messages` tercihindeki (mesaj kimliği → `true`, global — kimlikler zaten eşsiz) kimliklere göre süzülüyor, `rawUI`/`retainedContext`/`rows`/sıkıştırma hesaplanmadan **önce** — böylece dışlanan mesajın dosya/araç erişimi de otomatik iptal oluyor (pencere kırpmasıyla aynı ilke), fonksiyonun geri kalanı hiç değişmedi, 5 dispatch çağrı noktasının hepsini (gönder/steer/kontrolcü-birleştir/devam-ettir/onay-sonrası) tek noktadan kapsıyor. Yazıcı: mesaj menü çubuğunda yeni "Bağlamdan hariç tut / Bağlama dahil et" düğmesi (göz simgesi, her mesajda). Ekran: dışlanan mesajda **her zaman görünen** rozet (hover gerekmez) — hem `MessageHeader.tsx` (asistan + bubble-olmayan kullanıcı) hem `MessageFrame.tsx`'teki `UserBubbleMessage` (varsayılan bubble stilindeki kullanıcı mesajı) için ayrı ayrı eklendi, ikisi ayrı render yolu; rozetin sadece birinde olduğunu derlenmiş sürümde görünce ikinciyi ekledim. `ChatComposerContextUsage`'a dokunulmadı: o gösterge **geriye dönük** (son turun gerçek `contextTokens`'ı), gönderim-öncesi tahmin değil — dışlamanın tasarrufu oraya kendiliğinden, bir sonraki turun gerçek sayısıyla yansır, ayrı kod gerekmedi (Q1 hâlâ yapılmadı, ayrı madde). Kalıcılık: Preference cross-process olduğu için ana süreç (`resolveCompactedHistory`) ve renderer aynı veriyi okuyor/yazıyor; dışlama listesi mesaj kimliğine göre küçük kalıyor çünkü geri dahil etme anahtarı siliyor, `false` yazmıyor. Yeni preference `preference-key-adder` alt ajanıyla eklendi. 3 yeni i18n anahtarı `i18n-translator` ile 12 dile çevrildi, encoding taraması temiz. Testler: `contextExclusion.test.ts` (4, yeni), `PersistentChatContextProvider.test.ts`'e 1 yeni vaka (bu makinede tüm dosya `NODE_MODULE_VERSION` ile kırmızı — `git stash` ile temiz ağaçta da aynı hatanın var olduğu doğrulandı, benim değil), `messageMenuBarActions.test.tsx` +2, `homeMessageListAdapter.test.tsx` +3, `src/renderer/components/chat/messages` dizininin tamamı 1140 test yeşil, `typecheck:node`/`typecheck:web` temiz. **Derlenmiş sürümde CDP ile uçtan uca doğrulandı** (bu oturumda `cherry-electron-dev` kurulu değildi, elle CDP script'i yazıldı): gerçek bir kullanıcı mesajı gönderildi (asistan cevabı bu forkta beklendiği gibi "CherryAI client secret is not configured" ile başarısız oldu, ilgisiz), düğmeye tıklanınca aria-label "Bağlamdan hariç tut" ↔ "Bağlama dahil et" arasında değişti, rozet çıktı/kayboldu, ve **uygulamayı tamamen kapatıp yeniden derleyip açtıktan sonra dışlama ve rozet hâlâ oradaydı** — kalıcılık gerçekten doğrulandı, varsayımla bırakılmadı. `Bootstrap complete`, tek hata bu forkta zaten kırık olan CherryAI'nin kendi hatası. **Doğrulanamayan:** dışlanan mesajın gerçekten çalışan bir modele gitmediği — bu profilde hiçbir sağlayıcı yapılandırılı değil, o kısım yalnızca birim testiyle (`contextExclusion.test.ts` + yeni `resolveCompactedHistory` vakası) kanıtlı |

| **R9** | ✅ | Anahtar başına not alanı + sağlayıcının anahtar sayfasına tek tık. Yeni `ApiKeyNote.tsx`, çekmecede her anahtar satırının altına `ApiKeyQuotaLimit`'in yanına render ediliyor — satırın kendisine (label/key düzenleme alanı) değil, B2/B3'ün zaten kurduğu "yeni alan = ayrı alt bileşen" düzenine uyuyor, satır daha da kalabalıklaşmıyor. Bağlantı **yazılmıyor, türetiliyor**: `provider.websites?.apiKey` (sağlayıcı kaydındaki `metadata.website.apiKey`) — bu üstteki "API Anahtarı Al" bağlantısında zaten vardı ama çekmecenin kendisi hiç göstermiyordu; manuel URL girişi eklenmedi, sağlayıcının kaydı yoksa buton hiç çıkmıyor. E-posta alanı eklenmedi — not alanı zaten "hangi hesap/nereden" bilgisini serbest metinle taşıyor. Bilinen tuzak tekrar çıktı: `UpdateApiKeySchema` `strictObject`, `note` üçüne birden (şema + `ProviderService.updateApiKey`'in alan-alan birleştirme mantığı, `label` ile aynı "boşsa sil" kuralı + UI) eklendi. **Round-trip gerçek uygulamada doğrulandı:** DeepSeek anahtarına not yazıldı, çekmece kapatılıp uygulama tamamen kapatılıp yeniden derlenip açıldıktan sonra not hâlâ oradaydı (bu makinede `ProviderService.apiKeys.test.ts` `better-sqlite3` `NODE_MODULE_VERSION` uyuşmazlığıyla kırmızı — `git stash` ile temiz ağaçta da aynı hatanın önceden var olduğu doğrulandı; asıl kanıt derlenmiş uygulamadaki bu manuel round-trip). Yeni birim testi de eklendi (bu makinede çalışmasa da CI'da geçerli). **Dokunulmayan önceden var olan boşluk:** `normalizeApiKeyEntry` (toplu `replaceApiKeys`/PUT yolu — yalnız `authOptional` yerel sağlayıcıların üstteki düz metin kutusu bu yolu kullanıyor) zaten `tier`/`renewalAnchor`'ı da sessizce düşürüyordu; `note` aynı kaderi paylaşıyor, B2/B3'ten kalma ayrı bir hata, bu maddenin kapsamı dışında bırakıldı. 1 yeni test (`ProviderService.apiKeys.test.ts`), `ConnectionSettings` dizininin tamamı (6 dosya, 53 test) yeşil, `typecheck:node`/`typecheck:web` temiz, 2 yeni i18n anahtarı 12 dile çevrildi (encoding taraması temiz). Derlenmiş sürüm `Bootstrap complete` ile hatasız açıldı, ekran görüntüsüyle doğrulandı |

| **R10** | ✅ kısmi | **Denetim önce:** `aiUsageRecord` (`src/main/data/db/schemas/aiUsageRecord.ts`) her satırda `sourceType/sourceId/sourceName/sourceIcon` taşıyor (`assistant`/`agent`/`mini-app` + kimlik), ve `AiUsageRecordService.ts`'teki `groupBy: 'source'` istatistik ucu (`AiUsageRecordGroupBySchema` — `provider`/`apiKey`/`apiKeyModel`/`model`/`source`) **zaten tam çalışıyordu**, sadece ekranda kullanılmıyordu (`UsageSourceLabel` bile `UsageSettingsPrimitives.tsx`'te hazır duruyordu). **Plandaki örnek kısmen yanlış:** "otonom işten X" gerçekten ayrılabiliyor (agent-session turları `sourceType:'agent'` yazıyor) ama "özetlemeden Y" **hiç ayrılamaz** — konu özeti/bağlam sıkıştırma (`inLoopCompaction.ts`, `PersistentChatContextProvider.ts`'teki durable fold) AI SDK'nin `generateText`'ini `compressionModel.languageModel` üzerinden **doğrudan** çağırıyor, `AiService`/`createAiUsagePlugin`'e hiç girmiyor — bu isteklerin `aiUsageRecord`'da **satırı yok**, veri değil, kayıt yokluğu. Konu adlandırma (`TopicNamingService`) ve baş kontrolcü (`resolveControllerAssignments`) `AiService.generateText` üzerinden gidiyor ama bilerek assistantId taşımıyor, o yüzden `sourceType/sourceId` `null` yazılıyor — ekranda "unattributed" (var olan `settings.usage.cards.unattributedSource`) olarak kalıyor, "özetleme" diye uydurulmadı. Yapılan: yeni `UsageSourceBreakdown.tsx`, kota tablosunun hemen altına — **bugünün** (yerel takvim günü, `usageStatsFrom` ile sınırlı `from`) isteklerini `groupBy:'source'` ile kaynağa (asistan/ajan/mini-app adı) göre kırıyor, top 5 + sunucunun hesapladığı "Diğer" satırı. Var olan `Explore` bölümüne (zaten source/model/provider/apiKey groupBy'ı var) dokunulmadı — o genel/geriye-dönük analiz aracı, minimum pencere 30 gün; bu panel günlük+kaynağa özel ve kota tablosunun yanında her zaman görünür. Testte gerçek bir çökme bulundu ve düzeltildi: `data?.totals.requestCount` (`?.` zincirinin ortasında eksik), test ortamının genel mock'u `/ai-usage-records/stats` için ilgisiz bir gövde döndürünce `UsageSettings.test.tsx`'in 4 testi patlattı. 4 yeni test (`UsageSourceBreakdown.test.tsx`) + `UsageSettings` dizininin tamamı (6 dosya, 27 test) yeşil, `typecheck:node`/`typecheck:web` temiz. 2 yeni i18n anahtarı `i18n-translator` ile 12 dile çevrildi; `git diff --stat` her dilde tam 2 satır gösterdi, el-gr/ru-ru'da komşu satırlardaki **önceden var olan** bozuk kodlama (bilinen kırmızı) okunarak doğrulandı, dokunulmadı, yeni satırlar kendi dillerinde düzgün. Derlenmiş sürüm `Bootstrap complete (676.391ms)` ile hatasız açıldı, açılış penceresinde `level:error` yok. **Doğrulanamayan:** Ayarlar→Kullanım Analizi ekranına gidip paneli ekran görüntüsüyle/CDP ile görmedim — bu oturumda öyle bir araç kullanılmadı ve uygulama sekme başına `createMemoryHistory` kullandığı için URL/hash ile CDP navigasyonu çalışmaz; doğrulama kod okuması + birim testleriyle sınırlı kaldı. **Not:** bu makinede bugün hiç başarılı AI isteği kaydedilmemiş olabilir (CherryAI bu forkta hep başarısız, diğer sağlayıcılar anahtar gerektirir) — o durumda panel boş-durum mesajını gösterir, bu da doğru/beklenen davranıştır |
| **R10a** | ✅ | **R10 denetiminin ortaya çıkardığı gerçek kusur — kota eksik sayılıyordu.** Bağlam sıkıştırma/özetleme istekleri `resolveCompressionModel.ts` içinde `executor.languageModel(...)` ile çıplak bir `LanguageModel` üzerinden gidiyordu; `createLanguageUsageMiddleware` takılı olmadığı için `aiUsageRecord`'a **hiç satır yazmıyorlardı**. Oysa bu istekler sohbet turuyla **aynı API anahtarını harcıyor** (`resolveSdkConfig` gerçek kimlik bilgisini bağlıyor). Sonuç: `apiKeyQuota.ts` anahtarın kullanımını gerçeğin altında sayıyordu → kota tablosundaki "kalan" yanlış, `filterKeysWithinQuota` tükenmiş anahtarı hâlâ uygun görüyor, otomatik geçiş onu atlamıyordu. Bu forkun asıl vaadini (sınırlı anahtarları doğru dağıtmak) doğrudan deliyordu. Ayrıca `billingHook.ts`'teki `AI_USAGE_RECORD_OPERATION_COVERAGE` zaten `generateText: status 'recorded'` diye iddia ediyordu — kod kendi belgesini yalanlıyordu. Düzeltme: `resolveSdkConfig`'in zaten döndürdüğü (ama atılan) `credentialReceipt` tutuluyor ve model her zaman `wrapLanguageModel` ile sarılıyor — usage middleware hep takılı, `conversationHeader` varsa ayar middleware'i yanına ekleniyor. Tek dosya; `resolveRequestContextSettings` üzerinden hem in-loop hem durable sıkıştırma yolunu birlikte kapatıyor. `source` bilerek `null`: bu katman konuşmayı bilir, hangi asistanın sahibi olduğunu bilmez — R10 panelinde "unattributed" olarak görünür, uydurma bir kaynak yazılmadı. Yeni regresyon testi (`resolveCompressionModel.test.ts`, 11 test yeşil) gerçek `generateText` çağırıp `recordInvocation`'ın doğru anahtar/sağlayıcı/token ile çağrıldığını doğruluyor; **düzeltme stash'lenerek kırmızı olduğu kanıtlandı**. `typecheck:node` temiz, derlendi, uygulama `Bootstrap complete (663.778ms)` ile açıldı, açılış penceresinde `level:error` yok. **Doğrulanamayan:** çalışan bir sağlayıcı anahtarı olmadığı için gerçek bir sıkıştırma turu tetiklenip satırın veritabanına düştüğü canlı görülmedi |
| **R11** | ✅ | **Cevap dili kilidi, asistan bazında.** Yeni alan: `settings.replyLanguage` (`AssistantSettingsSchema`, var olan JSON sütunu — **yeni migrasyon yok**), `contextSettings`'teki "boş=kalıtım, `null`=temizle" deseni aynen tekrarlandı. Liste **uydurulmadı**: seçenekler `appLanguageOptions`'tan (`src/renderer/i18n/languages.ts`, uygulamanın kendi 13 dilli görünüm-dili seçicisiyle aynı liste) geliyor, ayrı bir dil listesi yazılmadı; varsayılan hep **Otomatik** (unset) — hiçbir asistan otomatik bir dile kilitlenmiyor. **Yazıcı+okuyucu+ekran üçü de var:** Asistanı Düzenle→Model sekmesinde "Yanıt dili" seçici (Akışlı çıktı ile Maksimum araç çağrısı turu arasında) → `AssistantService.update`'in zaten yaptığı `{...current.settings, ...patch}` sığ birleşimiyle satırına yazılıyor → `assembleSystemPrompt` asistanın kendi sistem isteminin hemen ardından "Always reply in {dil}" (İngilizce ad, `languageEnglishNameMap`) satırını ekliyor — modelin gördüğü gerçek metin bu. Bilinen tuzak (`strictObject` alanı sessizce düşürme, B2/R9'da iki kez yaşanmıştı) burada **yaşanmadı**: `UpdateAssistantSchema.settings`, `AssistantSettingsSchema.partial()`'dan türediği için yeni alan ek şema değişikliği gerekmeden aktı. Arayüz metni bir *istek* olarak yazıldı ("modele ... cevap vermesini ister"), garanti gibi sunulmadı. 5+3 yeni birim testi (`assistantForm.test.ts`, `assembleSystemPrompt.test.ts`) + `EditDialogs.test.tsx`'e 2 uçtan uca etkileşim testi (gerçek Radix Select açılıp "Türkçe" seçiliyor, PATCH gövdesi doğrulanıyor), `typecheck:node`/`typecheck:web` temiz. 3 yeni i18n anahtarı 12 dile çevrildi; çeviri alt ajanı fr-fr'de **ilgisiz** iki satırın tırnağını (düz→kıvrık) değiştirmişti, elle geri alındı — `git diff --stat` sonrasında her dilde tam 3 satır, encoding taraması temiz. **Derlenmiş sürümde CDP ile uçtan uca doğrulandı:** Asistanı Düzenle→Model'de alan gerçekten görünüyor, açılan liste Otomatik + 13 dili kendi yazılarıyla gösteriyor, "Türkçe" seçilip dialog kapatılıp yeniden açıldığında değer kalıcı, "Otomatik"e geri almak da kalıcı. `Bootstrap complete`, oturum boyunca yeni `level:error` yok (günlükteki tek hatalar önceden var olan `RegionService` ağ zaman aşımı ve bu profildeki eski başarısız bir mesajın tetiklediği `errorDiagnosis`/CherryAI oto-teşhisi — ikisi de bu değişiklikten önce de vardı). **Doğrulanamayan:** modelin talimata gerçekten uyup uymadığı — bu profilde çalışan sağlayıcı anahtarı yok, CherryAI bu forkta hep başarısız; enjeksiyonun sistem istemine doğru eklendiği yalnızca birim testiyle kanıtlı |
| **Y1** | ✅ kısmi | **Denetim önce: görsel modeller B6/B7'ye zaten bağlıydı, kanıtlanmamıştı — video hiç bağlı değil.** `imageGenerationJobHandler.ts` ve `AiService.ts`'teki senkron `generateImage` yolu ikisi de `resolveProviderAiSdkConfig → selectApiKey → providerService.resolveApiKey(providerId, override, model.id)` zincirinden geçiyor — `filterKeysWithinQuota` model kimliğiyle çağrılıyor, yani model bazlı limit (`apiKeyModelLimitId`) görsel istekler için **zaten** uygulanıyordu. Kullanım da zaten kaydediliyor: `billingHook.ts`'in iddia ettiği gibi, `imageCount = urls.length` ile istek başına bir satır. B6'nın kota tablosu (`QuotaOverviewTable.tsx`) ve limit düzenleyicisi (`ApiKeyQuotaLimit.tsx`) satırı sağlayıcı×anahtar(×model) kimliğinden türetiyor, modaliteye hiç bakmıyor — bir görsel modele limit koyarsan satır zaten çıkar. B7'nin pasiflik/kalan-hak rozeti de (`modelAvailability.ts`) Paintings'in kendi seçicisinde (`PaintingModelSelector.tsx`) **aynı** paylaşılan `ModelSelector`/`useModelSelectorData`'dan geçiyor — Paintings sadece `filter={supportsImageGenerationEndpoint}` ekliyor, ayrı kod yolu yok. Yani Y1'in görsel kısmı kod olarak zaten bitmişti, hiçbir yerde doğrulanmamıştı. **Yapılan:** bunu kanıtlayan 4 yeni test. `useModelSelectorData.test.ts`'e 2 vaka — görsel-üretim yetenekli bir model gerçek `usePreference('chat.routing.api_key_limits')`/`useQuery('/ai-usage-records/stats')` kablolamasından `quota_exhausted`'a ve doğru kalan-hak sayısına düşüyor. `ModelSelector.test.tsx`'e 2 vaka — aynı model rozetleniyor VE hâlâ seçilebiliyor (elle seçim kazanır, hiç reddedilmez). Dördü de kaynağı geçici olarak bozup kırmızı olduğu görülüp geri alınarak doğrulandı; kaynakta hiçbir satır değişmedi — `git diff --stat` sadece iki test dosyasını gösteriyor. **Video'ya bilerek dokunulmadı:** `videoGenerationJobHandler.ts` hiçbir zaman `aiUsageRecordService.recordInvocation` çağırmıyor, `AiUsageRecordModalitySchema`'da (`src/shared/data/types/aiUsageRecord.ts`) `'video'` diye bir modalite hiç yok — eklemek `aiUsageRecord` tablosunun CHECK kısıtını değiştirecek yeni bir migrasyon ister, bu da görevin "migrasyon zinciri" dur-ve-bildir kalemine giriyor. Üstüne `resolveApiKey(providerId)` video'da **modelId'siz** çağrılıyor (model bazlı limit hiç görülmüyor), ve ekran (`VideoPage.tsx`) sadece başlık basan bir taslak — model seçici yok, üret düğmesi yok. Yazıcı yok, ekran yok; bu ikisi olmadan kota tablosunda video satırı göstermek her zaman "0 kullanıldı" yalanı olurdu, o yüzden video satırı eklenmedi. **Kota birimi soru:** mevcut mekanizma her yerde **istek** sayıyor (`metric: 'requests'`), görsel dahil — `imageCount` (üretilen görsel sayısı) kayıtta ayrı bir alan olarak duruyor ama hiçbir tavan/gösterge onu okumuyor; bunu değiştirmek B1-B7'nin tamamının temelini genişletmek olurdu, yapılmadı, sütun başlıkları hâlâ doğru (hiçbir yerde istek sayısı "görsel" diye etiketlenmiyor). **Bulunan ama dokunulmayan önceden var olan hata:** model bazlı limitin "kullanılan" sayısı hâlâ `groupBy:'apiKey'` ile hesaplanıyor (`apiKeyQuota.ts`, `useModelSelectorData.ts`, `ApiKeyQuotaLimit.tsx`, `QuotaOverviewTable.tsx`'in dördünde de) — B4'ün eklediği `apiKeyModel` groupBy'ını hiçbiri kullanmıyor, yani bir anahtar hem sohbet hem görsel modelde kullanılıyorsa görsel modelin model-bazlı rozetine sohbetin kullanımı da karışır. Y1'den önce vardı, görsele özel değil, dört dosyaya yayılan ayrı bir iş — bulundu, dokunulmadı. `ModelSelector` dizininin tamamı (8 dosya, 78 test) yeşil, `typecheck:node`/`typecheck:web` temiz. Derlenmiş sürüm `Bootstrap complete (603.961ms)` ile hatasız açıldı, tek hatalar bilinen CherryAI hataları. **Doğrulanamayan:** bu profilde gerçek görsel-üretim sağlayıcısı/anahtarı yok; Paintings ekranında kota rozetinin canlı görünümü CDP ile denenmedi — kaynakta değişiklik olmadığı için (sadece test eklendi) ekranda görülecek yeni bir şey de yoktu |
| **B-fix** | ✅ | **Y1 denetiminden çıkan kritik kusur — kota ekranının tamamı boştu.** `/ai-usage-records/stats` toplama sorgusunun `limit` tavanı `AI_USAGE_RECORD_AGGREGATE_MAX_LIMIT = 50`; Faz B'de yazdığım beş çağrı yeri ise `limit: 100` gönderiyordu. Uç nokta bunu `.parse` ile doğruluyor (`src/main/data/api/handlers/aiUsageRecords.ts`), yani sorgu **yumuşak düşmüyor, fırlatıyor** — `Too big: expected number to be <=50` (şema üzerinde birim testle kanıtlandı). Sonuç: model seçicideki kalan-hak rozetleri ve `quota_exhausted` pasifliği, kota tablosu (`QuotaOverviewTable`), yönlendirme ipucu (`RoutingDestinationHint`) ve kota bildirimleri (`useQuotaNotifications`) — hepsi **sessizce boş** geliyordu. Yani kullanıcının 4 numaralı şikâyeti ("hangi anahtarda kaç hak kaldığı görünmüyor") Faz B bitmiş görünmesine rağmen hâlâ çözülmemişti. Daha kötüsü: ana süreçteki `apiKeyQuota.ts` servisi doğrudan çağırıyor, şema doğrulamasından geçmiyor, o yüzden **uygulama tarafı çalışıyordu** — yönlendirme ekranın gösteremediği bir kotayı uyguluyordu, yani aynı veriye iki farklı kural. Düzeltme: beş çağrı yerinde sabit `100` yerine dışa aktarılmış `AI_USAGE_RECORD_AGGREGATE_MAX_LIMIT` kullanılıyor. Yeni test (`useModelSelectorData.test.ts`) kancanın ürettiği sorguyu **gerçek şemadan geçiriyor** — sabit `100`'e geri döndürülünce kırmızı olduğu kanıtlandı. `ApiKeyQuotaLimit.tsx` zaten 50 gönderdiği için etkilenmemişti. 130 + 9 test yeşil, iki tip kontrolü temiz, uygulama `Bootstrap complete (617.478ms)` ile açıldı. **Doğrulanamayan:** bu profilde kayıtlı kullanım yok, dolayısıyla sütunların dolu hâlini ekranda göremedim — sorgunun artık kabul edildiği kanıtlandı, gösterdiği sayı değil |
| **B-fix2** | ✅ | **Model bazlı limitler anahtar geneli kullanımı sayıyordu — dalın adını taşıyan özellik yanlış çalışıyordu.** `resolveKeyLimit` model bazlı tavanı doğru seçiyordu ama karşılaştırdığı kullanım `groupBy: 'apiKey'` sorgusundan geliyordu, yani o anahtardaki **bütün modellerin** istekleri. "key-1'de gemini-flash için günde 50" dersen, aynı anahtarla başka bir modele atılan 50 istek onu tüketiyordu. Aynı kusur arayüzde de vardı (`modelAvailability.ts` anahtar geneli sayımı model bazlı tavandan çıkarıyordu). B4 `'apiKeyModel'` gruplamasını eklemişti ama hiçbir tüketici ona geçmemişti. Düzeltme: tek sorgu `groupBy: 'apiKeyModel'` ile atılıyor, paylaşılan `collectKeyUsage` ondan iki görünüm türetiyor — (anahtar, model) çifti başına sayım model bazlı tavanlar için, modeller toplanarak anahtar geneli sayım anahtar bazlı tavanlar için. `resolveScopedKeyLimit` hangi kapsamın kazandığını da döndürüyor, böylece sayım her zaman tavanla aynı kapsamda okunuyor; eski `resolveKeyLimit` ona devrediyor, öncelik mantığı tek yerde kalıyor. **Kova tavanı kararı:** `apiKeyModel` gruplaması kova sayısını (anahtar × model) katlıyor ve tavan 50; sunucu fazlasını "other" olarak döndürüyor. Bu durumda listede olmayan bir çift **sıfır değil, bilinmeyen** sayılıyor (`usageAgainstLimit` `undefined` dönüyor) — uygulamada anahtar tutuluyor (istek reddedilmez, sağlayıcının reddetmesi yeğdir), ekranda ise rozet "bilinmiyor" oluyor; ikisi de zaten var olan durumlar, yeni bir hâl uydurulmadı. Dört tüketici güncellendi: `apiKeyQuota.ts`, `modelAvailability.ts` + `useModelSelectorData.ts`, `ApiKeyQuotaLimit.tsx`, `RoutingDestinationHint.tsx` (bu sonuncusu model bazlı tavanı çözen `getRemainingQuota`'yı çağırdığı için zorunluydu). `QuotaOverviewTable` ve `useQuotaNotifications` model bazlı tavan çözmüyor, `apiKey` gruplamasında bırakıldı. Dört mutasyon testiyle doğrulandı: model bazlı sayımı anahtar geneline çevirince ve bilinmeyeni tükenmiş sayınca ilgili testler kırmızı. Ayrıca **kendi testimin zayıf olduğunu mutasyon yakaladı** — `filterKeysWithinQuota` hepsi tükenince girdiyi olduğu gibi döndürdüğü için tek anahtarlı bir liste "tutuldu"yu "düşürüldü"den ayırt edemiyordu; ikinci anahtar eklendi. Y1'in iki testi eski anlamı kodluyordu (model bazlı tavana `apiKey` kovası), düzeltildi. 779 + 810 + 81 test yeşil; `src/main/data/services` 46 kırmızısı stash'lenerek **önceden var olduğu kanıtlandı** (better-sqlite3 / `NODE_MODULE_VERSION`). Uygulama `Bootstrap complete (823.452ms)` ile açıldı, pencerede `level:error` yok. **Bulundu, düzeltilmedi (kapsam dışı):** uygulama tarafı `periodStartOf(limit.period)`'u anchor/timezone olmadan çağırıyor, `ApiKeyQuotaLimit.tsx` ise geçiriyor — kullanıcının seçtiği yenilenme günü uygulamada onurlandırılmıyor. **Doğrulanamayan:** bu profilde kayıtlı kullanım yok, sayıların dolu hâli ekranda görülmedi |
| **B-fix3** | ✅ | **Kullanıcının seçtiği yenilenme gününü ekran onurlandırıyordu, yönlendirici görmezden geliyordu.** `ApiKeyQuotaLimit.tsx` dönem başlangıcını anahtarın kendi `renewalAnchor`/`renewalTimezone` değerleriyle hesaplıyor; ana süreçteki `keysWithinQuota` ise `periodStartOf(limit.period)` diyerek takvim varsayılanını kullanıyordu. Yani ayarlarda "ayın 15'inde yenilenir" yazan bir tavan, ekranda 15'inde sıfırlanıyor ama yönlendiricide ayın 1'inde sıfırlanıyordu — B-fix ve B-fix2 ile kapattığım "aynı veriye iki farklı kural" ayrışmasının aynısı. Düzeltme: sayım her anahtarın kendi yenilenme günü ve saat diliminden başlıyor. **Yan sonuç önemliydi:** sayım önbelleği döneme göre anahtarlanıyordu (`Map<period, counts>`), oysa iki anahtar aynı anda "aylık" olup **farklı günlerde** yenilenebilir — o yüzden önbellek artık hesaplanan başlangıç zamanına göre anahtarlanıyor, yoksa ikinci anahtar birincinin penceresini okurdu. Tip imzaları (`keysWithinQuota` ve `isProviderOutOfQuota`) yenilenme alanlarını da alacak şekilde genişletildi; alanlar isteğe bağlı olduğu için yalnızca `id` taşıyan çağrılar bozulmadı ve anahtar taşımayan veride davranış aynen eskisi gibi kalıyor. İki yeni test **takvim gerçeğini** doğruluyor (sorgulanan `from` değerinin ayın günü 15, varsayılan 1 değil) — uygulamanın hesapladığı şekilde yeniden türetilmiş bir beklenti değil. İki mutasyonla kanıtlandı: anahtar yok sayılınca iki test de kırmızı, önbellek tek gözlü yapılınca farklı-günler testi kırmızı. 15 + 678 test yeşil, iki tip kontrolü temiz, uygulama `Bootstrap complete (602.963ms)` ile açıldı. **Yanlış alarm:** `apiKeyModel` kovasının `apiKeyMasked`/`apiKeyAttribution` taşımadığını görüp tip-çalışma zamanı uyuşmazlığı sandım; `toStatsGroupIdentity` okununca tipin çalışma zamanıyla birebir uyuştuğu, iki kovanın kimlik alanlarının bilerek farklı olduğu görüldü — değiştirdiğim tüketicilerin hiçbiri o alanları okumuyor. **Doğrulanamayan:** bu profilde kayıtlı kullanım yok, yenilenme gününün ekrandaki etkisi canlı görülmedi |
| **U6 (2/2)** | ✅ | `416c4e2` — `TopicService.delete` artık gerçek DELETE yerine `deletedAt` yazıyor; mesajlar/etiketler korunuyor, pinler temizleniyor. Yeni uçlar: `/topics/trash` (listele+boşalt), `/topics/trash/:id` (kalıcı sil), `/topics/:id/restore`. `TopicTrashPurgeService` 30 günü geçenleri açılışta ve 24 saatte bir temizliyor. Ayarlar→Veri'de "Konu Çöp Kutusu" paneli: isim + silinme tarihi + Geri Yükle + Kalıcı Sil + Çöp Kutusunu Boşalt. 12 dile çevrildi |
| **R12** | ✅ | **Taslak koruma — 4 kayıp yolu tek tek denetlendi: üçü zaten korumalıydı, biri gerçek boşluktu.** `chatDraftCache.ts`'in (`chat.composer_draft.${topicId}`, renderer memory tier) her okuma/yazma noktası izlendi. (1) **Gönderim başarısız** (sağlayıcı hatası/401/429/ağ): `ChatComposer.tsx`'teki `handleSendDraft`/`sendQueuedPayload` metni iyimser temizlemiyor — `clearCurrentDraft()` yalnız gönderim `true` dönünce çalışıyor, reddedince metin ekranda ve zaten önbellekte kalıyor — korumalıydı. (2) **Akış durduruldu/sıradaki takip mesajı:** taslak gönderilmiş bir mesaj değilse dokunulmuyor; meşgulken kuyruğa alınan takip (`useFollowupQueue`) drenaj başarısız olursa kuyruktan düşmüyor — korumalıydı. (3) **Konu/asistan değişimi:** `persistFinalDraft` (unmount cleanup, konu değişince `key={draftCacheScopeKey}` ile tetikleniyor) canlı editör içeriğini geçişten önce yazıyor — korumalıydı. (4) **Uygulama kapandı/çöktü — gerçek boşluk:** `cacheSchemas.ts`'in kendi yorumu doğruluyordu: taslak **renderer memory tier**, yeniden başlatmada tamamen siliniyor (`agent.composer_draft.*`'ta da aynı boşluk var, dokunulmadı — kapsam dışı). `docs/references/data/README.md`'nin "Composer drafts" notu bu tetikleyiciyi zaten öngörmüştü ("move to a broader owner only when recovery... is a real requirement"). **Düzeltme:** yeni sabit persist anahtarı `chat.composer_draft_snapshot` (`Record<topicId, draft>` — persist tier şablon anahtar desteklemediği için `Record`, `MainPersistCacheSchema`'daki `window.bounds` ile aynı desen). `writeChatDraftCache` her yazımda bu kaydı da güncelliyor, taslak boşalınca konu kendi anahtarını siliyor (sınırsız büyümüyor); `readChatDraftCache` memory tier boşsa (bu konu bu oturumda hiç yazılmamış — yeniden başlatmanın imzası) persist'e düşüyor. `ChatComposer.tsx`'e **dokunulmadı** — üç çağrı noktası da aynı imzalı fonksiyonları zaten çağırıyordu. 4 yeni birim testi (`chatDraftCache.test.ts`, toplam 9, biri düzeltmeden önce gerçekten kırmızı olurdu), `oxlint`/`eslint` ve `typecheck:node`/`typecheck:web` temiz. **Derlenmiş sürümde CDP ile uçtan uca doğrulandı** (ilk deneme geçersizdi: `location.reload()` uygulamanın kendi `file://` gezinme koruması tarafından engelleniyor, bunu bir `window` sentinel'inin hayatta kalması ele verdi; ikinci deneme **tam süreç kapat+aç** ile yapıldı): gerçek bir konuya taslak yazıldı, süreç `Bootstrap complete` ile hatasız kapatılıp yeniden açıldı (yeni CDP hedef kimlikleri + sıfırlanmış sentinel = gerçek yeniden başlatma kanıtı), composer taslağı **aynen geri geldi**; ardından temizlenince snapshot'ın `{}`'e döndüğü de doğrulandı. Test verisi temizlendi. **Doğrulanamayan:** yok — dört yol da hem kodda hem çalışan uygulamada doğrulandı **İncelemede bulunan eksik (ana oturum düzeltti):** kalıcı anlık görüntünün kendi süresi yoktu, aynadığı bellek katmanının ise 24 saatlik `DRAFT_CACHE_TTL`'si var. Sonuç iki taraflıydı: (1) 24 saat dolup bellek kaydı düştükten sonra `readChatDraftCache` kalıcı kopyaya düşüyor ve **süresi geçmiş taslağı geri diriltiyordu** — üstelik her açılışta yeniden, yani TTL fiilen anlamsızlaşıyordu; (2) bu kaydı başka hiçbir şey budamıyor, bu yüzden içinde yazı varken silinen bir konunun taslağı localStorage'da **sonsuza dek** kalıyordu. Düzeltme: her girdi `savedAt` taşıyor, okuma TTL'yi geçmiş girdiyi yok sayıyor, her yazma da süresi geçmişleri süpürüyor — tek kural, iki katman. İki yeni test **mutasyon testiyle** doğrulandı (iki koruma da kaldırılınca ikisi de kırmızı, geri konunca yeşil); 11 test + `composer/variants` ve `CacheService` dizinleri (25 dosya, 483 test) yeşil, `typecheck:web`/`typecheck:node` temiz, uygulama `Bootstrap complete (591.606ms)` ile açıldı (yalnız bilinen CherryAI hataları) |

### ✅ Ekranda doğrulandı (derlenmiş sürüm, 2026-09-19)

Uygulama açıldı, `Bootstrap complete (767 ms)`, tek hata `TrayService` (önceden var olan).
Ekran görüntüleriyle teyit edilenler:

- **Kota bölümü** (Ayarlar → Kullanım Analizi) — boş durumu dahil, Türkçe
- **Model seçicide pasif rozetleri** — ⚠ "API anahtarı yok" DeepSeek modellerinde
- **Oto geçiş düğmesi** — composer'da, ipucu metniyle
- **"6 başarısız olanları devre dışı bırak"** — silme yerine devre dışı bırakma değişikliği

**Uygulamayı çalıştırmanın yakaladığı, testlerin yakalamadığı iki hata:**

1. `GET /ai-usage-records/stats` kota limiti tanımlı değilken **sorgusuz** gönderiliyordu ve her
   model seçici açılışında doğrulama hatası logluyordu. `useQuery` seçenek verilmezse isteği
   **atar** — `undefined` geçmek "atma" demek değil, `{ enabled: false }` gerekiyor. Üç çağrı
   yerinde aynı hata vardı. Tip kontrolü, testler ve derleme hepsi yeşildi. (`79ef264`)
2. **Sağlayıcı sınırsız anahtar kabul ediyor ama giriş görünmüyordu.** Maskelenmiş anahtar
   yazısının kendisi düğmeydi, hiçbir işaret yoktu; sayı rozeti de yalnızca 1'den fazla anahtar
   varken çıkıyordu — yani ipucuna en çok ihtiyaç duyulan tek-anahtar durumunda hiç. Artık her
   sağlayıcıda her zaman "N anahtar ›" görünüyor. `ApiKey.tsx` tek ve ortak bileşen, yani
   değişiklik bütün sağlayıcılarda geçerli.

### ⚠️ Depoda önceden var olan, bize ait OLMAYAN hatalar

Bunları kendi değişikliğinin sonucu sanma. İkisi de bu oturum başlamadan önceki commit
(`2ad61dc`) tertemiz haldeyken de başarısız — doğrulandı:

1. **`pnpm i18n:check` — 35 hata.** Hepsi `el-gr` ve `ru-ru`'daki eski anahtarlarda,
   "şüpheli uzunlukta — açıklama gibi, çeviri değil" uyarısı.
2. **`TopicNamingService.test.ts` — 7 hata.** `recognizes localized default agent session name`
   testleri; Latin olmayan/aksanlı diller (zh-cn, zh-tw, ja-jp, el-gr, ru-ru, ro-ro, vi-vn)
   için `updateSession` çağrılmıyor. Latin/ASCII diller geçiyor.

| **Y2** | ✅ | Ücretsiz görsel sağlayıcı kataloğu. `src/shared/data/presets/freeImageProviders.ts` — Google (Gemini Vision), Alibaba (Tongyi Vision), Ideogram, Kling free-tier image generation. Fonksiyonlar: `isFreeImageAccessProvider()`, `freeImageAccessKindOf()`. F1'in görsel versiyonu. Mekanik veri, i18n/test yok. `80d2c04f` |
| **Z2** | ✅ | Havuzlanmış kota görüntüleme. `QuotaOverviewTable.tsx` satırları sağlayıcı + yenileme dönemine göre gruplandı, her grup başlığında havuz toplamları (limit/kullanılan/kalan). Açılır/kapanır detaylar sağlayıcıdaki anahtarları gösteriyor, her satırdaki limit artırma/azaltma korunuyor. İçinde `togglePoolExpanded`, `PoolGroup` interface'i, `poolGroups` useMemo. Test dosyası `QuotaOverviewTable.test.tsx` (2 vaka). Yeni i18n anahtarı `settings.usage.quota.pool_source_count` (12 dile çevrilmeli). `cf88c54d` (Z2 sorunu) + `c1e439d6` (ProviderProxySettings TextField→Input düzeltmesi, bloklanmayı çözmek için). Uygulama `Bootstrap complete` ile hatasız açıldı. Çeviriler yapılmadı — `pnpm i18n:sync` placeholder'ları ekledi, `i18n-translator` ajanına verilecek. |
| **Z7** | ✅ | Sağlayıcı keşif kataloğu. `src/shared/data/presets/providerModelCatalog.ts` — kanonik model × sağlayıcı eşlemeleri, ücretsiz tier statusu, kayıt URL'leri. `ProviderModelCatalogEntry` interface (modelId, providerId, hasFreeAccess, apiModelId, signupUrl). Veri: DeepSeek, Claude, Gemini, Qwen, Llama gibi ana modeller (placeholder kanonik kimlikler). Fonksiyonlar: `getFreeAccessProvidersForModel`, `getCanonicalModelsFromProvider`, `getSignupUrlForModel`. Test dosyası (9 vaka): geçerli girişler, benzersizlik, eksik sağlayıcı/model. `51989e34`. **Not:** Z1 (model denklik haritası) yapılmadığı için kanonik model kimlikleri placeholder; Z1 tamamlandığında güncellenecek. |

**Sonraki sırada:** Z4 bloke (Z1'e bağlı). Diğer: L4, L6, L7, P6 veya başka.

### Model değişirse: hangi maddeye başlanır, hangisine başlanmaz

Bu oturumu Opus yürüttü. Model küçültülürse (Sonnet/Haiku) tahmin yürütme, buraya bak.

**Küçük modelle güvenli** — sınırları belli, mevcut deseni taklit etmek yetiyor:
`U6` · `U2` · `W1` · `W3` · `Q` maddeleri · kalan `P` maddeleri · `L4` `L6` `L7` `L10` ·
`Z2` `Z4` `Z5` `Z6` `Z7` `Z8` · `S4` `S5` `S7` · `R7` `R9` `R10` `R11` `R12` · `Y1` `Y2` · i18n işleri.

**Başlama, söyle ve dur** — çok dosya, ince değişmezler, hassas alanlar:
`F2` (adaptör motoru) · `G2` `G3` · `I` · `K2` `K3` · `L5` · `O1` `O4` · `R2` `R3` `R5` ·
`S1` `S2` `S3` · `T1` `T2` · `X1` · `Z1` `Z3` · `U5` (anahtar şifreleme — göç işi, yanlış yapılırsa
kullanıcı kendi anahtarlarına erişemez).

**Neden bu ayrım:** bu oturumda değer üreten şeylerin çoğu kod yazmak değildi — W2'de sözlüğün
zaten var olduğunu görüp asıl boşluğu başka yerde bulmak, ücretsiz katman sayılarını *uydurmamaya*
karar vermek, yeşil "Kurulu" tikinin yalan söylediğini fark etmek, model seçicisini kotaya göre
yeniden sıralamayı reddetmek. Küçük modelin riski kod yazamamak değil, **planın yazdığını harfiyen
yapıp planın yanlış olduğunu fark etmemek**. Yukarıdaki ikinci listede plan yanlışsa bedeli ağır.
R1'in otomatik yarısı, D (baş kontrolcü).

---

## Faz A — BİTTİ ✅

| # | İş | Durum |
|---|---|---|
| A1 | Yeniden gönder güncel modeli kullanır | ✅ `useChatWriteActions.ts` — `canRetryInPlace` artık `assistant.modelId === target.metadata.modelId` şartını arıyor; farklıysa normal regenerate yoluna düşüyor |
| A2 | Yeniden gönder takılmaz | ✅ `AiStreamManager.awaitExecutionRetry` 60 sn sınırlı (`settlesWithin` + `EXECUTION_NOT_READY`); `prepareAssistantRetry` hata anında `markMessagesError` ile satırı `error`'a döndürüyor |
| A3 | Seçicide pasif satırlar | ✅ `modelAvailability.ts` (yeni); pasifler ⚠ + soluk + en altta ama **yine seçilebilir**; ayarlardaki "çalışmayanları sil" artık **devre dışı bırakıyor** |

**CherryAI/Qwen bu forkta asla çalışamaz.** `src/main/ai/provider/cherryai.ts:9` imzayı derleme
zamanı sırrı `MAIN_VITE_CHERRYAI_CLIENT_SECRET` ile atıyor, o sır sadece resmi derlemelerde var.
Sağlayıcı ve varsayılan modeli kod tarafından kilitli (`assertManagedCherryProviderMutationAllowed`,
`assertManagedCherryAiDefaultModelMutationAllowed`), ayar listesinde de gizli. A3 onu listenin dibine
indirdi — yapılabilecek tek şey buydu.

**Bilinen ve bana ait olmayan sorun:** `pnpm i18n:check` şu an 35 hatayla kırmızı. Hepsi el-gr ve
ru-ru'daki eski anahtarlarda ("şüpheli uzunlukta" uyarısı), üst projeden geliyor. Faz A bunlara
dokunmadı. Opus kendi değişikliğini doğrularken bu 35'i kendi hatası sanmasın.

---

## Faz B — Kota ve anahtar yönetimi

### Zaten var (yeniden yazma)

- `chat.routing.api_key_limits` tercihi: `Record<string, {limit, period}>`, anahtar
  `` `${providerId}::${keyId}` `` (`src/shared/data/preference/preferenceTypes.ts:48`).
- `src/main/data/services/apiKeyQuota.ts` — `filterKeysWithinQuota`, `isProviderQuotaExhausted`.
- `AiUsageRecordService.ts` + `src/main/data/db/schemas/aiUsageRecord.ts` — her çağrı için
  `requestId, providerId, modelId, apiKeyId, apiKeyLabel, apiKeyAttribution`, token, maliyet.
  **Yeni tablo gerekmez.**
- **Bir sağlayıcı sınırsız anahtar tutuyor:** `src/main/data/db/schemas/userProvider.ts:62`
  `apiKeys: json ApiKeyEntry[]`, her biri `id`/`isEnabled`/`label`. Sayı sınırı **yok**.
- Anahtar başına kota UI'ı: `ProviderSettings/ConnectionSettings/ApiKeyQuotaLimit.tsx`.

### B1 — Aynı model için birden çok anahtar, ayrı ayrı limitli ✅

> *"DeepSeek V4 Flash'tan elimde 2 API anahtarı var, ikisini de aynı anda girebileyim,
> limitlerini de ona göre ayarlayabileyim."*

Altyapı hazır (anahtar dizisi sınırsız). Yapılacak:
- Limit kimliği model düzeyine iner: `` `${providerId}::${keyId}::${modelId}` ``.
  Tip `Record<string, …>` olduğu için **kod üretimi gerekmez**; mevcut okuyucular tanımadıkları
  kimliği yok sayar. Kimlik üreteci `src/shared/utils/apiKeyLimit.ts` içinde `apiKeyLimitId` yanına.
- Arama sırası: model-özel limit → anahtar limiti → limitsiz.
- UI: bir sağlayıcının anahtarları **yan yana** listelenir, her satırda o anahtarın kendi limiti
  ve kalanı görünür. İki DeepSeek anahtarı iki ayrı satır, iki ayrı limit.

### B2 — Ücretli / ücretsiz / deneme anahtarı ✅

> *"ücretli API girerim, ücretsiz API girerim"* · *"bazı ortaklaşa API veren siteler var, deneme
> bir veri, Opus 5'ten 10 kullanım hakkı diyelim"*

`ApiKeyEntry`'ye iki alan (JSON sütunu olduğu için **migrasyon gerekmez**, sadece zod + UI):
- `tier?: 'free' | 'paid' | 'trial'` — varsayılan `'free'`.
- Dönem türüne **`'total'` eklenir**: `period: 'daily' | 'monthly' | 'total'`.
  `'total'` = hiç sıfırlanmayan tek seferlik hak havuzu — "Opus 5'ten 10 kullanım" tam olarak bu.
  (`preferenceTypes.ts` üretilmiyor, union doğrudan genişletilir.)

Kullanımı:
- `'trial'` + `'total'`: bitince o anahtar kalıcı olarak tükenmiş sayılır, pasife düşer (B7).
- Faz C'deki otomatik geçiş sırası: **ücretsiz → deneme → ücretli**. Ücretli en son harcanır.

### B3 — Yenileme dönemi: takvim + üyelik yıldönümü ✅

İki sorun var, ikisi de çözülecek.

**(a) Mevcut çelişki.** `apiKeyQuota.ts:13-31` kayan pencere sayıyor (`şimdi−24s` / `şimdi−30g`),
arayüz `ApiKeyQuotaLimit.tsx:50-61` "yarın UTC gece yarısı" diyor. Takvim dönemi seçilir:
`periodStartOf(period)` yardımcısı (`'total'` için sıfırlama yok); `apiKeyQuota.ts`,
`ApiKeyQuotaLimit.tsx:13,36`, `src/main/data/services/__tests__/apiKeyQuota.test.ts` güncellenir.

**(b) Her sağlayıcı ayın 1'inde yenilemiyor.** Ücretsiz katmanların çoğu **üyelik tarihinde**
yeniliyor — 17'sinde kaydolduysan her ayın 17'sinde. Bazıları haftalık, bazıları sabit bir
saatte. Tek bir "ayın 1'i" varsayımı yanlış kalan hak gösterir.

`ApiKeyEntry`'ye eklenecek (JSON sütunu, **migrasyon gerekmez**):
- `renewalAnchor?: string` — ISO tarih; yenileme bundan sayılır (üyelik günü).
- `period` genişler: `'daily' | 'weekly' | 'monthly' | 'total'`.
- `renewalTimezone?: string` — bazı sağlayıcılar UTC değil kendi saatinde sıfırlıyor.

**Elle ayarlanabilir olacak** (kullanıcının isteği): B6 tablosunda her satırda "yenileme günü"
düzenlenebilir. P1 otomatik doldurmayı dener, tutmazsa sen düzeltirsin.
P4 tahmini ve B7 pasifliği bu tarihi kullanır.

### B4 — Kullanım sayımı model + sürüm kırılımıyla ✅

> *"DeepSeek dedim de, versiyonlarda olsun, hani şu sürüm bu sürüm diye."*

`AiUsageRecordGroupBySchema`'ya (`src/shared/data/api/schemas/aiUsageRecords.ts:82`)
`'apiKeyModel'` eklenir; `AiUsageRecordService.ts` içindeki üç switch (`groupIdentityColumns:392`,
`groupIdentitySelect`, `toStatsGroupIdentity:467`) genişletilir. Mevcut `/ai-usage-records/stats`
uç noktası ve `useQuery` kancaları aynen kullanılır. V3/V4 ayrı `modelId` olduğu için otomatik
ayrışır.

### B5 — Web/URL servisleri de sayılsın ✅

Yeni tercih `chat.routing.service_usage` — `Record<serviceKey, {count, periodStart}>`,
`serviceKey = ` `` `web::${providerId}` ``. Tavanlar aynı `api_key_limits` içinde (`web::exa`).
Sayaç tek noktadan: `src/main/services/webSearch/WebSearchService.ts:78` `executeCapability` —
arama, `fetchUrls`, 11 sürücü ve yedek yol hepsi buradan geçiyor. Faz F'teki web sağlayıcıları da
aynı sayacı kullanır.

### B6 — Tek kota tablosu ✅

> *"hangi API'den bağlı kaç hakkım var"* · *"DeepSeek OpenRouter 20 hak, DeepSeek SiliconFlow
> 15 hak"* · *"elle manuel artır/azalt yapabileyim"* · *"ayarlarda bir sınır olmasın, istediğim
> kadar API gireyim"*

`src/renderer/pages/settings/UsageSettings/UsageSettings.tsx` sayfasına yeni bölüm (yeni sayfa
açma). Tablo ilkeleri hazır: `UsageSettingsPrimitives.tsx`, `UsageEntriesTable.tsx`.

Satırlar: **sağlayıcı × anahtar × model**, ayrıca web servisleri için ayrı blok.
Sütunlar: tür (ücretsiz/deneme/ücretli) · dönem (günlük/aylık/toplam) · limit
(**satır içi +/− ile elle artır/azalt**) · kullanılan · kalan · yenilenme tarihi.

Anahtar ekleme akışında **sayı sınırı yok** — UI'da da sınır gösterilmez, "Anahtar ekle" hep açık.

### B7 — Kalan hak model seçicide ✅

> *"token bittiyse de pasif olsun, hangisinde kaç token var bilelim."*

`modelAvailability.ts`'e beşinci pasiflik nedeni: `'quota_exhausted'`. Ayrıca her satırda
**kalan hak rozeti**. Bu, A3'ün kota verisine bağlı olduğu için ertelenen parçasıdır.

---

## Faz C — Otomatik geçiş (varsayılan KAPALI)

- Tercih `chat.routing.auto_switch_enabled`, varsayılan `false`
  (`target-key-definitions.json` + generate; örnek: mevcut `chat.routing.pinned_model` ~:281).
- Düğme: `ChatComposer.tsx:1845` `sendAccessory` — `ModelSpeedControl` ("Default") ve gönder
  düğmesinin yanı (kullanıcının kırmızıyla işaretlediği yer).
- Bağlanma noktası: `readRetryPolicy()` (`src/main/ai/runtime/aiSdk/retry/retryPolicy.ts:17`).
  Kapalıyken `fallbackModelIds: []`; `buildFallbackModels.ts:81` boş listede erken çıkıyor.
  Aynı model üzerinde geçici hata tekrarı ve 401/429'da anahtar döndürme (model değişmez) sürer.
- **Kota tükenmesi gerçekten atlansın:** bugün sadece sıralamayı değiştiriyor
  (`deriveRoutingTable.ts:90` `quotaDelta`). `buildFallbackModels.ts:122` `resolveFallback` içine
  kota kontrolü; `buildApiKeyFallbackModels.ts:29` ham `getApiKeys({enabled:true})` yerine
  `filterKeysWithinQuota`. Sıra B2'den: ücretsiz → deneme → ücretli.
- Kurallar: `resolveModels(req.mentionedModelIds, …)` **hiç değişmez** (elle seçim kazanır);
  `filterKeysWithinQuota` hepsi tükendiğinde tüm anahtarları geri verir (istek reddedilmez);
  atlamalar yalnızca *isteğe bağlı* yedekleri eler.

---

## Faz D — Baş kontrolcü (dağıt–topla) — "abaküs" davranışı

> *"birkaç model seçiliyor orası kalsın, yanına bir baş kontrolcü gelsin, ona şunu yap deyince
> o diğerlerini çalıştırsın"* · *"abaküs gibi — otomatik alanında uzman en iyi yapana veriyor,
> elle de seçebiliyorsun"*

Seçili N model "işçi", ayrıca tek bir "kontrolcü". Kontrolcü görevi parçalar → işçilere **paralel**
dağıtılır → kontrolcü cevapları tek yanıtta birleştirir. Kullanıcı elle tek model seçerse bu atlanır.

**Neden yeni akış motoru değil:** çoklu model dağıtımı zaten var.
`PersistentChatContextProvider.prepareDispatch:315` `mentionedModelIds`'i N modele çeviriyor
(`context/modelResolution.ts:15`), tek `siblingsGroupId` açıyor (`:53`), tek işlemde 1 kullanıcı +
N asistan satırı yazıyor (`:411`), model başına `buildStreamRequest` kuruyor (`:479`). Renderer bu
grubu zaten çiziyor (`messageListItem.ts`, `useMessageSelectionController.ts`).

- **D1** `src/main/ai/orchestration/headController.ts` — saf modül, G/Ç yok:
  `buildBreakdownPrompt`, `parseBreakdown`, `buildMergePrompt`. Birim testi.
- **D2 Parçalama:** `prepareDispatch` içinde "3. Models" adımından önce, kontrolcü model üzerinde
  tek seferlik akışsız çağrı (`ai.text.generate`, `src/shared/ipc/schemas/ai.ts:174`).
  Alt görev metni mevcut `buildStreamRequest` döngüsüne (`:479-494`) model başına `history` olarak
  verilir — **yeni mesaj şekli yok**.
- **D3 Birleştirme:** mevcut tur zincirleme düzeneği — `AiStreamManager.ts:1416 chatChaining` →
  `:1423 scheduleNextChatTurn` → `:1683 startNextChatTurn`. `pendingSteers` yanına `pendingMerge`,
  `context/dispatch.ts`'e `'controller-merge'` tetikleyicisi, `prepareDispatch` içine
  `prepareControllerMerge` dalı.
- **D4 Arayüz:** `ChatConversationControls.tsx:150+` — `SelectedModelsTrigger` yanına
  `ModelSelector multiple={false}` ile kontrolcü seçici (kullanıcının maviyle işaret ettiği yer).
  Tercih `chat.routing.controller_model` (boş = kapalı).
- **İşçi havuzuna Faz F'teki web modelleri de girer** — kullanıcı web'deki AI'ı da işçi olarak
  seçebilir.
- **Asla reddetme:** `parseBreakdown` bozuk çıktıda `null`; parçalama hatası yutulur; `null` ise
  orkestrasyon atlanıp normal yol işler. Birleştirme başarısızsa işçi cevapları ekranda kalır.

---

## Faz E — "URL getirme sağlayıcısı" (kod yok, açıklama)

Ayarlar → Web Arama'daki **URL getirme sağlayıcısı** (Querit / fetch / Jina / Firecrawl)
**model eklemek için değildir**. Bir web sayfasının içeriğini indirip temiz metne çeviren servisi
seçer; sohbette bağlantı paylaşılınca veya web araması yapılınca kullanılır. Oraya URL yapıştırmak
Gemini'yi model yapmaz.

Model eklemek: Ayarlar → Model Sağlayıcıları'nda API adresi + anahtar, ya da model seçicinin
altındaki "Configure custom models". **Web sitesini model gibi kullanmak Faz F'tir.**

---

## Faz F — Web sağlayıcılar — KESİN, opsiyonel değil

> *"model sağlayıcılar kısmına web ekleme de koy; hem sistemdeki AI'lar siteyi kullansın hem de
> ben AI modeli gibi normal komutları yaptırayım"* · *"bu Hint siteleri, Çin siteleri var ya,
> onları otomatize etmek lazım, bu konu kesin olsun, hakları çok iyi"* · *"o sitelerde de içinden
> model seçiliyor, mümkünse onu da seçmek isterim, versiyonlarını"* · *"web'te kullandığım AI'ı
> bile bu şekilde kullanabileyim"*

Bu faz **yapılacak**. Aşağıdaki ayrım öncelik sırası içindir, "yapma" değil.

### F1 — Resmi ücretsiz katman kataloğu (önce bu, çünkü bedava ve kırılmaz)

Groq, Cerebras, Google AI Studio, OpenRouter free, HuggingFace Inference, Pollinations gibi
**resmi ücretsiz API katmanı** olan sağlayıcılar için `src/shared/data/presets/` altına hazır kayıt:
baseURL + varsayılan limit + dönem. Kullanıcı sadece anahtar yapıştırır.
Her biri B6 tablosunda satır alır, C'deki ücretsiz havuza girer.

### F2 — Webview taşıyıcılı sağlayıcı (asıl istenen)

> *"Gemini'ye desem ki şunu seç, AI'ları seçsem, DeepSeek kimi, attığım linki de burdan seçsem,
> API gibi işlem yapsın."*

Hedef davranış: **bir link yapıştır → o site uygulamada API sağlayıcısı gibi davransın.**
Sohbette model listesinden seçilsin, normal cevap versin, kotası takip edilsin.

### F2.0 — ⚠️ Sıfırdan yazma: `@cherry/browser` MCP sunucusu zaten var

`src/main/ai/mcp/servers/browser/` — **Chrome DevTools Protocol ile tam tarayıcı kontrolü**:
- Araçlar: `open`, `tabs`, `snapshot`, `screenshot`, `execute` (sayfada JS çalıştırma), `reset`
- **Oturum kalıcı** (`persist:default` partition) — bir kez giriş yaptığın site hatırlanıyor
- Normal / gizli mod, pencere havuzu, boşta kalma temizliği
- README: `src/main/ai/mcp/servers/browser/README.md`

**Sonuç:** F2 yeni bir taşıyıcı motoru yazmak değil, bu sunucunun üstüne **iki ince katman**
eklemektir:
1. **Adaptör katmanı** — siteyi model listesinde bir *sağlayıcı* gibi gösterir (aşağıdaki F2.1–F2.6).
2. **Ajan katmanı** — araç çağırabilen model `@cherry/browser`'ı zaten doğrudan kullanabilir;
   adaptör olmadan da "şu siteye gir, şunu sor" diyebilir. **Bu bugün çalışıyor, sadece MCP
   ayarlarından açılması gerekiyor.**

> Opus ilk iş olarak `@cherry/browser`'ı açıp bir AI sitesinde elle denesin. Adaptör katmanının
> ne kadarının gerçekten gerektiği ancak ondan sonra bellidir.

Diğer mevcut altyapı: `WebviewService`, `MiniAppRuntimeService`,
`src/main/services/webSearch/providers/registry.ts` (sürücü kayıt deseni örnek alınacak).

#### F2.1 — Veri modeli

Site adaptörü **koda gömülmez, veri olarak saklanır** — yeni site eklemek kod yazmak değil kayıt
eklemektir:

```
WebProviderAdapter {
  id, name, url
  input:      { selector, kind: 'textarea' | 'contenteditable' }
  send:       { selector } | { key: 'Enter' | 'Ctrl+Enter' }
  response:   { containerSelector, streamingAttr?, doneSignal }
  modelPicker?: { openSelector, optionSelector, currentSelector }
  newChat?:   { selector }
  lastVerifiedAt, verifiedByVersion
}
```

Sağlayıcı kaydı normal `userProvider` satırıdır, `transport: 'webview'`. Böylece model seçici,
kota tablosu, yönlendirme ve baş kontrolcü **hiçbir değişiklik olmadan** onu görür.

#### F2.2 — Adaptör üç yoldan kazanılır (kusursuzluk buradan geliyor)

Sırayla denenir, biri tutmazsa diğerine düşülür:

1. **Katalog** — bilinen siteler için hazır adaptör `src/shared/data/presets/webProviders/`.
   Kullanıcı linki yapıştırır, eşleşirse hiçbir şey sormaz.
2. **Otomatik algılama** — eşleşme yoksa sayfa taranır: en büyük görünür `textarea` /
   `[contenteditable=true]` girdi kabul edilir; ona en yakın `button[type=submit]` veya
   `aria-label` içinde "send/gönder" geçen düğme gönder kabul edilir; gönderimden sonra **en çok
   büyüyen** DOM düğümü cevap konteyneri kabul edilir (MutationObserver ile ölçülür).
3. **Öğretme modu** — ikisi de tutmazsa kullanıcı 4 tıkla öğretir: "girdi kutusunu tıkla",
   "gönder düğmesini tıkla", "cevabın çıktığı yeri tıkla", "model listesini tıkla".
   Uygulama tıklanan öğe için **dayanıklı seçici** üretir (id → data-testid → aria-label → rol+sıra;
   rastgele üretilmiş sınıf adları kullanılmaz).

Sonuç her hâlükârda aynı `WebProviderAdapter` kaydıdır ve dışa aktarılıp içe alınabilir.

#### F2.3 — Site içi model seçimi ve sürümler

`modelPicker` sitenin kendi model açılır listesini okur. Oradaki **her seçenek, sürümüyle birlikte**,
uygulamada ayrı bir model satırı olur: `` `${webProviderId}::${siteModelId}` ``.
Böylece "DeepSeek V4 Flash" ile "DeepSeek V3" site içinde ayrı seçilir, **B1/B4 kota takibi de
sürüm bazında çalışır**. Liste sitede değişirse "Modelleri eşitle" düğmesi yeniden okur.

#### F2.4 — İstek akışı

1. Sağlayıcıya ait webview hazırda tutulur (`MiniAppRuntimeService` havuzu gibi).
2. Gerekirse `newChat` tıklanır (bağlam sızmasın).
3. `modelPicker` ile istenen model seçilir.
4. İstem `input`'a yazılır, `send` tetiklenir.
5. `response.containerSelector` MutationObserver ile izlenir; her artış **akış parçası** olarak
   normal `UIMessageChunk` akışına çevrilir — kullanıcı farkı görmez.
6. `doneSignal` (gönder düğmesi tekrar aktif olması / "durdur" düğmesinin kaybolması) turu bitirir.
7. Sayaç B5'teki `service_usage` üzerinden artar.

#### F2.5 — Oturum ve gizlilik

Giriş **kullanıcının kendi oturumudur**; uygulama parola saklamaz, girmez, okumaz. Yalnızca
webview'in kendi çerez oturumu kullanılır. Her web sağlayıcı **ayrı `session` partition** alır ki
siteler birbirinin çerezini görmesin.

#### F2.5b — Uslu otomasyon kuralları (hesabını koruyan şey bunlar)

Adaptör motoru bu kurallara **kodun içinden** uyacak; kullanıcı ayarıyla kapatılamaz:

- **İnsan hızında.** İstekler arası en az birkaç saniye, yazma simülasyonu ani değil.
  Arka arkaya sağanak istek yok.
- **Tek hesap, tek oturum.** Çoklu hesap desteği **yok**; aynı sitede ikinci hesapla kota
  çoğaltma özelliği yazılmayacak.
- **Sitenin kendi sınırına uy.** P5'teki `quotaExhaustedPattern` görülünce dur ve pasife düş —
  yeniden denemeye ısrar etme.
- **CAPTCHA / bot doğrulaması çıkarsa dur** ve kullanıcıya bırak. Otomatik çözme yok.
- **`robots.txt` ve sitenin açık kısıtlarına saygı.**
- **Eşzamanlı tek sekme** — aynı siteye paralel istek gitmez (O6 yarış modu web sağlayıcılarda
  devre dışı).

Bu kurallar hem hesabını korur hem adaptörü sağlam tutar. Detaylı gerekçe **Ek 6**'da.

#### F2.6 — Kırılganlık yönetimi

Site HTML'i değişince adaptör kırılır — bu kaçınılmaz, o yüzden plan buna göre kurulu:
- Her adaptörde `lastVerifiedAt`. Tur başarısız olursa adaptör "doğrulanmamış" işaretlenir.
- Model **B7'deki gibi pasife düşer**, listede kalır, nedeni yazar ("site adaptörü yanıt vermedi").
- Kullanıcı öğretme moduyla 4 tıkta tazeler.
- **Kural 2:** istek reddedilmez — Faz C ile normal API modeline düşer.
- Adaptörler dışa/içe aktarılabilir olduğu için bir sitenin tazelenmiş adaptörü paylaşılabilir.

### F3 — Web modelleri her yerde kullanılabilir

Web modelleri sohbette normal model gibi seçilir, **Faz D'de işçi**, **Faz G'de otonom kodlama
işçisi**, **Faz I'da hareket işçisi** olabilir. Ayrı bir "web ekranı" yapılmaz — tek model
listesine girerler. "Sistemdeki AI'lar siteyi kullansın" bu yolla sağlanır.

---

## Faz G — Otonom kodlama modu

> *"klasör seçme ekle kodlama kısmına, klasörü seçeyim 'şu uygulamayı yap' diyeyim yapsın"* ·
> *"yapamıyorsa diğer AI'ları kullansın, sürekli komutta beklemesin"* · *"auto mode'ye koyayım,
> otomatik yapsın, model değiştirsin, kodları falan her şeyi ayarlasın"* · *"ChatGPT Codex,
> Claude Code gibi dosya oluşturma, program yapma, ama her şey otomatik kendi içinden"*

### G0 — Çoğu zaten var, önce aç

- `CodeCliService` — terminal/CLI algılama (log: `Found claude`, `agy`, `gemini` in PATH)
- `ClaudeCodeProcessManager`, `ClaudeCodeSessionStateService`, `ClaudeCodeWarmQueryManager`
- `AgentSessionRuntimeService`, `AgentJobsService`, `agentTaskJobHandler` — ajan görev kuyruğu
- `@cherry/filesystem` MCP — `glob/ls/grep/read/edit/write/delete`, `baseDir` seçilebiliyor
- `DirectoryTreeManager`, `application.getPath(...)`

### G1 — Klasör seçici kodlama ekranında

`@cherry/filesystem` MCP'sinin `baseDir` seçicisi var (önceki commit:
`feat(mcp-settings): add filesystem base dir picker`). Bu seçici **kodlama ekranına taşınır** —
kullanıcı sohbetten çıkmadan çalışma klasörünü seçer.

### G2 — Auto mode: beklemeden devam

Tercih `agent.auto_mode`, varsayılan **kapalı**.
- Açıkken araç onayları otomatik verilir — **yalnızca geri alınabilir işlemler**. Dosya silme,
  `git push`, dış servise yazma gibi geri alınamaz işlemler auto mode'da da sorar
  (`CLAUDE.md` "blast radius" kuralı).
- Model başarısız olursa Faz C devreye girer ve **tur kesilmeden** sonraki adayla devam eder.
- Onay bekleme zaten var: `AiStreamManager.DEFAULT_CONFIG:192` `approvalIdleTimeoutMs: 2 saat`.

### G3 — Görev kuyruğu

"Şu uygulamayı yap" tek dev istek değil, `JobManager` üzerinde adım adım görev.
`agent.task` işleyicisi zaten kayıtlı. Faz D'deki kontrolcü burada da kullanılır: kontrolcü işi
böler, işçi modeller (API veya **web**) adımları yapar.

### G4 — Dosya işlemleri sohbette açık olsun

> *"bilgisayarımda dosya oluşturma silme, şu an senin yaptığın gibi özellikleri olsun"*

Bu **zaten yazılmış, sadece açılmamış**. `@cherry/filesystem` MCP sunucusu şu araçları veriyor:
`glob`, `ls`, `grep`, `read`, `edit`, `write`, `delete` — yani Claude Code'un yaptığı dosya
işlemlerinin tamamı. Yapılacak:

- Normal sohbette de varsayılan olarak **açık** gelsin (bugün MCP ayarlarından elle açılıyor).
- `baseDir` G1'deki klasör seçicisinden gelsin; seçilmemişse araçlar kapalı kalsın (kazara ev
  dizinine yazmasın).
- Silme ve dizin dışına yazma **auto mode'da da onay sorar** (G2'deki geri-alınamaz kuralı).
- Yapılan her dosya işlemi sohbette görünür satır olarak yazılsın (ne oluşturuldu, ne silindi).

---

## Faz H — Zamanlayıcı + oto-devam + hatırlatma

> *"ücretsiz sürümlerde zaman kotası oluyor, araya bir zamanlayıcı eklensin"* · *"olmadı oto
> devamla yapay zekaya hatırlatalım ne olduğunu, çünkü ücretsiz API'ler sıkıntı"* · *"bu
> hatırlatma butonu ayrı olsun"*

### H1 — Oran sınırı zamanlayıcısı

Ücretsiz katmanlar çoğu zaman "dakikada N istek" sınırlıyor. `ApiKeyEntry`'ye
`rateLimit?: { requests: number; perSeconds: number }`.
- Sınıra yaklaşınca istek **reddedilmez**; `SchedulerService` (zaten var) ile kuyruğa alınır,
  pencere açılınca gönderilir.
- Kullanıcıya "X sn sonra devam edecek" geri sayımı gösterilir.

### H2 — İki ayrı düğme

- **Oto-devam:** tur kota/zaman aşımından yarım kaldıysa kaldığı yerden otomatik devam eder.
  Faz D'deki `pendingMerge` / tur zincirleme düzeneğinin aynısı kullanılır.
- **Hatırlat:** kullanıcının bastığı **ayrı** düğme — o ana kadarki hedefi + yapılanları özetleyip
  modele yeniden verir. Özet için mevcut `resolveCompactedHistory`
  (`PersistentChatContextProvider:563`) yeniden kullanılır, yeni özetleyici yazılmaz.

---

## Faz I — "Hareket" tuşu (masaüstü otomasyonu)

> *"otomatik yazıp çizmesini de hareket diye bir tuş eklersin, bu tuşa basınca otomatik PC'mde
> işlem yapsın, kapatınca yapmasın"*

Tek bir açma/kapama düğmesi: **Hareket**. Açıkken model fareyi/klavyeyi kullanıp ekranda iş yapar,
kapalıyken **hiçbir şekilde yapamaz**.

### I1 — Gidişat: yeni alt sistem değil, MCP sunucusu

Uygulamada araç sağlamanın hazır yolu var: **iç MCP sunucusu**. `@cherry/filesystem` tam olarak
böyle çalışıyor (`McpFactory` → `Creating in-memory MCP server`). Aynı desenle
**`@cherry/desktop`** yazılır. Böylece:

- Araç çağırabilen **her model** (API veya web) bunu kullanabilir — ayrı entegrasyon yok.
- Faz D'deki kontrolcü ve Faz G'deki otonom mod bedavaya kazanır.
- **Kapatma gerçekten kapatır:** düğme kapalıyken sunucu kayıtlı olmaz, yani araçlar modelin
  araç listesinde **hiç görünmez**. Model isteyemez, "unutmayı" denemesi gerekmez.

### I2 — Araç seti

| Araç | İş |
|---|---|
| `screen_info` | Ekran sayısı, çözünürlük, ölçekleme |
| `screenshot` | Ekranın/pencerenin görüntüsü — modelin "gözü" |
| `mouse_move`, `mouse_click`, `mouse_drag` | İşaretle, tıkla, sürükle (**çizim bununla olur**) |
| `type_text` | Metin yaz |
| `key_press` | Tuş / kısayol (`Ctrl+S` gibi) |
| `scroll` | Kaydır |
| `active_window` | Hangi uygulama önde |

Döngü: `screenshot` → model koordinat söyler → `mouse_click` / `type_text` → tekrar `screenshot`.
Bu, "yazıp çizme"nin tamamını karşılar.

### I3 — Yerli modül seçimi

Fare/klavye için yerli (native) modül gerekiyor. `nut.js` (bakımlı, çapraz platform) önerilir;
`robotjs` bakımsız. **Uyarı:** bu depoda `better-sqlite3` Electron için derleniyor ve düz Node
testlerinde `NODE_MODULE_VERSION` hatası veriyor — `nut.js` aynı sınıf sorunu getirir.
Opus önce Windows x64'te `electron-rebuild` ile derlenebildiğini doğrulasın, olmazsa Windows'a
özel PowerShell + `System.Windows.Forms` yedeğiyle başlasın.

### I4 — Güvenlik kolları (bunlar özelliğin parçası, süsü değil)

- **Varsayılan kapalı.** Tercih `agent.motion_enabled`, oturum kapanınca da kapanır.
- **Görünür gösterge:** Hareket açıkken sürekli görünen bir şerit/rozet — kullanıcı her an bilir.
- **Acil durdurma:** global kısayol (`ShortcutService` zaten var) ve şeritteki "Durdur" düğmesi
  hem Hareket'i kapatır hem çalışan turu iptal eder.
- **Denetim kaydı:** her eylem öncesi ekran görüntüsü + eylem satırı sohbete yazılır; kullanıcı
  sonradan "ne yaptı" diye bakabilir.
- **Kör tıklama yok:** model koordinat verirken hangi öğeye tıkladığını da yazar; eşleşmiyorsa
  eylem atlanır.
- **Parola alanı koruması:** `type_text`, aktif öğe parola tipindeyse yazmayı reddeder.
- **Auto mode ile ilişki:** Hareket açık + auto mode kapalıysa her eylem onay sorar; ikisi de
  açıksa geri alınabilir eylemler geçer, geri alınamazlar (silme, satın alma, gönderme) yine sorar.

### I5 — Düğmenin yeri

Faz C'deki oto-geçiş düğmesinin yanına, `ChatComposer.tsx:1845` `sendAccessory` içine.
Üç düğme yan yana: **Oto geçiş · Hareket · Auto mode** — hepsi varsayılan kapalı.

---

## Sıra ve bağımlılıklar

```
A (bitti) → R1 → J1, J3 → L → B → P → C → O5 → D → F2
              → O1,O2,R4 → G → R2 → O3,O4,R5 → K → H → I → M → N,Q,R(kalanı)
                              ↘ F1 (bağımsız)
E: kod yok
```

**Faz Z (model havuzu) B'den hemen sonra.** Kota tablosu kurulur kurulmaz dağınık anahtarlar
tek havuza dönsün — sonraki her faz (C, D, O5, P) havuzun üstünde çalışıyor. Z3 (şeffaf kaynak
değiştirme) C'den bile önce gelebilir, çünkü model değişmediği için risksiz.

**EN BAŞTA: U (veri güvenliği) → V1 (hafif mod) → W1 (kurulum sihirbazı).**
U olmadan her şey risk altında — iki hafta bir kez kaybedildi, ikincisi olmamalı.
V1 tek anahtarla ~2 sn açılış ve birkaç yüz MB RAM kazandırıyor, sonraki her fazı rahatlatıyor.
W1 kurulum acısını bitiriyor.
**X (kıyas testi) D'den hemen sonra** — yönlendirmenin "abaküs kadar iyi" olması ona bağlı.
**Y (görsel/video kota) B'den sonra**, aynı tabloyu kullanıyor.

**Faz S ve T nereye giriyor:** S1 (plan modu) ve S2 (canlı görev listesi) **Faz G'den önce** —
otonom modun güvenilir olması onlara bağlı. S3 (canlı önizleme) G'den hemen sonra, R6 onu kullanıyor.
S4–S8 ile T1–T4 en sona, bağımsız. **T3 (görev-boyut eşleştirme) O5'ten hemen önce** — tırmanmadan
önce doğru basamaktan başlamak için.

**En başa alınanlar (küçük iş, her şeyi etkiliyor):**
- **R1 — kesilen cevabı sürdürme.** Bu olmadan ücretsiz modellerle uzun kod üretilemiyor;
  sonraki her faz bundan zarar görür.
- **J1 — gerçek kullanımdan sağlık öğrenme.** Olmadan yönlendirme/pasif liste kör.
- **J3 — anahtar kilidi.** Olmadan D ve O6'daki paralel işçiler aynı anahtarı patlatır.
- **L — yerel model.** Erken devreye girerse sonraki her faz daha az ücretsiz kota harcar.

**Sıra gerekçeleri:**
- **P, B'den hemen sonra**: kota tablosu kurulur kurulmaz P1 onlarca anahtarı otomatik doldursun.
- **O1, O2, R4 (geri alma / diff / klasör hapsi) G'den ÖNCE**: bunlar olmadan auto mode açmak riskli.
- **R2 (klasör indeksleme) G'den hemen sonra**: en büyük token tasarrufu, erken kazanılsın.
- **R5 (hata belleği) K ile birlikte**: proje belleğine yazıyor.
- **K, G'den sonra**: proje belleği G1'deki klasör seçicisine bağlı.
- **R3 (yetenek doğrulama), J2 ile birlikte**: aynı probun içine giriyor.

- **J1 + J3 en başa**: J1 olmadan sağlık/yönlendirme gerçek kullanımdan öğrenmiyor; J3 olmadan
  D ve O6'daki paralel işçiler aynı anahtarı patlatıyor. İkisi de küçük iş.
- **L erken**: yerel model sınıflandırma/özetleme/olgu çıkarmayı devralınca sonraki her faz
  daha az ücretsiz kota harcar.
- **P, B'den hemen sonra**: kota tablosu kurulur kurulmaz onlarca anahtarı elle doldurmak
  yerine P1 otomatik doldursun.
- **O5 (ucuzdan pahalıya), C'den sonra**: geçiş altyapısını kullanıyor.
- **O1 + O2, G'den ÖNCE**: geri alma ve diff olmadan auto mode açmak riskli.
- **O4, G'den sonra**: doğrula-düzelt döngüsü otonom turun çıktısını denetliyor.
- **K, G'den sonra**: proje belleği G1'deki klasör seçicisine bağlı.

- **J1 + J3 en başa alındı**: J1 olmadan sağlık/yönlendirme gerçek kullanımdan öğrenmiyor,
  J3 olmadan D'deki paralel işçiler aynı anahtarı patlatıyor. İkisi de küçük iş.
- **L erken**: yerel model sınıflandırma/özetleme/olgu çıkarmayı devralınca B'den itibaren
  her faz daha az ücretsiz kota harcar.
- **K, G'den sonra**: proje belleği G1'deki klasör seçicisine bağlı.

- **B önce**: A3'ün eksik parçası (B7) ve C'nin kota atlaması ona bağlı.
- **D, F2'den önce**: web modelleri D'nin işçi havuzuna girecek.
- **F2, G'den önce**: web modelleri G'de de işçi olacak.
- **H, C'den sonra**: oto-devam geçiş mantığına dayanıyor.
- **I en sonda**: G2'deki onay mekanizmasını ve G4'teki denetim kaydını yeniden kullanıyor;
  ayrıca en riskli parça olduğu için altındaki her şey oturmuş olmalı.

---

## Doğrulama

Dar tut. Tek dosya için `pnpm test` çalıştırma — `./node_modules/.bin/vitest run <yol>` kullan.

| Faz | Doğrulama |
|---|---|
| B | `vitest run src/main/data/services/__tests__/apiKeyQuota.test.ts` + `apiKeyModel` gruplama testi. Aynı sağlayıcıya 2 anahtar gir, ayrı limitler ver → tabloda 2 satır, ayrı kalanlar. `'total'` dönemli deneme anahtarı bitince pasife düşsün |
| C | Kapalıyken tükenmiş modelde model değişmesin; açıkken sonraki adaya geçsin. Sıra ücretsiz→deneme→ücretli olsun. Birincil model **her iki durumda da** denensin |
| D | 3 işçi + 1 kontrolcü → 3 kardeş cevap + 1 birleşik cevap. Kontrolcüyü bozuk çıktı verecek şekilde zorla → normal tek-model yoluna düşsün |
| F1 | Ücretsiz katman sağlayıcısı ekle → B6 tablosunda satır çıksın |
| F2 | Kataloğu **olmayan** bir AI sitesinin linkini yapıştır → otomatik algılama tutsun; tutmazsa öğretme moduyla 4 tıkta kurulsun; sonra sohbette normal model gibi cevap versin. Site içi model listesi uygulamada ayrı satırlar olsun. Adaptörü kasten boz → istek reddedilmeden API modeline düşsün, model pasife geçsin |
| G | Klasör seç → "şu uygulamayı yap" → dosyalar o klasörde oluşsun, silme onay sorsun. Auto mode kapalıyken her onay sorulsun; açıkken geri alınabilirler geçsin, geri alınamazlar yine sorulsun |
| H | Oran sınırına dayat → istek reddedilmeden kuyruğa girip geri sayımla gitsin. "Hatırlat" düğmesi bağlamı yeniden versin |
| I | Hareket **kapalıyken** modelin araç listesinde masaüstü araçları **hiç görünmesin**. Açınca gösterge çıksın, acil durdurma hem turu kessin hem düğmeyi kapatsın. Parola alanına `type_text` reddedilsin. Basit test: not defterini aç, yaz, kaydet; ve Paint'te bir çizgi çiz |
| Hepsi | `pnpm lint`. **Not:** i18n:check'te 35 eski hata var, onlar Opus'un değil |

---

## İzlenebilirlik — söylenen her cümle nerede

| Kullanıcının sözü | Görev |
|---|---|
| "sağlayıcıyı değiştirmeme rağmen yenile yapınca eskiyle arattığımızla aratıyor" | A1 ✅ |
| "yeniden gönder var ya ona basınca takılı kalıyor" | A2 ✅ |
| "yeni seçtiğimden arasın" | A1 ✅ |
| "çalışmayan sağlayıcılar ayarlarda silindi ama burada görünüyor" | A3 ✅ |
| "çalışanlar üste aktif, çalışmayanlar pasif, elle tikleyince aktifleşsin" | A3 ✅ |
| "sil diyince listeden pasifleşsin, aşağı insin, ünlem olsun" | A3 ✅ |
| "token bittiyse de pasif olsun, hangisinde kaç token var bilelim" | **B7** |
| "token takibi olsun, hangi API'den bağlı kaç hakkım var" | **B4, B6** |
| "aynı sağlayıcıdan sınırlı hak veriyorsa hangisinden ne kadar kaldı bilmeliyim" | **B1, B6** |
| "DeepSeek OpenRouter 20 hak, DeepSeek SiliconFlow 15 hak" | **B6** |
| "versiyonlarda da olsun, şu sürüm bu sürüm" | **B1, B4** |
| "ayarlardan manuel artır/azalt yapabileyim" | **B6** |
| "ücretli API girerim, ücretsiz API girerim" | **B2** |
| "ortaklaşa API veren siteler, deneme, Opus 5'ten 10 kullanım hakkı" | **B2** (`tier:'trial'` + `period:'total'`) |
| "DeepSeek V4 Flash'tan 2 anahtarım var, ikisini aynı anda girip limitlerini ayrı ayarlayayım" | **B1** |
| "ayarlarda bir sınır olmasın, istediğim kadar API gireyim" | **B6** (altyapı sınırsız, UI'da da sınır yok) |
| "farklı yerlerden aynı sağlayıcıyı veren API'ler bulacağım" | **B1, B6** |
| "kırmızı nokta koydum ya, oto geçiş olsun" | **C** |
| "birkaç model seçiliyor orası kalsın, yanına baş kontrolcü gelsin, diğerlerini çalıştırsın" | **D** |
| "abaküs gibi — otomatik uzmana veriyor, elle de seçebiliyorsun" | **D** + mevcut `ModelRoutingService` |
| "bu URL kısmı ne, model olarak eklenecek mi" | **E** (kod yok) |
| "model sağlayıcılar kısmına web ekleme de koy" | **F1 + F2** |
| "sistemdeki AI'lar siteyi kullansın" | **F3** |
| "ben de AI modeli gibi normal komutları yaptırayım" | **F2** |
| "Hint siteleri, Çin siteleri otomatize edilsin — bu konu kesin olsun, hakları çok iyi" | **F2** (kesin, opsiyonel değil) |
| "o sitelerde içinden model seçiliyor, onu da seçmek isterim, versiyonlarını" | **F2a** |
| "web'te kullandığım AI'ı bile bu şekilde kullanabileyim" | **F2 + F3** |
| "kullanım limitleri olan siteler, hepsini entegre etmek istiyorum" | **F1 + B5 + B6** |
| "otomatik yazıp çizebiliyor mu PC'de, o sistemi de ayarla" | **G1–G4** (dosya) + **I** (ekran sürme) |
| "otomatik yazıp çizmesini de hareket diye bir tuş ekle" | **I5** |
| "bu tuşa basınca PC'mde işlem yapsın, kapatınca yapmasın" | **I1** (kapalıyken araçlar hiç görünmez) |
| "bilgisayarımda dosya oluşturma silme, şu an senin yaptığın gibi" | **G4** (`@cherry/filesystem` zaten var, açılacak) |
| "Gemini'ye desem şunu seç, AI'ları seçsem, DeepSeek kimi" | **F2.3** (site içi model + sürüm seçimi) |
| "attığım linki de burdan seçsem, API gibi işlem yapsın" | **F2.1 + F2.2** (link yapıştır → katalog/otomatik algılama/öğretme → sağlayıcı olur) |
| "klasör seçme ekle kodlama kısmına" | **G1** |
| "klasörü seçeyim şu uygulamayı yap diyeyim yapsın" | **G3** |
| "yapamıyorsa diğer AI'ları kullansın, sürekli komutta beklemesin" | **G2 + C** |
| "auto mode'ye koyayım, model değiştirsin, kodları her şeyi ayarlasın" | **G2, G3** |
| "ChatGPT Codex / Claude Code gibi dosya oluşturma, program yapma, her şey otomatik kendi içinden" | **G** + mevcut `CodeCliService`, `ClaudeCodeProcessManager` |
| "ücretsiz sürümlerde zaman kotası oluyor, araya zamanlayıcı eklensin" | **H1** |
| "olmadı oto devamla AI'ya hatırlatalım ne olduğunu" | **H2** |
| "bu hatırlatma butonu ayrı olsun" | **H2** (iki ayrı düğme) |
| "birbirinden bağımsız sistemlerde yapılıyor, onları birleştiriyoruz" | Projenin tek cümlesi (en üst) |
| "hafıza konusunda ne yapacağız, ona da bir çözüm bul" | **Faz K** (`@cherry/memory` zaten var + proje belleği) |
| "LM Studio kurulu, sistemim düşük, lokal bir modelle bağlantı kuralım" | **Faz L1–L3** |
| "LM Studio'daki yerel AI'yı da kullanabilir miyiz" | **Faz L4–L13** — gömme, taslak-rötuş, ön eleme, log özetleme, gizlilik duvarı, güvenlik kapısı, D'de işçi, gece işleri, model yönetimi |
| "VS Code'da Kilo Code kullanıyordum, artık bu programı kullanacağım" | **Faz G** (klasör + otonom kodlama) + **Ek 3.5** (çıktı doğrulayıcı) |
| "API anahtarlarını verimli ve kontrollü kullanarak her şeyi yaptırmak istiyorum" | **Faz B + C + J3 + J5 + L2** |
| Gemini'nin 9 maddelik önerisi | **Ek 1** — 9'unun 8'i zaten var; eksik olan tek fikir **Faz M** |
| "GitHub'a bak, birkaç eklenti ekle" | **Ek 2** |
| "bu özellikleri koy" (10 fikirlik liste) | **Faz N** (onaylandı) |
| "API anahtarlarını verimli ve kontrollü kullanmak" | **Faz P** + **O5** (ucuzdan pahalıya tırmanma) |
| "her şeyi yaptırmak istiyorum" (otonom kodlama) | **Faz O** — geri alma, diff, doğrula-düzelt |
| "onaylıyorum" (bağlam/akış listesi) | **Faz Q** |
| "kendini benim yerime koyarak özellik ekle" | **Faz R** — 12 madde, günlük kullanım sürtünmeleri |
| "diğer sistemlerde olup bunda olmayan ne var" | **Faz S** — plan modu, canlı görev listesi, canlı önizleme, dosya @-bahsi, gömülü terminal, kancalar, makrolar, satır içi düzenleme |
| "bu ücretsiz API'leri en verimli nasıl kullanırız" | **Ek 4** — 6 altın kural + **T1–T4** yeni özellikler |
| "eskisini baştan yapmıştık, kota bitti, sildim" | **Faz U** — yedek, dışa aktarma, çöp kutusu, iş kurtarma |
| "sistemim düşük" | **Faz V** — hafif mod, kaynak tavanı, boşta indeksleme |
| "her yeri hataydı" | **Faz W** — kurulum sihirbazı, hata sözlüğü, sağlık ekranı |
| "abaküs kadar iyi, görevi alanındaki uzmana yaptırsın" | **Faz X** — kıyas testi + kendi kullanımından öğrenme + elle etiket |
| "resim oluşturabileceğim" | **Faz Y** — görsel/video kota ve yönlendirme kapsamına alınır |
| "2 haftadır bununla uğraşıyorum" (fork bakımı) | **Ek 5** — üst projeyle ayrışma disiplini |
| "banlamaması için nasıl sistem kuralım, IP/VPN?" | **Ek 6** — otomatik IP rotasyonu plana girmiyor; çözüm F1 (resmî ücretsiz API) + F2.5b (uslu otomasyon) + çok sağlayıcıdan çeşitlilik |
| "IP/VPN'i yabancı siteler için sordum, elle ayarlasam, telefon bağlantımı da kullansam" | **P7** — sağlayıcı başına elle proxy/çıkış seçimi (bölge kısıtı ve bağlantı yönetimi) |
| "bazıları aylık yenileme veriyor" | **B3(b)** — yenileme üyelik yıldönümüne göre, elle ayarlanabilir |
| "Google ücretsiz anahtar veriyor, DeepSeek sudan ucuz, hep farklı sağlayıcılarda ayrı ayrı var" | **Faz Z** — aynı model = tek havuz; denklik haritası, havuzlanmış kota, şeffaf kaynak değiştirme, keşif kataloğu |
| "Haiku 4.5'ten yaptıracağım" | **En üstteki "Bu planı uygulayacak modele"** bölümü — tek madde tek seferde, tuzak listesi, doğrulama kuralları |

**Atlanan özellik yok.**

---

## Faz J — Sistemi öğrenen hâle getiren düzeltmeler (ONAYLANDI)

Kodu okurken bulunan boşluklar. Kullanıcı hepsini onayladı.

### J1 — Gerçek kullanımdan sağlık öğrenme ⭐ (gerçek boşluk, ucuz, çok değerli)

`recordModelHealth` **yalnızca** `AiService.checkModel:1412` tarafından çağrılıyor — yani ayarlardan
elle "model denetimi" yapılınca. **Sohbette gerçekten hata veren model asla sağlıksız işaretlenmiyor.**
Bu yüzden A3'teki pasif liste ve tüm yönlendirme katmanı gerçek kullanımdan hiçbir şey öğrenmiyor.

Yapılacak: `createRetryableWrap`'in `onFailure`/`onSuccess` geri çağrılarından sağlık yazılsın
(kullanıcı iptali ve ağ kesintisi hariç tutulur). İki çağrı noktası, küçük iş.
**Bu yapılmadan A3, B7 ve D'nin "uzmana ver" davranışı yarım kalır.**

### J2 — Arka planda otomatik sağlık taraması

Boştayken, düşük sıklıkta (ör. 6 saatte bir, kota harcamayan en ucuz istek) anahtar + model
taraması. `SchedulerService` zaten var. Kullanıcı elle denetim yapmasa da liste taze kalır.

### J3 — Anahtar eşzamanlılık kilidi ⭐ (D + H1 olmadan patlar)

Faz D'de N işçi **paralel** çalışıyor. İkisi aynı anahtarı kullanırsa dakikalık oran sınırı anında
patlar ve ikisi birden başarısız olur. Anahtar başına semafor gerekli: `KeyedMutex`
(`src/main/core/concurrency/KeyedMutex.ts`) zaten var, yeniden kullanılır.
**D ve H1 birlikte yapılıyorsa bu zorunlu, öneri değil.**

### J4 — Yerel model son çare

`LocalModelService`, `OvmsManager`, Ollama zaten kurulu. Tüm uzak anahtarlar tükendiğinde yerel
modele düşülsün. Kural 2'yi ("hiçbir istek reddedilmez") gerçekten garantiler — internet yokken
bile çalışır.

### J5 — Kota bütçesi ayırma

Faz G'deki otonom işler saatlerce çalışıp günlük ücretsiz kotanın tamamını yiyebilir; sonra
sohbete oturduğunda hak kalmaz. Anahtar başına "arka plan işleri en fazla %70 kullanabilir"
ayarı. B6 tablosuna bir sütun.

### J6 — Tekrarlanan istek önbelleği

Aynı istem + aynı model + aynı bağlam için cevap önbelleğe alınsın. Ücretsiz kotada
yeniden-deneme ve tekrar sorular hak yemesin. `CacheService` zaten var.

### J7 — Cevap seçimi yönlendirmeyi eğitsin

Faz D'de N işçi cevap veriyor; kullanıcı hangisini beğendiyse o modelin o kategorideki puanı
artsın (`deriveRoutingTable` içindeki `quality`/`affinity`). "Abaküs" böylece gerçekten **öğrenen**
bir sistem olur — bugün skorlar sabit sezgilerden geliyor.

**Sıra:** J1 ve J3 diğerlerinden önce (biri olmadan sistem öğrenmiyor, öteki olmadan paralel
çalışma patlıyor). J4, J5, J6, J7 sonra.

---

## Faz K — Hafıza

> *"hafıza konusunda mesela ne yapacağız, ona da bir çözüm bul"*

### K0 — ⚠️ Sıfırdan yazma: `@cherry/memory` zaten var

`src/main/ai/mcp/servers/memory.ts` — **bilgi grafiği hafızası**:
`Entity { name, entityType, observations[] }` + `Relation { from, to, relationType }`,
dosyaya yazılıyor (`application.getPath('feature.mcp.memory_file')`), yazma kilidi (`Mutex`) var.
Ayrıca `agentMemory.ts` (ajana özel hafıza) ve `cherryKnowledgeTools.ts` (bilgi bankası araçları).

Yani "AI beni hatırlasın" altyapısı **kurulu, sadece kullanılmıyor.**

### K1 — Dört katmanlı hafıza (hepsi mevcut parçalardan)

Ücretsiz API'lerin bağlam penceresi küçük. Çözüm "daha çok geçmiş göndermek" değil, **doğru şeyi
az göndermek**:

| Katman | Ne tutar | Nereden |
|---|---|---|
| **1. Çalışma belleği** | Son N tur birebir, eskisi özet | `resolveCompactedHistory` — **var** |
| **2. Proje belleği** | Klasöre bağlı kalıcı not: hedef, kararlar, kurallar | Yeni: `.cherry/MEMORY.md` — her turda **başa** eklenir |
| **3. Olgu belleği** | "Kullanıcı X'i tercih ediyor", "proje Y kullanıyor" | `@cherry/memory` grafiği — **var** |
| **4. Belge belleği** | Kitap/PDF/kod tabanı | Bilgi bankası + RAG — **var** |

### K2 — Proje belleği (tek gerçek yeni parça)

Claude Code'un `CLAUDE.md`'si gibi: seçili çalışma klasöründe `.cherry/MEMORY.md`.
- Her turda sistem istemine **başa** eklenir — kısa olduğu için ucuz, aptal modelde bile çalışır.
- Ajan kendi güncelleyebilir (`write` aracı zaten var), kullanıcı elle düzenleyebilir.
- Tur bitiminde "bunu hatırla" düğmesi → satır ekler.
- G1'deki klasör seçicisine bağlı: klasör değişince hafıza da değişir.

### K3 — Otomatik olgu çıkarma

Tur bitince konuşmadan kalıcı olgular çıkarılıp `@cherry/memory` grafiğine yazılır.
**Bu işi Faz L'deki yerel model yapar** — mekanik iş, ücretsiz API kotası harcamaz.

### K4 — Hatırlama ucuz olsun

Her turda tüm grafik gönderilmez. Kullanıcının mesajıyla ilgili olan olgular çekilir
(bilgi bankasının mevcut RAG'i kullanılır) ve yalnızca onlar eklenir.
H2'deki "Hatırlat" düğmesi bu katmanı elle tetikler.

---

## Faz L — Yerel model işçi olarak (LM Studio)

> *"LM Studio da kurulu zaten, sistemim düşük, lokal bir modelle bağlantı kurduralım"*

### L1 — Bağlantı ✅ ZATEN VAR, KOD YAZMA

`node_modules/@cherrystudio/provider-registry/src/providers/lmstudio.ts` — LM Studio hazır
sağlayıcı olarak pakette geliyor: `id: 'lmstudio'`, `authOptional: true` (anahtar sormaz),
`http://localhost:1234`, hem `openai-chat-completions` hem `anthropic-messages` uç noktası.

**Yapılacak tek şey:** kullanıcı Ayarlar → Model Sağlayıcıları'ndan LM Studio'yu açsın ve
LM Studio'da "Local Server" sekmesinden sunucuyu başlatsın. Kod değişikliği yok.

### L2 — Düşük sistemde doğru iş bölümü ⭐

Düşük donanımda 1–3B model akıllı cevap veremez ama **mekanik işleri mükemmel yapar**.
Bunlar yüksek hacimli işler ve şu an ücretsiz API kotası yiyorlar:

| İş | Bugün | Olması gereken |
|---|---|---|
| Görev sınıflandırma (`taskCategory`) | ✅ **Zaten LLM çağırmıyor** — `src/shared/utils/taskCategory.ts` saf sezgisel (TR+EN anahtar kelime). Kazanılacak bir şey yok | — |
| Bağlam özetleme | Ayar **zaten var**: `chat.context_settings.compress.model_id` (boşsa istek modeli) | Yerel modeli göster/öner |
| Konu başlığı üretme (`TopicNamingService`) | Ayar **zaten var**: `topicNamingModel` | Yerel modeli göster/öner |
| Olgu çıkarma (K3) | — | **Yerel** (yeni iş) |
| Baş kontrolcü görev bölme (D2) | Uzak model | Uzak kalsın (yargı ister) |

**Gerçek iş küçüldü:** iki ayar zaten var ama kullanıcı ikisini ayrı ayrı bulup yerel modele
çevirmek zorunda. Yapılacak: tek bir `chat.routing.local_worker_model` tercihi; boş değilse
sıkıştırma ve konu başlığı için **varsayılan** o olsun (kullanıcı tek tek ezebilsin).
**Kazanç:** ücretsiz API hakkı yalnızca gerçek düşünme işine harcanır.

### L3 — Son çare

J4 ile aynı: tüm uzak anahtarlar tükendiğinde yerel modele düşülür. İnternet yokken bile çalışır.

### L4 — Yerel gömme (embedding) ve indeksleme

R2'deki klasör indekslemesi gömme modeli istiyor. Uzak gömme API'si **istek başına** sayılır ve
büyük bir projeyi indekslemek yüzlerce istek eder — ücretsiz kotayı tek başına bitirir.

LM Studio gömme modeli de sunabiliyor. `localEmbeddingProvider` uygulamada **zaten var**;
LM Studio'nun gömme uç noktası ikinci seçenek olarak eklenir.
**Sonuç: R2 indekslemesi tamamen bedava ve sınırsız olur.** Bilgi bankası (kitaplar, PDF'ler) için
de aynı kazanç.

### L5 — Taslak yaz, uzak model rötuşlasın ⭐⭐ (en büyük token tasarrufu)

Uzak modele "sıfırdan yaz" demek yerine: **yerel model taslağı üretir**, uzak modele
"şunu düzelt/tamamla" diye **taslakla birlikte** gider.

- Girdi biraz büyür, **çıktı çok küçülür** — ücretsiz katmanlarda asıl kısıt çıktı uzunluğu
  (R1'deki kesilme sorunu) olduğu için bu doğrudan kazanç.
- Uzak model sıfırdan düşünmediği için daha kısa, daha isabetli cevap veriyor.
- Özellikle şunlarda işe yarıyor: standart kod iskeleti, tekrar eden dosyalar, çeviri,
  belge taslağı, test dosyası.
- Tercih başına açılır/kapanır; kalite düşerse kullanıcı kapatır.

### L6 — Uzağa göndermeden önce ön eleme

50 dosyayı uzak modele göndermek yerine **yerel model hangilerinin ilgili olduğunu seçer**,
yalnızca o 5 dosya gider. R2'deki indeksin üstüne ikinci bir süzgeç.
Aynı mantık sohbet geçmişine de uygulanır (Q2'nin otomatik hâli).

### L7 — Hata ve günlük özetleme

Yığın izleri (stack trace), derleme çıktıları, test logları binlerce token eder ve çoğu gürültüdür.
O4'teki doğrula-düzelt döngüsünde çıktı **önce yerel modelde özetlenir**, uzak modele
"şu dosyada şu hata" diye üç satır gider.
**O4 bu olmadan ücretsiz katmanda çok pahalı.**

### L8 — Gizlilik duvarı

Bir klasörü/bilgi bankasını "yalnızca yerel" işaretleyebilme. O içerik **hiçbir koşulda** uzak
sağlayıcıya gitmez; yönlendirme o iş için otomatik yerel modeli seçer.
Gerçek müşteri/özel projeler için gerekli, ve web sağlayıcılarda (Faz F) daha da önemli.

### L9 — Güvenlik kapısı

Otonom mod bir komut çalıştırmadan veya dosya silmeden önce **yerel model "bu yıkıcı mı?"**
diye denetler. Bedava, hızlı, ve O1'deki geri alma ile birlikte ikinci koruma katmanı.
Şüpheliyse auto mode'da bile kullanıcıya sorar.

### L10 — Faz D'de işçi

Baş kontrolcü basit alt görevleri (biçimlendirme, liste çıkarma, isimlendirme, sınıflandırma)
doğrudan yerel modele dağıtır. Uzak işçiler yalnızca gerçekten düşünme isteyen parçaları alır.

### L11 — Gece işleri tamamen yerel

Q10 + Faz M ile: geceye zamanlanan ağır işler yerel modelde koşarsa **sıfır kota** harcar.
Sabah sonucu okursun; yetersizse uzak modelle rötuşlarsın (L5).

### L12 — LM Studio model yönetimi

Uygulama içinden LM Studio'daki yüklü modelleri listeleme ve değiştirme
(`/v1/models` uç noktası). Hangi işin hangi yerel modele gideceği ayrı ayrı seçilebilsin —
gömme için ayrı, sohbet için ayrı.

### L13 — Pratik kurulum notları (Opus bunları kullanıcıya söylesin)

- LM Studio'da **"Local Server" sekmesinden sunucu başlatılmalı**; kapalıyken uygulama bağlanamaz.
  W3'teki sağlık ekranı bunu açıkça göstersin.
- Düşük sistemde **1–3B boyut** mekanik işler için yeterli (sınıflandırma, özetleme, ön eleme).
  L5'teki taslak yazma için 7–8B daha iyi sonuç verir — RAM'e göre seçilmeli.
- Yerel modellerin **bağlam penceresi küçük**; L6/L7 zaten girdiyi küçülttüğü için bu uyumlu.
- **Araç çağırma desteği yerel modellerde değişkendir** — R3'teki yetenek doğrulaması burada
  kritik. Aracı desteklemeyen yerel modele L9/L10 işi verilmemeli.
- LM Studio anahtar istemez: sağlayıcı kaydı `authOptional: true` olmalı, yoksa kota/anahtar
  katmanı boşuna devreye girer.

---

## Ek 1 — Gemini'nin önerdiği sisteme cevap

Gemini "Open WebUI + Cline + Dify + n8n + ComfyUI'yi Docker'la birleştir" dedi.
**Bunların yaptığı işin neredeyse tamamı Cherry Studio'da tek uygulamada zaten var.**
4 ayrı Docker konteyneri kurup birbirine bağlamana gerek yok.

| Gemini'nin maddesi | Cherry Studio'daki karşılığı |
|---|---|
| 1. Bilgisayar kontrolü, dosya/proje işlemleri (Cline, Open Interpreter) | `@cherry/filesystem` MCP + `ClaudeCodeProcessManager` + `CodeCliService` — **var**, Faz G açacak |
| 2. Resim üretimi (ComfyUI, DALL-E) | Paintings modülü + `imageGenerationJobHandler` — **var** |
| 3. Video üretimi (Luma, Runway) | `videoGenerationJobHandler` + modelscope/dashscope/silicon — **var** (`GOREVLER.md` Faz 4) |
| 4. Yönlendirme / "abaküs" (Open WebUI) | `ModelRoutingService` + `deriveRoutingTable` — **var**, Faz D tamamlıyor |
| 5. Kitap eğitmeni, RAG (Open WebUI) | Bilgi bankası + `CourseService` + `buildSyllabusJobHandler` — **var** (`GOREVLER.md` Faz 5) |
| 6. Web otomasyonu (n8n) | `@cherry/browser` MCP (CDP) — **var**, Faz F açacak |
| 7. Token/kullanım kontrolü (admin panel) | `AiUsageRecordService` + Kullanım Analizi — **var**, Faz B tamamlıyor |
| 8. Çoklu ajan / görev dağılımı (Dify) | `AgentSessionRuntimeService` + `JobManager` + `agent.task` — **var**, Faz D tamamlıyor |
| 9. Yerel model | `LocalModelService`, Ollama, OVMS — **var**, Faz L bağlayacak |

**Gemini'nin mesajında bizde olmayan tek fikir:** n8n tarzı **zamanlanmış/tetiklenen iş akışları**.
Onun da temeli var (`SchedulerService`, Ayarlar → Zamanlanmış Görevler) — Faz M'ye koydum.

**Gemini'nin atladığı, bizde olan:** Hareket/masaüstü otomasyonu (Faz I), anahtar bazlı kota
kontrolü (Faz B), site içi model seçimi (F2.3), hafıza katmanları (Faz K).

---

## Faz M — Zamanlanmış iş akışları (Gemini'nin n8n maddesi)

`SchedulerService` ve "Zamanlanmış Görevler" ayar sayfası **var**. Eksik olan: bir görevi
**çok adımlı akış** olarak tanımlayabilmek.

- Akış = sıralı adım listesi; her adım bir model + istem + araç kümesi.
- Tetikleyici: zaman (cron), dosya değişikliği, veya elle.
- Faz D'deki kontrolcü akışı üretebilir ("şunu her sabah yap" → akış taslağı).
- Çıktı sohbete veya dosyaya yazılır.

Bu, Faz G'deki otonom kodlama ile aynı `JobManager` altyapısını kullanır — yeni motor yok.

---

## Ek 2 — Kurulabilecek hazır MCP eklentileri

Cherry Studio MCP istemcisi olduğu için ekosistemdeki sunucular **kod yazmadan** eklenir
(Ayarlar → MCP). Bu projeye doğrudan değer katanlar:

| Sunucu | Ne katar | Not |
|---|---|---|
| `@modelcontextprotocol/server-memory` | Bilgi grafiği hafızası | **Gerekmez** — `@cherry/memory` aynısı, zaten gömülü |
| `@modelcontextprotocol/server-sequential-thinking` | Adım adım akıl yürütme | **Zaten gömülü** (`sequentialthinking.ts`) |
| `@modelcontextprotocol/server-filesystem` | Dosya işlemleri | **Zaten gömülü** (`@cherry/filesystem`) |
| Playwright / Puppeteer MCP | Tarayıcı otomasyonu | `@cherry/browser` zaten var; yalnızca headless toplu iş gerekirse |
| `@modelcontextprotocol/server-github` | Repo, issue, PR işlemleri | **Ekle** — kod projelerinde işe yarar |
| `@modelcontextprotocol/server-sqlite` | Yerel veritabanı sorgulama | **Ekle** — veri işleri için |
| `@modelcontextprotocol/server-time` | Saat/zaman dilimi | Küçük ama zamanlayıcı işlerinde gerekli |

**Önemli:** Yeni MCP sunucusu kurmadan önce `src/main/ai/mcp/servers/` içine bak — çoğu zaten
gömülü. Dışarıdan kurulan sunucu ayrı süreç açar, düşük sistemde maliyetlidir.

---

## Faz N — Kullanım kolaylığı ve güvenlik ağı (ONAYLANDI)

1. **Anahtar sağlık panosu** — tüm anahtarların son durumu tek ekranda, tıkla-yenile. Kaç anahtar
   varsa o kadar değerli.
2. **"Bu görevi kim daha ucuza yapar" önerisi** — göndermeden önce "bunu ücretsiz X modeli de
   yapabilir" uyarısı. Kota tasarrufu.
3. **Konuşma dışa aktarma / şablon** — sık kullanılan iş akışını ("şu klasörde şu tip uygulama
   yap") kaydet, tek tıkla çalıştır.
4. **Maliyet tavanı** — "günde en fazla şu kadar ücretli istek" sert sınırı. Yanlışlıkla ücretli
   anahtarı boşaltmaya karşı.
5. **Çıktı doğrulayıcı** — kod üreten turdan sonra otomatik `pnpm lint` / test çalıştır, hata
   varsa aynı modele geri besle. Otonom modda kaliteyi ciddi artırır.
6. **Farklı model cevaplarını yan yana karşılaştırma** — D'deki N cevabı tablo hâlinde göster,
   beğendiğini seç (J7 ile puanlamayı besler).
7. **Çevrimdışı kuyruk** — internet yokken istekler kuyruğa alınsın, bağlantı gelince gitsin.
8. **Anahtar içe/dışa aktarma** — onlarca anahtarı elle girmek yerine dosyadan yükle.
9. **Sesli komut** — uygulamada STT/TTS altyapısı var (`OcrInferenceService`, ses modelleri);
   "şunu yap" demek yazmaktan hızlı.
10. **Ekran bölgesi seçip sor** — Hareket (Faz I) ekran görüntüsü alabildiğine göre, bir bölgeyi
    seçip "bu ne?" diye sormak neredeyse bedava bir ek.

---

## Faz O — Otonom modu güvenli ve ucuz yapan katman (ONAYLANDI)

Faz G/I'yı gerçekten kullanılabilir yapan parçalar. Bunlar olmadan otonom mod ya korkutucu
ya da pahalı olur.

### O1 — Kontrol noktası ve tek tıkla geri alma ⭐ (en kritik madde)

Otonom tur başlamadan **önce** çalışma klasörünün anlık görüntüsü alınır; tur bitince
"her şeyi geri al" düğmesi çıkar.
- Klasör git deposuysa: otomatik `git stash`/geçici dal — bedava ve güvenilir.
- Değilse: değişen dosyaların kopyası `.cherry/checkpoints/<zaman>/` altına.
- **Bu olmadan auto mode'u açmak riskli.** G2'den önce yapılmalı.

### O2 — Diff önizleme

Ajanın yaptığı her dosya değişikliği sohbette **diff olarak** görünür, satır satır geri alınabilir.
Bugün `@cherry/filesystem` `edit`/`write` sessizce yazıyor — ne değiştiğini görmüyorsun.

### O3 — Adım adım git commit'i

Otonom tur her mantıklı adımdan sonra `--signoff` ile commit atar (mesajlar İngilizce,
Conventional Commit). Böylece herhangi bir adımı `git revert` ile geri alırsın.
Kullanıcı isterse kapatılır.

### O4 — Doğrula-düzelt döngüsü ⭐

Kod üreten tur bitince otomatik `pnpm lint` / ilgili test çalıştırılır.
- Hata varsa çıktı **aynı modele** geri beslenir, en fazla N deneme (varsayılan 3).
- N dolarsa Faz C ile **daha iyi modele yükselir**, tekrar dener.
- Hâlâ olmazsa durur ve sana hatayı gösterir — sessizce bozuk kod bırakmaz.
- Terminal erişimi için `CodeCliService` ve `python.ts` MCP'si zaten var.

### O5 — Ucuzdan pahalıya tırmanma ⭐ (ücretsiz anahtar ekonomisi)

Her işi en pahalı modele göndermek yerine: **önce en ucuz/ücretsiz model dener**.
Çıktı O4'teki doğrulamayı geçerse iş biter. Geçmezse bir üst modele tırmanır.
Tercih: `chat.routing.escalation_enabled` (varsayılan açık, çünkü kota koruyor).
Kolay işlerin çoğu ilk adımda biter — ücretli anahtar neredeyse hiç harcanmaz.

### O6 — Paralel yarış modu

Ücretsiz API'ler yavaş ve güvenilmez. Aynı istek 2–3 ücretsiz modele **aynı anda** gider,
**ilk cevaplayan** kazanır, diğerleri iptal edilir.
- J3'teki anahtar kilidi burada zorunlu (aynı anahtara iki istek gitmesin).
- Kota pahalı olduğu için varsayılan kapalı, "acelem var" düğmesi olarak açılır.

---

## Faz P — Anahtar yönetimini ölçeklendiren araçlar (ONAYLANDI)

Onlarca anahtarla çalışacaksan bunlar elle iş yükünü bitirir.

### P1 — Anahtar yapıştır, kendi kendini kursun

Anahtarı yapıştırınca uygulama hemen:
- Sağlayıcıyı anahtar biçiminden tahmin eder (`sk-`, `sk-or-`, `gsk_` …),
- Model listesini çeker,
- Hızlı bir sağlık probu atar,
- Yanıt başlıklarından (`x-ratelimit-*`) limiti okuyup **B6 tablosunu otomatik doldurur**.

Elle limit girme sadece başlık vermeyen sağlayıcılar için kalır.

### P2 — Tersine model arama

"DeepSeek V4 Flash istiyorum" → onu **şu an** verebilecek tüm anahtarların listesi,
kalan hakka göre sıralı. Hangi sağlayıcıda olduğunu hatırlamana gerek kalmaz.

### P3 — Anahtar rotasyon politikası

Aynı sağlayıcıda birden çok anahtar varken sıra nasıl gelsin:
- **Sırayla tüket** (biri bitsin, sonra diğeri) — günlük sıfırlanan kotalar için iyi.
- **Dönüşümlü dağıt** (round-robin) — dakikalık oran sınırları için iyi.
Anahtar başına seçilebilir; varsayılan dönüşümlü.

### P4 — Kota tükenme tahmini

Kullanım hızından "bu gidişle X saat sonra biter" hesaplanır, %80'de uyarı verilir.
B6 tablosuna bir sütun, yeni veri gerekmiyor (`aiUsageRecord` zaten zaman damgalı).

### P5 — Site kotasını sayfadan öğrenme

Faz F'teki web sağlayıcıları limitlerini sayfada yazıyor ("günlük hakkınız doldu" gibi).
Adaptöre `quotaExhaustedPattern` alanı eklenir; bu metin görülünce model **B7'deki gibi
otomatik pasife düşer**, sen hiçbir şey yapmadan.

### P7 — Sağlayıcı başına ağ/proxy ayarı ⭐

> *"IP/VPN'i yabancı siteler için sormuştum; elle ayarlasaydım telefondan bağlanma hakkımı da
> orada kullanırdım"*

Bu **kota atlatma değil, bağlantı yönetimi** — ve gerçek bir ihtiyaç:
- Bazı sağlayıcılar Türkiye'ye hizmet vermiyor; erişmek için desteklenen bölgeden çıkmak gerekiyor.
- Hangi isteğin hangi bağlantıdan (ev / telefon paylaşımı / VPN) gideceğini seçmek istiyorsun.

Bugün `ProxyService` **global** (açılış logu: `apply proxy: system`) — ya hepsi proxy'den geçiyor
ya hiçbiri.

Yapılacak: her sağlayıcı kaydına `proxy?: 'system' | 'direct' | { url }` alanı.
- Varsayılan `'system'` — bugünkü davranış aynen sürer.
- Bir sağlayıcıyı VPN/proxy üzerinden, diğerini doğrudan bağlayabilirsin.
- Web sağlayıcılarda (Faz F2) ilgili webview oturumu da aynı proxy'yi kullanır.
- **Sabit tek çıkış noktası** kullanılır; otomatik döndürme **yok** (Ek 6).
- W3 sağlık ekranında her sağlayıcının hangi çıkıştan gittiği ve çıkış IP'sinin ülkesi görünür —
  bölge kısıtlı sağlayıcıda "doğru yerden mi çıkıyorum" sorusunu cevaplar.

Not: Electron'da süreç başına ağ arayüzü (ör. telefon paylaşımı) doğrudan seçilemez; pratik
karşılığı o bağlantı üzerinden dinleyen bir proxy adresi girmektir.

### P6 — Anahtar dosyadan içe/dışa aktarma

`.env` veya CSV'den toplu yükleme, şifreli dışa aktarma. Yeni makineye geçerken
onlarca anahtarı elle girmekten kurtarır.

---

## Faz Q — Bağlam ve akış kolaylıkları (ONAYLANDI)

1. **Bağlam bütçesi göstergesi** — göndermeden önce "bu tur bağlamın %70'ini kullanacak"
   uyarısı. Ücretsiz modellerin küçük penceresinde bağlam taşmasını önler.
2. **Seçici bağlam** — hangi eski mesajların gönderileceğini tikleyerek seç. Uzun sohbetlerde
   kota tasarrufu.
3. **Model uzmanlık etiketi** — "bu model kodda iyi, şu çeviride iyi" diye elle etiketle;
   J7'deki otomatik öğrenmenin yanında insan bilgisi olarak yönlendirmeye girsin.
4. **Toplu iş** — aynı istemi N dosya/satır üzerinde çalıştır (toplu çeviri, toplu özet).
5. **Proje yığını tanıma** — klasördeki `package.json` / `requirements.txt` okunup ajanın
   sistem istemine otomatik eklensin; "burada pnpm kullanılıyor" demene gerek kalmasın.
6. **Oturum sağlığı uyarısı** — web sağlayıcıda çıkış yapılmışsa sessizce başarısız olmak
   yerine "şu siteye tekrar giriş yap" desin.
7. **Çalışma günlüğü** — otonom tur ne yaptıysa tek dosyaya yazsın; ertesi gün "dün ne yaptı"
   diye bakabilesin (Faz K'daki proje belleğini de besler).
8. **Kısayol: model değiştir** — klavyeden hızlı model değiştirme (`ShortcutService` var).
9. **İstek tekrar oynatma** — başarısız bir isteği farklı modele/anahtara tek tıkla yeniden gönder
   (A1'in genel hâli).
10. **Gece modu işleri** — ücretsiz kotalar gece boşken ağır işleri zamanla (Faz M ile birleşir).

---

## Faz R — Senin yerine düşünülmüş özellikler (YENİ)

Bunları sen istemedin; "bu uygulamayı her gün kullansam beni ne delirtir" diye düşünüp yazdım.
Çıkarmak istediğin olursa söyle.

### R1 — Kesilen cevabı otomatik sürdürme ⭐⭐ (ücretsiz katmanın 1 numaralı derdi)

> **Ön araştırma yapıldı — sıfırdan aramaya gerek yok.**
>
> **Kesilmenin görüldüğü yer:** `src/main/ai/runtime/aiSdk/Agent.ts:373` — akış bittikten sonra
> `const steps = await Promise.resolve(result.steps)` var; `steps.at(-1)?.finishReason === 'length'`
> kesilmeyi verir. `pendingFinish` (`:333`, `:356`) tam bu noktada tutuluyor, yani bitiş işareti
> henüz yazılmamış durumda — araya girmek için doğru yer burası.
>
> **AI SDK kendiliğinden sürdürmüyor.** `stopWhen` (`loop/toolLoopTermination.ts`) araç çağrısı
> döngüsünü yönetiyor; araç çağrısı olmayan bir `length` bitişi döngüyü bitiriyor.
>
> **İki yol var, ikisinin de bedeli farklı:**
>
> 1. **Tek mesajda sürdür (istenen davranış, zor yol).** Aynı `writer` açıkken yeni bir
>    `streamText` başlatıp parçaları aynı mesaja yazmak. Dokunulan hassas noktalar:
>    `hasUsedProvidedMessageId` (`:325`) mesaj kimliği tekrarı, `text-start`/`text-delta`/`text-end`
>    parça eşleşmesi, `steps` ve kullanım (token) muhasebesinin toplanması, araç durumu.
>    **Yarım yapılırsa bozuk mesaj üretir — ya tam yap ya hiç.**
> 2. **Devam turu zincirle (kolay yol, farklı UX).** Mevcut tur zincirleme düzeneğini kullanmak
>    (`AiStreamManager.scheduleNextChatTurn`, bugün yalnızca `steer-continuation` için).
>    Cevap iki ayrı mesaj olarak görünür ama otomatik gelir ve risk çok düşük.
>
> **GÜNCELLEME — yarısı yapıldı, tasarım netleşti. Yukarıdaki iki yol da geçersiz.**
>
> **Bitti:** kesilme algılanıp `MessageStats.finishReason` olarak saklanıyor.
> Tek dokunulan yer `src/main/ai/runtime/aiSdk/observers/usage.ts` — `onStepFinish` zaten her adımda
> `message-metadata` yazıyor ve o meta veri veritabanına kadar gidiyor, yani sinyal yolu hazırdı.
> `stats` bir JSON sütunu olduğu için migrasyon gerekmedi. 8 test.
>
> **Kalan: ekran + sürdürme.** Doğru mekanizma `prepareContinueDispatch`
> (`PersistentChatContextProvider.ts:664`) — onay sonrası turu sürdürmek için yazılmış ve tam
> istediğimizi yapıyor: **aynı mesaj satırını yeniden kullanıyor**, geçmişi o mesajdan kuruyor
> (yani model kendi yarım çıktısını görüyor), sonucu `assistantMessageId: anchor.id` ile **aynı
> mesaja** yazıyor. Yani tek mesajda sürdürme zaten mümkün, yeniden yazmaya gerek yok.
>
> **Yapılacak sıra:**
> 1. `shared/ai/transport/stream.ts` — `AiStreamOpenRequest`'e `'continue-truncated'` tetikleyicisi
>    (ayrımlı birleşim, diğer dallardaki alanlar `never`).
> 2. `context/dispatch.ts` + `prepareDispatch` — bu tetikleyiciyi boş `approvalDecisions` ile
>    `prepareContinueDispatch`'e yönlendir.
> 3. **⚠ Riskli adım:** `AiStreamManager` kabul mantığında tetikleyiciye göre dallanan yerler var
>    (`req.trigger !== 'steer-continuation'`, `req.trigger === 'continue-conversation'`). Yeni
>    tetikleyicinin hangi kovaya düştüğü tek tek kontrol edilmeli — A2'deki takılma tam bu alanda
>    yaşıyordu.
> 4. Renderer: `messageMenuBarActions.tsx`'e "devam et" eylemi,
>    `metadata.stats.finishReason === 'length'` iken görünsün.
> 5. Otomatikleştirme en son: tercih + deneme sayacı (en fazla 3), elle düğme çalıştığı doğrulandıktan
>    sonra.

Ücretsiz API'ler `max_tokens`'ı düşük tutar; cevap cümlenin ortasında kesilir
(`finishReason: 'length'`). Bugün elle "devam et" yazman gerekiyor.

Yapılacak: `finishReason === 'length'` görülünce **aynı tur içinde** otomatik devam isteği atılır
ve çıktı kesintisiz birleştirilir. Sınır: en fazla N devam (varsayılan 3), sonra durur.
Kullanıcı hiçbir şey fark etmez. **Uzun kod üretiminde bu olmadan ücretsiz modeller kullanılamaz.**

### R2 — Klasörü otomatik indeksle ⭐⭐ (en büyük token tasarrufu)

G1'de klasör seçilince arka planda bilgi bankasına indekslenir (`KnowledgeService` + RAG **var**).
Ajan "bu projede X nerede?" diye sorduğunda tüm dosyaları okumak yerine **ilgili 3 parçayı** çeker.
- Düşük sistemde indeksleme yerel embedding ile yapılır (`localEmbeddingProvider` **var**).
- Dosya değişince artımlı güncellenir.
- **Kazanç:** büyük projede bir soru 200 bin token yerine 3 bin token eder.

### R3 — Yetenek doğrulama (sessiz çökmeleri bitirir)

Model listesindeki "araç kullanabilir / görsel okur" etiketleri bugün **isimden ve katalogdan**
tahmin ediliyor, gerçekten denenmiyor. Otonom mod araç desteklemeyen bir modele düşerse
sessizce hiçbir şey yapamaz.

Yapılacak: sağlık probu (J2) sırasında gerçek yetenek de ölçülür — küçük bir araç çağrısı,
küçük bir görsel. Sonuç modele yazılır. **Faz G/O ajan işini yalnızca araç desteği doğrulanmış
modele verir**; olmayanlar o iş için aday listesinden çıkar (sohbette yine seçilebilir — kural 1).

### R4 — Klasör hapsi (sandbox)

Seçtiğin klasörün **dışına yazma kesin reddedilir** — uyarı değil, engel.
`assertSafeKnowledgeRelativePath` deseni zaten var, aynısı `@cherry/filesystem`'e uygulanır.
Auto mode'da bile aşılamaz. Kullanıcı isterse ek klasör yetkisi verir.

### R5 — Hata belleği (aynı hatayı iki kez yapmasın)

Bir adım başarısız olduğunda "ne denendi, neden olmadı" Faz K'daki proje belleğine yazılır.
Sonraki turlar bunu okur. Örnek: "bu projede `npm` değil `pnpm` kullanılıyor, `npm install`
başarısız oldu" — bir kez öğrenir, bir daha yapmaz.
**Otonom modda en çok zaman kaybettiren şey aynı hatayı tekrarlamaktır.**

### R6 — Gördüğünü doğrulama döngüsü (arayüz işleri için)

Faz I ekran görüntüsü alabildiğine göre: uygulama üret → çalıştır → **ekran görüntüsü al** →
modele göster → "istediğim gibi mi?" → değilse düzelt.
O4'teki lint/test döngüsünün görsel karşılığı. Web/arayüz işlerinde "yapsın bitirsin" ancak
bununla gerçek olur.

### R7 — Bittiğinde haber ver

Otonom iş uzun sürüyor, başında beklemeyeceksin. `NotificationService` **var**.
Tur bitince / onay beklerken / tıkandığında bildirim + tek paragraf özet:
"3 dosya oluşturuldu, 1 test kaldı, şurada takıldı."

### R8 — Çalışma alanı (workspace) geçişi

Birden çok proje yürüteceksin. Klasör + proje belleği + seçili modeller + MCP araçları
**tek paket** olarak kaydedilir, tek tıkla geçilir. Her projeye ayrı model takımı kurabilirsin
(ör. bu projede ücretsizler, şu projede ücretli).

### R9 — Anahtar notu ve yenileme bağlantısı

Her anahtarın yanında: nereden alındı, hangi e-postayla, yenileme sayfasının bağlantısı, not alanı.
Kota bitince tek tıkla o sayfaya gidip yenilersin. Onlarca anahtarda "bunu nereden almıştım"
sorusunu bitirir. P1/P6 ile aynı ekranda.

### R10 — "Nereye gitti" kota raporu

B6 tablosu kalanı gösteriyor ama **nereye gittiğini** göstermiyor.
`aiUsageRecord` zaten her isteği kaydediyor: "bugünkü 80 isteğin 60'ı şu otonom işten,
15'i özetlemeden" kırılımı. İsraf ancak görülünce kesilir — L2'nin (yerel modele devretme)
kazancını da bu ölçer.

### R11 — Cevap dili kilidi

Türkçe yazıyorsun, model bazen İngilizce cevaplıyor. Asistan başına "her zaman şu dilde cevapla"
ayarı, sistem istemine eklenir. Küçük ama her gün karşına çıkan bir sürtünme.

### R12 — Taslak koruma

Uzun bir istem yazdın, istek patladı ya da uygulama kapandı — metin kaybolmasın.
`chatDraftCache` **var**, hata yolunda da korunduğu doğrulanacak.

---

## Faz S — Diğer sistemlerde olup bunda olmayanlar

Cursor, Claude Code, Cline, Aider, Open WebUI, Dify ile karşılaştırma. Yalnızca **gerçek boşluklar**
listelendi; zaten olanlar (dallanma, alıntılı web arama, model parametreleri, bilgi bankası,
MCP, yerel model) yazılmadı.

### S1 — Plan modu ⭐⭐ (en büyük boşluk)

Claude Code ve Cline'ın en değerli özelliği: ajan **önce planı gösterir, sen onaylarsın, sonra
yapar**. Bugün Cherry Studio'da ajan doğrudan işe girişiyor.

- Ajan dosyaları okur, plan çıkarır, **hiçbir şey yazmaz**.
- Plan sohbette görünür; sen düzeltir ya da onaylarsın.
- Onaydan sonra uygulama başlar.
- **Ücretsiz API ekonomisi açısından da kritik:** kötü plan ucuza ölür, 40 dosya yazıldıktan
  sonra değil.
- Tercih: `agent.plan_mode` — otonom işlerde varsayılan **açık**.

### S2 — Canlı görev listesi ⭐

Cline/Claude Code çalışırken adım adım ne yaptığını gösterir; sen ortasından müdahale edebilirsin.
Bugün `JobManager` içeride adımları biliyor ama **kullanıcıya göstermiyor**.

- Turun görev listesi sohbette canlı: yapıldı / yapılıyor / sırada.
- Ortasından "şunu atla", "şurayı değiştir" diyebilirsin — tur baştan başlamaz.
- Faz D'deki kontrolcünün çıkardığı bölümleme doğrudan bu listeyi besler.

### S3 — Canlı önizleme ⭐ ("uygulama yap" işinin yarısı bu)

Cursor'ın/Claude'un artifact paneli: üretilen HTML/web uygulaması **anında yanda açılır**,
dosya değişince yenilenir. Cherry Studio'da `WebviewService` ve `MiniAppRuntimeService` **var**,
yalnızca bu amaca bağlanmamış.

- Ajan `index.html` yazınca yan panelde çalışır hâlde görürsün.
- R6'daki "gördüğünü doğrulama" bu panelin ekran görüntüsünü kullanır.
- Dev sunucu gerektiren projelerde `CodeCliService` ile sunucu başlatılır.

### S4 — Dosya @-bahsi

Cursor/Cline'da isteme `@dosya.ts` yazıp o dosyayı doğrudan bağlama koyabilirsin.
Cherry Studio'da `@` model seçiyor, dosya seçmiyor. R2'deki indeks arama iyi ama bazen
**tam olarak hangi dosya** olduğunu sen bilirsin — aramaya token harcamaya gerek yok.

### S5 — Gömülü terminal

Ajan komut çalıştırıyor ama çıktısını göremiyorsun. `CodeCliService` ve `python.ts` MCP'si **var**;
eksik olan görünür bir terminal paneli: ajanın çalıştırdığı her komut ve çıktısı,
sen de aynı terminale yazabiliyorsun. O4'teki doğrula-düzelt döngüsünün gözü bu.

### S6 — Kancalar (hooks)

Claude Code'un hook'ları: olay olunca komut çalıştır. Örnek: dosya yazıldıktan sonra otomatik
`oxfmt`, tur bitince otomatik test. Ayarlar → Zamanlanmış Görevler altyapısı (`SchedulerService`)
buna yakın; tetikleyiciye "ajan olayı" eklenir.

### S7 — Komut makroları

`/gözden-geçir`, `/testleri-yaz` gibi kaydedilmiş istem makroları — argüman alabilen.
"İstemler" sayfası **var** ama argümanlı makro ve sohbetten `/` ile çağırma yok.

### S8 — Satır içi düzenleme

O2'deki diff panelinde bir bloğu seçip "burayı şöyle değiştir" demek. Tam dosyayı yeniden
üretmekten hem hızlı hem çok daha ucuz.

---

## Ek 4 — Ücretsiz API'leri en verimli kullanma stratejisi

Ücretsiz katmanlar dört ayrı yerden sınırlar ve her biri farklı bir çözüm ister:
**(a) günlük istek sayısı · (b) dakikalık istek sayısı · (c) cevap uzunluğu · (d) bağlam penceresi.**

### Altın kural 1 — En ucuz istek, hiç atılmayan istektir

| Ne | Faz | Kazanç |
|---|---|---|
| Aynı istek tekrar sorulursa önbellekten dön | J6 | Tekrar sorular bedava |
| Klasörü indeksle, tüm dosyaları gönderme | **R2** | Büyük projede ~%95 token |
| İndekslemeyi yerel gömmeyle yap | **L4** | İndeksleme tamamen bedava |
| Uzağa göndermeden önce yerelde ele | **L6** | 50 dosya yerine 5 |
| Hata/log çıktısını yerelde özetle | **L7** | O4 döngüsünü ucuzlatır |
| Taslağı yerel yaz, uzak rötuşlasın | **L5** | Çıktı uzunluğunu düşürür |
| Hangi eski mesajlar gitsin, seç | Q2 | Uzun sohbette büyük |
| Eski turları özetle | mevcut | Sürekli |
| **Yeni: istek birleştirme (T1)** | aşağıda | Küçük işlerde 5–10 istek → 1 |

### Altın kural 2 — Mekanik işi akıllı modele yaptırma

Sınıflandırma, özetleme, başlık üretme, olgu çıkarma — bunlar **yüksek hacimli ve aptal** işler.
Bugün ücretsiz API kotanı yiyorlar. **Faz L2** hepsini LM Studio'daki yerel modele devrediyor.
Tek başına günlük hakkının ciddi bir kısmını geri kazandırır.

### Altın kural 3 — Ucuzdan başla, gerekirse tırmanmaya izin ver

**O5**: önce en ucuz/ücretsiz model dener → **O4** çıktıyı lint/test ile doğrular → geçerse iş biter,
geçmezse bir üst modele tırmanır. Kolay işlerin çoğu ilk adımda biter, ücretli anahtar
neredeyse hiç harcanmaz. **Bu ikisi birlikte çalışmalı** — doğrulama olmadan tırmanma kördür.

### Altın kural 4 — Harcanan isteği boşa düşürme

Bir istek gönderildi ve karşılığında kullanılamaz çıktı geldiyse, hak yandı demektir:

| Kayıp nedeni | Çözüm |
|---|---|
| Cevap yarıda kesildi (`finishReason: 'length'`) | **R1** — otomatik sürdür |
| Araç desteklemeyen modele ajan işi gitti | **R3** — yetenek doğrulama |
| Aynı hatalı yol tekrar denendi | **R5** — hata belleği |
| Kota dolu anahtara gidildi | **C + B7** |
| Bozuk kod kabul edildi, sonra elden düzeltildi | **O4** |

### Altın kural 5 — Havuzu doğru tüket

- **P3 rotasyon politikası:** dakikalık sınırda dönüşümlü dağıt, günlük sıfırlanan kotada sırayla tüket.
- **J3 anahtar kilidi:** paralel işçiler aynı anahtarı patlatmasın.
- **J5 bütçe ayırma:** otonom işler günlük hakkın tamamını yemesin, sohbete pay kalsın.
- **B2 sırası:** ücretsiz → deneme → ücretli.
- **H1 kuyruk:** oran sınırına çarpınca reddetme, bekleyip gönder.

### Altın kural 6 — Zamanı kullan

Ücretsiz kotalar gece boş. **Q10 + Faz M**: ağır işleri geceye zamanla, sabah sonucu oku.

### Yeni özellikler (bu analizden çıktı)

**T1 — İstek birleştirme.** Arka arkaya giden küçük istekler (10 dosyanın özeti, 20 satırın
çevirisi) tek istekte birleştirilip tek cevapta parçalanır. Günlük **istek sayısı** sınırı
token sınırından önce dolduğu için bu çok kazandırır.

**T2 — Sistem istemi sıkıştırma + prompt cache.** Her turda aynı uzun sistem istemi tekrar
gönderiliyor. Destekleyen sağlayıcılarda prompt caching açılır; desteklemeyende istem
kısaltılır ve değişmeyen kısım proje belleğine (K2) taşınır.

**T3 — Görev-boyut eşleştirme.** "Bu dosyanın adını değiştir" ile "mimari tasarla" aynı modele
gitmemeli. `taskCategory` sınıflandırması **var**; buna bir de **zorluk** boyutu eklenir ve
kolay işler en küçük modele yönlendirilir. O5'in bir adım öncesi: tırmanmadan önce doğru
basamaktan başla.

**T4 — Kota panosu uyarısı.** P4 tahmini + R10 kırılımı birleşir: "bugün hakkının %70'i
özetlemeye gitti, L2'yi aç" gibi **eyleme dönük** uyarı. Ölçmeden tasarruf olmaz.

---

## Faz U — Veri güvenliği ve kurtarma ⭐⭐ (EN ÖNCELİKLİ)

> *"eskisini baştan yapmıştık, her yeri hataydı, haftalık kota bitti, sildim"*

İki hafta emek ve bir proje kaybedilmiş. Planın geri kalanı ne kadar iyi olursa olsun, bu tekrar
olursa hepsi boşa gider. **Bu faz her şeyden önce yapılmalı.**

### U1 — Otomatik yedek varsayılan AÇIK

`AutoBackupService` **var** ama dört hedefin dördü de kapalı (açılış logu:
*"Automatic backup is disabled or incomplete"* — webdav, s3, local, nutstore).
Yapılacak: **yerel yedek varsayılan açık**, günlük, son 7 kopya saklanır.
Kullanıcı hiçbir şey yapmadan korunmuş olur.

### U2 — Tek dosyada tam dışa aktarma ✅ zaten vardı

Tek `.cherryexport` dosyası: API anahtarları (şifreli) · sağlayıcı ayarları · kota limitleri ·
sohbetler · bilgi bankaları · proje bellekleri (K2) · web adaptörleri (F2) · MCP ayarları ·
çalışma alanları (R8). Yeni makineye tek dosyayla taşınır.
`LegacyBackupManager` ve `archiver` **zaten kurulu**.

**Bulunan durum (yukarıdaki durum tablosunda ayrıntı):** `LegacyBackupManager`'ın mevcut zip
yedeği zaten bunu yapıyor ve başka makineye taşınabiliyor — yeni bir `.cherryexport` formatı
gerekmedi. Gerçek boşluk `~/.cherrystudio` (MCP OAuth/memory.json) idi, kapatılmadı çünkü atomik
restore-journal'ı userData dışına genişletmek gerektiriyordu. API anahtarları düz metin (U5'in işi).
Kapatılan tek şey: ekranın taşınabilirliği ve düz metin riskini artık söylemesi.

### U7 — `~/.cherrystudio` yedeğe girmiyor (U2 denetiminde bulundu)

Yedek `Data` dizinini alıyor ama `CHERRY_HOME` (`~/.cherrystudio`) tamamen dışarıda kalıyor:
MCP OAuth token'ları, `@cherry/memory` sunucusunun bilgi grafiği (`config/memory.json`),
özel MCP registry ve Copilot token'ı geri yüklemede kayboluyor. `LegacyBackupManager.ts`
içinde o yol hiç geçmiyor — doğrulandı.

**Neden hemen yapılmadı:** kapatmak, atomik restore-journal/promotion-gate durum makinesini
(`src/main/data/db/restore/`, `toUserDataRelative` her kaynağın `userData` altında olduğunu
sertçe varsayıyor) ikinci bir köke genişletmek demek. Yanlış yapılırsa geri yükleme yarım
kalır — yani tam olarak yedeklemenin önlemesi gereken şeyi yapar. Kendi oturumunu hak ediyor,
**güçlü model işi**.

### U3 — Otonom işin kurtarılması

Uzun otonom iş sırasında uygulama çökerse iş baştan başlamamalı.
`JobManager` kurtarma desteği **var** (`recovery: 'retry' | 'abandon' | 'singleton'`, açılışta
`Startup recovery complete` logu). Ajan turları bu kapsama alınır: hangi adımda kalındı,
hangi dosyalar yazıldı — açılışta devam etme teklifi.

### U4 — "Şu an ne kaybederim" görünümü

Ayarlar → Veri'de tek ekran: son yedek ne zaman, neler yedekte, neler yedek dışı.
Kullanıcı riskini **görmeden** önlem almaz.

### U5 — Anahtar şifreleme

Onlarca anahtar girilecek. Diskte şifreli tutulmalı, yedeğe şifreli gitmeli, dışa aktarmada
parola sorulmalı. Loglara ve hata raporlarına asla düz metin anahtar düşmemeli
(`apiKeyMasked` alanı `aiUsageRecord`'da zaten var, aynı disiplin her yere).

### U6 — Silmeden önce sor, silmek yerine arşivle

Kullanıcı bir sohbeti/projeyi silerken "geri alınamaz" uyarısı ve 30 günlük çöp kutusu.
Kaybedilen projenin tekrarı bununla engellenir.

---

## Faz V — Düşük sistemde hız

> *"sistemim düşük"*

Açılış logundan gerçek veri: **74 servis, 2.8 sn bootstrap**. Bunların bir kısmı senin için
tamamen gereksiz ve RAM yiyor.

### V1 — Hafif mod ⭐

Tek anahtarla kapatılabilecekler (ölçülen açılış maliyetleriyle):
- `MainNetworkDevtoolsService` — **1006 ms**, yalnızca geliştirici içindir
- `AnalyticsService` — 994 ms
- `TraceStorageService`, `NodeTraceService`, `ClaudeCodeTraceBridgeService` — geliştirici modu kapalıyken zaten atlanıyor, tamamen çıkarılabilir
- `subWindow` warmup penceresi — arka planda boşta bir pencere tutuyor
- `CherryCloudService` (960 ms), `OvmsManager` — bu forkta kullanılmıyor

Tahmini kazanç: açılışta ~3 sn → ~1 sn, ve sürekli birkaç yüz MB RAM.

### V2 — Ağır işlere kaynak tavanı

R2 indeksleme, yerel embedding ve LM Studio aynı anda çalışırsa düşük sistem kilitlenir.
Eşzamanlılık tavanı + "pil/düşük kaynak modunda ağır işi ertele" ayarı.

### V3 — İndeksleme boşta yapılsın

R2 klasör indekslemesi sen yazarken değil, **boşta** çalışsın; sen istek gönderince duraklasın.

---

## Faz W — İlk kurulum ve teşhis

> *"her yeri hataydı"* — hata görünmezse düzeltilemez.

### W1 — Kurulum sihirbazı ⭐

İlk açılışta tek akış: anahtarları yapıştır → **P1 otomatik test edip modelleri ve limitleri
doldursun** → LM Studio varsa bul ve bağla (L1) → çalışma klasörünü seç → bitti.
Bugün bunların hepsi ayrı ayrı ayar sayfalarında; iki hafta kaybın bir kısmı buradan.

### W2 — Hata sözlüğü ⭐

Sağlayıcı hataları anlaşılmaz geliyor (`insufficient_quota`, `model_not_found`,
`context_length_exceeded`, `429`). Her biri için **Türkçe açıklama + ne yapmalı**:
"Bu anahtarın günlük hakkı bitti → oto geçişi aç veya limiti düzelt."
Kod tarafı: mevcut `serializeError` çıktısına eşlenen bir sözlük.

### W3 — Sağlık ekranı

Tek sayfada: kaç sağlayıcı bağlı, kaç anahtar çalışıyor, kaç model yanıt veriyor,
LM Studio ayakta mı, MCP sunucuları çalışıyor mu, son hata ne.
`DiagnosticBundleService` **var** — teşhis paketi üretmek için yeniden kullanılır.

### W4 — Neler yapabilirim sayfası

Özelliklerin çoğu var ama gizli (bu planı yazarken bulduğumuz `@cherry/browser`,
`@cherry/memory`, `@cherry/filesystem` gibi). Kapalı olanları listeleyip tek tıkla açan bir ekran.

---

## Faz X — Abaküs kalitesinde yönlendirme

> *"abaküs kadar iyi, görevi alanındaki uzmana yaptırması"*

Bugünkü yönlendirme skoru `src/shared/utils/modelQuality.ts` ile **model adından tahmin** ediyor
("opus" geçiyorsa iyidir gibi). Abaküs'ün iyi olmasının sebebi bu değil — **ölçülmüş** veri.

### X1 — Yerleşik kıyas testi ⭐⭐

Kategori başına 3–5 sabit test istemi (kod, çeviri, özet, akıl yürütme, araç kullanımı).
Kullanıcı "modellerimi kıyasla" deyince hepsi çalıştırılır, **otomatik puanlanır**
(kod derleniyor mu, JSON geçerli mi, araç çağrısı doğru mu — insan yargısı gerekmez).
Sonuç `deriveRoutingTable`'daki `quality`'yi besler.
**Elinde 50 model varken hangisinin gerçekten iyi olduğunu ancak bu söyler.**

### X2 — Kendi kullanımından öğrenme

J7 (beğendiğin cevap puanı artırır) + J1 (gerçek hata sağlığa yazılır) + O4 (doğrulamayı geçti mi)
üçü birleşip kategori başına canlı sıralama üretir. Zamanla senin işlerinde kim iyiyse o öne çıkar.

### X3 — Üç kaynağın birleşimi

Nihai skor = **kıyas testi (X1)** + **kendi kullanımın (X2)** + **elle etiket (Q3)**.
Ağırlıkları görünür olsun ki neden o modelin seçildiğini anlayasın —
`TaskRoutingSettings` ekranı skor kırılımını **zaten gösteriyor**, yeni kaynaklar oraya eklenir.

### X4 — "Neden bu model" açıklaması

Her cevabın altında tek satır: "kod kategorisi · kıyasta 1. · kalan hak 45 · sağlık iyi".
Yönlendirmeye güven ancak görünürlükle gelir.

---

## Faz Y — Görsel ve video üretiminde de aynı disiplin

> *"resim oluşturabileceğim"*

Görsel/video üretimi **var** (Paintings, `imageGenerationJobHandler`, `videoGenerationJobHandler`)
ama kota/yönlendirme katmanının dışında kalmış.

- **Y1** — Görsel/video modelleri de B6 kota tablosuna girer, B7 pasiflik kuralları uygulanır.
- **Y2** — Ücretsiz görsel sağlayıcı kataloğu (Pollinations **zaten gömülü**: `pollinations.ts`).
  F1'in görsel karşılığı.
- **Y3** — Görselde de ucuzdan pahalıya: önce ücretsiz sağlayıcı, beğenmezsen üste tırman.
- **Y4** — Üretilen görsel/video dosyaları çalışma klasörüne kaydedilebilsin (G1 ile bağlanır),
  böylece ajan ürettiği görseli yaptığı uygulamada kullanabilir.

---

## Faz Z — Mantıksal model havuzu ⭐⭐⭐ (senin örneklerinden çıkan asıl sistem)

> *"Google ücretsiz anahtar veriyor, DeepSeek sudan ucuz, bazı siteler API'sini ücretsiz planda
> veriyor, hep farklı sağlayıcılarda ayrı ayrı var"*

Bu cümlenin altında tek bir gerçek yatıyor: **aynı model birçok sağlayıcıda, farklı fiyat ve
farklı kotayla bulunuyor.** DeepSeek V3'ü OpenRouter'dan bedava, SiliconFlow'dan bedava,
ModelScope'tan bedava, DeepSeek'ten çok ucuz alabiliyorsun. Bugün uygulama bunları **dört ayrı
model** sanıyor. Oysa bunlar tek modelin dört musluğu.

**Bu fazın işi:** dağınık anahtarları **tek büyük havuza** çevirmek.

### Z1 — Model denklik haritası

Her modele bir **kanonik kimlik**: `deepseek-v3`, `qwen2.5-72b`, `llama-3.3-70b`, `gemini-2.0-flash`.
Sağlayıcıya özel kimlikler buna eşlenir:

```
deepseek-v3 ←  openrouter::deepseek/deepseek-chat
            ←  siliconflow::deepseek-ai/DeepSeek-V3
            ←  modelscope::deepseek-ai/DeepSeek-V3
            ←  deepseek::deepseek-chat
```

- Harita **veri olarak** `src/shared/data/presets/modelEquivalence.ts` içinde, kod değil.
- Otomatik tahmin: `apiModelId` normalize edilip (küçük harf, sağlayıcı öneki atılır) eşleştirilir;
  tutmazsa kullanıcı elle eşler.
- Eşleşmeyen model kendi başına bir havuz olur — hiçbir şey kaybolmaz.

### Z2 — Havuzlanmış kota

Kanonik model başına **toplam kalan hak**: "DeepSeek V3 — 4 kaynak, toplam 85 hak".
B6 tablosu hem havuz toplamını hem kaynak kırılımını gösterir.
Bir kaynak tükenince havuz tükenmez.

### Z3 — Şeffaf kaynak değiştirme ⭐ (en güvenli geçiş türü)

Faz C model değiştirdiğinde cevabın **karakteri** değişiyor — bazen istemediğin bir şey.
Ama aynı modelin başka sağlayıcıya geçmesi **kaliteyi hiç değiştirmiyor**.

- Kota dolduğunda / hata alındığında **önce aynı kanonik modelin başka kaynağı** denenir.
- Bu geçiş **oto-geçiş düğmesi kapalıyken bile** yapılır — çünkü model değişmiyor,
  yalnızca musluk değişiyor. Kural 1'e ("elle seçim kazanır") aykırı değil: seçtiğin model aynı.
- Ancak sohbet turunun ortasında değil, tur başında yapılır.

### Z4 — Seçicide gruplama

Model seçicide dört ayrı "DeepSeek V3" satırı yerine **tek satır**:
`DeepSeek V3 · 4 kaynak · 85 hak · en iyi kaynak: SiliconFlow`.
Açınca kaynaklar görünür, istersen belirli kaynağı sabitlersin (mevcut `chat.routing.pinned_model`
deseni).

### Z5 — Kaynak tercih sırası

Kanonik model başına sıra: **bedava → deneme → ucuz ücretli → pahalı ücretli**.
Aynı seviyede olanlar arasında: sağlık iyi olan, gecikmesi düşük olan, kalan hakkı çok olan önce.
J1 ve X1 verileri burayı besler.

### Z6 — "Bu istek nereye gitsin" göstergesi

Göndermeden önce tek satır: `DeepSeek V3 → SiliconFlow (bedava, 40 hak kaldı)`.
Tıklayınca alternatifler ve tahmini maliyetleri. Q1'deki bağlam bütçesiyle aynı yerde.

### Z7 — Sağlayıcı keşif kataloğu

Uygulamayla gelen liste: hangi sağlayıcı hangi kanonik modelleri veriyor, ücretsiz katmanı var mı,
kayıt sayfası nerede. "Bu modeli nereden bedava alabilirim?" sorusunu uygulama cevaplar,
sen forum aramazsın. F1'in kataloğu ile aynı veri.

### Z8 — Yenileme hatırlatıcısı

B3(b)'deki yenileme tarihi gelince bildirim: "OpenRouter hakkın yenilendi" /
"şu deneme anahtarın bugün bitiyor, yenile". P4 tahminiyle birlikte çalışır.

---

## Ek 6 — Ban riski: IP/VPN neden yanlış çözüm

Kullanıcının sorusu: *"Google banlar dedin, diğerleri banlamasın diye nasıl bir sistem kuralım?
IP'yi elle değiştirebilir miyim, VPN üzerinden bağlanır mıyız?"*

**Kısa cevap: IP değiştirmek bu sorunu çözmez, büyütür.** Nedeni teknik:

### Neden geri teper

1. **Ban sebebi IP değil, hesap davranışı.** Siteler otomasyonu istek desenlerinden anlıyor —
   tuş vuruşu zamanlaması, fare hareketi olmaması, milisaniyelik cevap, sabit aralıklar.
   IP'yi değiştirmek bunların hiçbirini gizlemiyor.
2. **VPN/dönen IP, güvenlik alarmını kendisi tetikliyor.** Bir Google/OpenAI hesabına
   sürekli farklı ülkelerden giriş yapılması, o sistemlerde **hesap ele geçirilmiş** sinyalidir.
   Sonuç otomasyon banı değil, **hesap kilidi + kimlik doğrulama** — yani daha kötüsü.
3. **Kural ihlali IP'ye bağlı değil.** Bir sitenin şartları web arayüzünün otomatikleştirilmesini
   yasaklıyorsa, hangi IP'den yaptığın bunu değiştirmiyor. Gizlemek ihlali kurala uygun yapmıyor,
   sadece tespitini geciktiriyor — yakalandığında da ceza daha sert oluyor.
4. **Kaybedeceğin şey büyük.** Ana Google hesabın kilitlenirse e-posta, sürücü, telefon yedeği
   hepsi gider. Birkaç bin bedava token için alınacak risk değil.

**Bu yüzden plana IP rotasyonu, parmak izi taklidi veya CAPTCHA çözme koymuyorum.**
Bunlar tespit atlatma araçlarıdır; hem hesabını riske atar hem işe yaramaz.

### Onun yerine ne yapıyoruz

**1. Önce resmî ücretsiz API (Faz F1) — asıl çözüm bu.**
Aradığın "hakları çok iyi" olan yerlerin çoğunun **resmî ücretsiz API katmanı zaten var** ve
kullanmak tamamen serbest, banlanma riski sıfır. Örnek: Google AI Studio (Gemini için gerçek
bedava anahtar verir), Groq, Cerebras, Mistral, OpenRouter'ın ücretsiz modelleri,
HuggingFace Inference, ve birçok Çin sağlayıcısının (SiliconFlow, ModelScope, Zhipu, Moonshot)
ücretsiz katmanı — bunların hepsi **uygulamada zaten desteklenen normal sağlayıcılar**.

Web arayüzünü sürmek yerine anahtar almak: daha hızlı, daha kararlı, kırılmıyor, ban yok.
**F1'in F2'den önce gelmesinin sebebi bu.**

**2. Kalan siteler için uslu otomasyon (F2.5b).**
Resmî API'si olmayan bir sitede, **kendi hesabınla**, insan hızında, sitenin kendi sınırına
uyarak çalışmak. Ban riskini gerçekten düşüren şey budur — gizlenmek değil, makul davranmak.

**3. Kotayı çoğaltmayı otomasyondan değil, çeşitlilikten al.**
Tek siteyi zorlamak yerine 10 farklı sağlayıcıdan birer ücretsiz anahtar. Faz B/C/P bunun
için var — 10 sağlayıcının günlük hakkı toplamı, tek siteyi zorlamaktan çok daha fazla ve
tamamen risksiz.

### VPN meselesi ayrıca

VPN'i **gizlilik için** kullanmak istersen o ayrı bir konu ve uygulamada karşılığı **zaten var**:
`ProxyService` (açılış logunda `apply proxy: system`). Sistem proxy'sini veya elle proxy
girebiliyorsun. Ama bunu **ban atlatmak için** kullanmak yukarıdaki 2. maddeye takılır —
hesap kilidi riskini artırır. Sabit tek bir çıkış noktası kullanıyorsan sorun değil;
sürekli değişen çıkışlar sorunun kendisi.

---

## Ek 5 — Uzun vadeli risk: üst projeyle ayrışma

Bu bir fork ve üst proje (CherryHQ/cherry-studio) hızlı ilerliyor. Plan büyüdükçe ayrışma artar
ve bir gün üst sürümü almak imkânsız hâle gelir. Baştan disiplin:

1. **Mümkün olduğunca yeni dosya** yaz, mevcut dosyayı değiştirme. (Faz A'da `modelAvailability.ts`
   böyle yapıldı.)
2. **Dokunulan üst-proje dosyalarının listesi** tutulsun — çakışma çıkacak yerler bunlar.
3. **Düzenli `git fetch upstream` + rebase**, aylık. Biriktikçe zorlaşır.
4. **Migrasyon çakışması:** `CLAUDE.md`'deki kural — yeniden üret, asla yeniden adlandırma
   (`pnpm db:migrations:generate`).
5. **Üst projede de var olan bir özelliği yeniden yazma** — önce `git log upstream/main` ile bak.
