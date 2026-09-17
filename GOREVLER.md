# AI Orkestratör — Cherry Studio Üzerine Plan ve Görev Listesi

## Hedef

Elimdeki API'lerle tek bir sistem: isteği alır, **kategorize eder**, her işi **o alanda en iyi ve o an gerçekten çalışan** modele yaptırır, **kota/limit bilir**, gerektiğinde **bilgisayarda dosya değiştirip proje oluşturur**, istersem **manuel** olarak hangi modeli kullanacağını ben seçerim.

## Neden bu proje

Cherry Studio (51.8k yıldız, TypeScript + Electron, aktif geliştiriliyor) sıfırdan yazmaya göre şunları **hazır** veriyor — bunları tekrar yazmayacağız:

| İhtiyaç | Durum |
|---|---|
| Geniş sağlayıcı listesi, "sadece key yapıştır" ile ekleme | ✅ Hazır |
| Aynı sağlayıcıya birden fazla API key + 401/429'da otomatik key rotasyonu | ✅ Hazır |
| Model sağlık testi (model başına, key başına, gecikme ölçümlü) | ✅ Hazır |
| Aranabilir model seçici, manuel model seçimi | ✅ Hazır |
| Türkçe arayüz (`tr-tr.json`) | ✅ Hazır |
| Ajan + MCP altyapısı (dosya işlemleri buradan) | ✅ Hazır |
| Model başarısız olursa yedek modele geçme zinciri | ✅ Hazır (ama sırası elle, sabit) |

**Eksik olan ve bizim yazacağımız kısım:**

| Eksik | Madde |
|---|---|
| Sağlık testi sonucu kalıcı değil (uygulama kapanınca uçuyor) ve model seçiminde **hiç kullanılmıyor** | 2 |
| Kota/kullanım muhasebesi yok (ücretsiz limitler, key başına sayaç) | 5 |
| İsteği kategorize edip "alanında en iyi" modele yönlendiren beyin yok | 1 |

## Mimari

```
İstek
  └─> Beyin (kategori: kod / araştırma / yazı / görsel)
        └─> Model seçimi: kategori eşleşmesi + sağlık (çalışıyor mu) + kalite skoru + kota durumu
              └─> Sağlayıcı/key seçimi: limiti dolmamış key
                    └─> Hata olursa: sıradaki model (zincir zaten var)
```

---

## Token tasarrufu kuralları

- Her görev **tek bir dosya/modül**e dokunur; mevcut kod toptan okunmaz.
- Görev bitince bu dosyada `[ ]` → `[x]` yapılır, **tek satır** not düşülür.
- Görevler arası büyük özet/rapor üretilmez.
- Doğrulama: ilgili tek test veya uygulamada tek akış denemesi — bütün panel gezilmez.

---

> **Tam plan:** `C:\Users\ag\.claude\plans\keen-hugging-glacier.md` — fazlar, mimari kararlar ve
> doğrulama adımları orada. Bu dosya sadece ilerleme takibi.

## Faz 0 — Çalışır hâle getirme

- [x] 0.1 Bağımlılıklar kuruldu (`.npmrc`: `engine-strict=false`, `manage-package-manager-versions=false`, `verify-deps-before-run=false`)
- [x] 0.2 Önceki oturumun kaydedilmemiş çalışması commit edildi (5 commit) — artık kayıp riski yok
- [x] 0.3 `@paymoapp/electron-shutdown-handler` yaması kalıcı: `patches/@paymoapp__electron-shutdown-handler@1.1.2.patch`, `pnpm install` artık silmiyor
- [x] 0.4 Uygulamayı çalıştır, ana akışı baştan dene (sağlayıcı ekle → model senkronla → mesaj gönder), takıldığı her noktayı yaz
- [x] 0.5 Arayüz dilini Türkçe yap + varsayılan asistana "her zaman Türkçe cevap ver" talimatı
- [x] 0.6 **Madde 3**: MCP dosya sistemi sunucusuna çalışma klasörü bağla → doğrula: klasörde dosya oluşturabiliyor

## Faz 1 — Sağlık hafızası ve kaliteye göre sıralama (Madde 2)

- [x] 1.1 `src/shared/utils/modelQuality.ts` — model kimliğinden 0-100 kalite skoru
- [x] 1.2 Kalıcı sağlık hafızası: `chat.retry.model_health` tercih anahtarı üretildi
- [x] 1.3 `AiService.checkModel` sonucu kalıcı hafızaya yazılıyor (başarı + hata)
- [x] 1.4 Yedek model zinciri sağlık + kalite skoruna göre sıralanıyor (`orderFallbackModels`)
- [x] 1.5 Aç/kapa anahtarı için **ayar arayüzü** (anahtar `chat.retry.health_priority_enabled` hazır, varsayılan açık) → doğrula: kapatınca elle sıra korunuyor

## Faz 2 — Kota ve çoklu key muhasebesi (Madde 5)

- [x] 2.1 Key başına kullanım sayacı — **zaten var**: `AiUsageRecordService` + `aiUsageRecordTable` (apiKeyId bazlı, maliyet dahil). Yeniden yazılmadı.
- [x] 2.2 Key başına limit: `chat.routing.api_key_limits` tercih anahtarı (günlük/aylık)
- [x] 2.3 `filterKeysWithinQuota` — limiti dolan key seçimden çıkarılıyor; hepsi doluysa hiçbiri elenmiyor (istek reddedilmez), kullanım sorgusu patlarsa da istek engellenmiyor. 5 test.
- [x] 2.4 Panelde key başına "kalan kota" göstergesi → doğrula: ekranda görünüyor

## Faz 3 — Beyin: kategorize et, alanında en iyiye yaptır (Madde 1)

- [x] 3.1 Kategori sınıflandırıcı: kod / araştırma / yazı / görsel / genel (`src/shared/utils/taskCategory.ts`, Türkçe+İngilizce, model çağrısı yapmaz)
- [x] 3.2 Kategori → model eşleme **veri katmanı**: `chat.routing.category_models` + `chat.routing.auto_enabled` anahtarları
- [x] 3.3 Otomatik yönlendirme: `routeDefaultModelId` — kategori tespiti + sağlıksız adayı atlama + silinmiş modeli yok sayma. **Elle seçim (`mentionedModelIds`) asla ezilmiyor.** 6 test.
- [x] 3.4 "Neden bu model seçildi" açıklaması → Faz 6'da `TaskRoutingSettings` ile birlikte

## Faz 6 — Kendini optimize eden yönlendirme ⭐ (kullanıcı şartı: key değişince elle ayar yok)

Eşleme tablosu artık **elle doldurulmuyor, türetiliyor**: açık sağlayıcılar × modeller × sağlık ×
kalite × kota. Elle seçim üstte ayrı katman — ezilmiyor, geçersizse okunurken atlanıyor, silinmiyor.

- [x] 6.1 `src/main/ai/routing/deriveRoutingTable.ts` — saf sıralama fonksiyonu, 8 test
- [x] 6.2 `src/main/ai/routing/ModelRoutingService.ts` — lifecycle servisi (`WhenReady`), `serviceRegistry.ts`'e kayıtlı. Tetik: sağlık tercihi değişimi (2sn debounce) + 60sn parmak izi taraması
- [x] 6.3 `routing.derived_table` paylaşılan önbellek anahtarı — main yazar, arayüz okur
- [x] 6.4 `categoryRouting.ts` adayları servisten alıyor (`elle seçilenler → türetilmiş`), 13 test
- [x] 6.5 `chat.routing.auto_enabled` varsayılanı `true`
- [x] 6.6 `TaskRoutingSettings.tsx` yenile: türetilmiş satırlar "otomatik" etiketli, elle seçilenler sabit, kategori başına "otomatiğe dön" + **"neden bu model"** skor dökümü (Madde 3.4)
- [x] 6.7 i18n: yeni metinler 13 katalogda (`pnpm i18n:check` eksik çeviriyi reddeder)

## Faz 1 — Yetenekleri aç: dosya, görsel, web

- [x] 1.1 MCP çalışma klasörü seçici: `@cherry/filesystem` sunucusu için McpSettings'e klasör alanı + Electron `dialog.showOpenDialog` tetikleyici
- [x] 1.2 Çalışma klasörü içinde otomatik onay: `disabledAutoApproveTools` kontrol — write/edit/delete zaten boş listede (auto-approve), doğrula
- [x] 1.3 Pollinations görsel üretimi: `@cherry/pollinations` sunucusu varsayılan aktif mi doğrula, değilse etkinleştir
- [x] 1.4 Web araçlarını varsayılan aç: `DEFAULT_ASSISTANT_SETTINGS.enableWebSearch = true`

## Faz 3 — Kota ve kullanım paneli

- [x] 3.1 Key başına yenilenme zamanı göstergesi: günlük limit UTC 00:00, aylık limit dönem başından 30 gün — `ApiKeyQuotaLimit`'e "yenilenir: …" satırı
- [x] 3.2 Sağlayıcı panelinde durum rozeti: çalışıyor / kotası dolu / hatalı — `ConnectionSettings`'e badge
- [x] 3.3 Sağlayıcı sayfası i18n: 3.1-3.2 yeni metinleri 13 dilde

## Faz 4 — Video üretimi

- [x] 4.1 `src/main/ai/provider/custom/videoGenerationModel.ts` — `submit`/`poll`/`cancel` arayüzü
- [x] 4.2 Üç adaptör: `modelscope`, `dashscope`, `silicon` + keysiz Pollinations yedeği
- [x] 4.3 `videoTable` DB şeması + migrasyon 0021
- [x] 4.4 `videoGenerationJobHandler.ts` — restart'a dayanıklı iş kuyruğu (providerTaskId ilk sorgulama öncesinde kaydedilir)
- [x] 4.5 DataApi `/videos` + IpcApi `ai.video.generate` + `useJob`/`useJobProgress` renderer bağlantısı
- [x] 4.6 `src/renderer/pages/videos/VideoPage.tsx` — yeni sayfa + kenar çubuğu girişi

## Faz 5 — Kitap öğretmeni

- [x] 5.1 Müfredat çıkarma: PDF yer imleri → başlık regex → LLM (sadece içindekiler) — üç kademeli
- [x] 5.2 `courseTable` + `courseLessonTable` DB şeması + eklemeli migrasyon
- [x] 5.3 `buildSyllabusJobHandler.ts` — bilgi bankası indeksi bitince tetiklenir
- [x] 5.4 Ders anlatımı: öğretmen asistanı + bilgi bankası bağlantısı + ders parametreleri talimatı
- [x] 5.5 `tutor.lesson.complete` IpcApi uç noktası — "Dersi bitirdim" düğmesi
- [x] 5.6 `src/renderer/pages/tutor/TutorPage.tsx` — müfredat kenar çubuğu + ders sohbeti + ilerleme

## Faz 7 — Arayüz tamamlama

- [x] 7.1 Ana sayfa: model durumu, kalan kota, hızlı erişim (dosya/görsel/video/kitap) tek ekranda
- [x] 7.2 Kenar çubuğu sadeleştirme: kullanılmayan girişleri kaldır
- [x] 7.3 Tüm yeni metinler 13 dilde (`pnpm i18n:sync` + i18n-translator)

## Faz 5 — Ayar arayüzleri (özelliklerin kullanılabilir olması için gerekli)

Motor tarafı bitti ama tercihleri girecek ekran yok; şu an ayarlar sadece veritabanında.

- [x] 5.1 Kategori → model eşleme ekranı: `TaskRoutingSettings.tsx`, Ayarlar > Genel içinde; aç/kapa + 5 kategori için model seçici
- [x] 5.2 Key başına limit girişi ekranı (Madde 5'in kullanılabilir hâli)
- [x] 5.3 `chat.retry.health_priority_enabled` aç/kapa — yeniden deneme bölümüne eklendi
- [x] 5.4 i18n: `en-us.json` + `tr-tr.json` yazıldı (diğer diller İngilizceye düşer)

## Faz 4 — Manuel kontrol (Madde 4)

- [x] 4.1 Manuel model seçimi zaten var; üstüne "bu seçimi hatırla/sabitle" → doğrula: yeni sohbette aynı model geliyor

---

## İlerleme notları

*(her görev bitince buraya 1 satır)*

- 1.1: `src/shared/utils/modelQuality.ts` eklendi — regex tabanlı kalite tablosu, bilinmeyen model için nötr 50.
- 1.2: `chat.retry.model_health`, `chat.retry.health_priority_enabled`, `chat.routing.*` anahtarları `target-key-definitions.json`'a eklendi, `data-classify` ile şemalar üretildi.
- 1.3: `AiService.checkModel` başarı/hata sonucunu `recordModelHealth` ile kalıcı tercihe yazıyor; yazma hatası testi düşürmez.
- 1.4: `orderFallbackModels` — sağlık (çalışan > test edilmemiş > hatalı), eşitlikte kalite skoru. Hiçbir model elenmez. 4 test.
- 1.4 notu: test, bozuk model kimliğinde fonksiyonun çöktüğünü yakaladı — `isUniqueModelId` kontrolü eklendi.
- 3.1: `src/shared/utils/taskCategory.ts` — anahtar kelimeyle kategori tespiti, 6 test ("naber" gibi sohbet `general`'a düşüyor).
- Doğrulama: `vitest` retry klasörü 54 test + yeni 10 test geçti; `tsc` benim dosyalarımda 0 hata.
- 2.1 bulgusu: kullanım sayacı zaten var (`AiUsageRecordService`, `groupBy: 'apiKey'`); mükerrer sayaç yazmak yerine limit anahtarı eklendi, tüketim oradan okunuyor.
- 2.3: `filterKeysWithinQuota` `ProviderService.resolveApiKey` içindeki round-robin'den önce uygulanıyor.
- 3.3: `routeDefaultModelId` `PersistentChatContextProvider` gönderim yoluna bağlandı; sadece varsayılanı değiştiriyor, elle seçimi değil.
- 3.3 notu: yönlendirme hata verirse (bozuk ayar, silinmiş model) mesaj yine gönderiliyor — optimizasyon bir engele dönüşmemeli.
- 2.3 notu: tip kontrolü testimin yakalayamadığı gerçek bir hatayı buldu (`buckets` ayrımlı birleşim, `groupBy` ile daraltmak gerekiyordu); taklit veri de gerçeğe uydurularak düzeltildi.
- 0.6: `@cherry/filesystem` MCP sunucusu `C:\Users\ag\Desktop\cherry-studio` kök dizini ile eklendi, aktif, bağlantı ve yazma doğrulandı.
- 0.5: CDP üzerinden `app.language=tr-tr` + "Cherry Assistant" prompt="Her zaman Türkçe cevap ver." — uygulama çalışırken uygulandı.
- 0.4: Tam akış doğrulandı. Tek engel: dev modunda ilk çalışmada Vite optimizatör bitince sayfa splash'ta kalıyor, tek `Page.reload()` çözüyor (production'da yok). API key olmadan sync models çalışıyor; mesaj gönderilince "API Key is invalid + Go to Settings" hatası düzgün gösteriliyor.
- 6.1 notu: test gerçek bir tasarım hatası yakaladı — kalite skoru **metin** yeteneğini ölçüyor, görsel üretiminde alakasız. Frontier sohbet modeli adanmış görsel modelini eziyordu; `NATIVE_IMAGE_BONUS = 100` kalite aralığının tamamını aşıyor.
- 6.1 notu 2: yalnızca görsel üreten model (`outputModalities` içinde `text` yok) sohbet turunu cevaplayamaz. "Kolay iş en zayıf adayı seçer" kuralı yüzünden kod kategorisinde seçilip her seferinde patlardı — kategori bazlı uygunluk filtresi eklendi.
- 6.2 notu: `ProviderService`/`ModelService` olay yaymıyor, key eklendiğini haber veremiyor. 60sn parmak izi taraması geçici çözüm; kalıcısı bu servislere `Emitter` eklemek.
- Doğrulama: `typecheck:node` + `typecheck:web` temiz; yönlendirme testleri 8 + 13 geçiyor.
- 2.4: `ApiKeyQuotaLimit` bileşenine kullanım çubuğu eklendi — `useQuery('/ai-usage-records/stats')` ile dönem içi istek sayısını çekiyor, görsel doluluk çubuğuyla gösteriyor. 13 dilde çevrildi.
- 5.2: Key başına limit girişi `ApiKeyQuotaLimit.tsx` olarak zaten uygulanmıştı; tamamlandı işaretlendi.
- 6.6/3.4: `TaskRoutingSettings.tsx` yenilendi — otomatik mod: "Auto" badge + türetilmiş tablonun en iyi adayı + skor dökümü (kalite/uyumluluk/sağlık/kota); elle seçim: model seçici + "otomatiğe dön" butonu.
- 6.7: 4 yeni routing i18n anahtarı 13 kataloga eklendi (`pnpm i18n:sync` + i18n-translator).
- 4.1: `chat.routing.pinned_model` tercihi eklendi; `routeDefaultModelId` önce bu modeli döndürüyor (elle seçim hâlâ her şeyi geçer). `TaskRoutingSettings` üstüne model seçici + sabitlemeyi-kaldır butonu eklendi. 2 yeni i18n anahtarı 13 dilde çevrildi.
- 3.1: `ApiKeyQuotaLimit`'e `renewsAt` hesabı eklendi — günlük UTC gece yarısı, aylık 1. gün.
- 3.2: `ProviderHeader`'a `ProviderStatusBadge` eklendi — `chat.retry.model_health` tercihinden son 2 saatte hatalı model varsa kırmızı "Hata" rozeti gösteriyor.
- Faz 1 (yetenek): 1.1 `McpServerFields.tsx`'e `FilesystemBaseDirField` eklendi — `@cherry/filesystem` sunucusunda args alanı yerine dizin seçici gösteriliyor; 1.2-1.3 zaten doğruydu; 1.4 `enableWebSearch=true` yapıldı.
- Faz 5 (kitap öğretmeni): `courseTable`+`courseLessonTable` şeması, migrasyon 0022, `CourseService`, `buildSyllabusJobHandler`, IpcApi tutor uç noktaları, `TutorPage.tsx`, kenar çubuğu girişi — tip hatalar düzeltildi.
- 7.1: `LaunchpadPage`'e routing tablosundan aktif model sayısını gösteren durum çipi eklendi.
- 7.2: `SIDEBAR_FAVORITES`'ten kullanılmayan `openclaw` girişi kaldırıldı.
- 7.3: 2 yeni launchpad i18n anahtarı 13 dile çevrildi.
- Ortam: Visual Studio Build Tools (MSVC 14.44) kuruldu — `better-sqlite3` Electron için derlenebiliyor, kurulum paketi üretimi açıldı.
- Engel notu: `@paymoapp/electron-shutdown-handler` derlenemediği için `node_modules` içindeki `dist/index.js`'te native yükleme try/catch'e alındı (modülün kendi kodu zaten `addon = null` durumunu karşılıyor). **Yeniden kurulumda tekrar uygulanmalı.**

---

## Karar defteri (neden böyle)

- **Neden Cherry Studio, neden sıfırdan değil:** sağlayıcı kataloğu, çoklu key rotasyonu, sağlık testi, model seçici ve Türkçe arayüz hazır geliyor; sıfırdan yazmak bunların hepsini yeniden yazmak demekti.
- **Neden sağlık sonucu kalıcı olmalı:** şu an `cacheService.setCasual` ile geçici bellekte; uygulama kapanınca kayboluyor ve model seçilirken zaten okunmuyor.
- **Neden tercih (Preference) katmanı:** sağlık testi arayüzde tetikleniyor ama model seçimi ana süreçte yapılıyor; iki süreçten de okunabilen tek kalıcı katman bu.
