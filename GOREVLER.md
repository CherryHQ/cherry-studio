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
- [ ] 0.6 **Madde 3**: MCP dosya sistemi sunucusuna çalışma klasörü bağla → doğrula: klasörde dosya oluşturabiliyor

## Faz 1 — Sağlık hafızası ve kaliteye göre sıralama (Madde 2)

- [x] 1.1 `src/shared/utils/modelQuality.ts` — model kimliğinden 0-100 kalite skoru
- [x] 1.2 Kalıcı sağlık hafızası: `chat.retry.model_health` tercih anahtarı üretildi
- [x] 1.3 `AiService.checkModel` sonucu kalıcı hafızaya yazılıyor (başarı + hata)
- [x] 1.4 Yedek model zinciri sağlık + kalite skoruna göre sıralanıyor (`orderFallbackModels`)
- [ ] 1.5 Aç/kapa anahtarı için **ayar arayüzü** (anahtar `chat.retry.health_priority_enabled` hazır, varsayılan açık) → doğrula: kapatınca elle sıra korunuyor

## Faz 2 — Kota ve çoklu key muhasebesi (Madde 5)

- [x] 2.1 Key başına kullanım sayacı — **zaten var**: `AiUsageRecordService` + `aiUsageRecordTable` (apiKeyId bazlı, maliyet dahil). Yeniden yazılmadı.
- [x] 2.2 Key başına limit: `chat.routing.api_key_limits` tercih anahtarı (günlük/aylık)
- [x] 2.3 `filterKeysWithinQuota` — limiti dolan key seçimden çıkarılıyor; hepsi doluysa hiçbiri elenmiyor (istek reddedilmez), kullanım sorgusu patlarsa da istek engellenmiyor. 5 test.
- [ ] 2.4 Panelde key başına "kalan kota" göstergesi → doğrula: ekranda görünüyor

## Faz 3 — Beyin: kategorize et, alanında en iyiye yaptır (Madde 1)

- [x] 3.1 Kategori sınıflandırıcı: kod / araştırma / yazı / görsel / genel (`src/shared/utils/taskCategory.ts`, Türkçe+İngilizce, model çağrısı yapmaz)
- [x] 3.2 Kategori → model eşleme **veri katmanı**: `chat.routing.category_models` + `chat.routing.auto_enabled` anahtarları
- [x] 3.3 Otomatik yönlendirme: `routeDefaultModelId` — kategori tespiti + sağlıksız adayı atlama + silinmiş modeli yok sayma. **Elle seçim (`mentionedModelIds`) asla ezilmiyor.** 6 test.
- [ ] 3.4 "Neden bu model seçildi" açıklaması → Faz 6'da `TaskRoutingSettings` ile birlikte

## Faz 6 — Kendini optimize eden yönlendirme ⭐ (kullanıcı şartı: key değişince elle ayar yok)

Eşleme tablosu artık **elle doldurulmuyor, türetiliyor**: açık sağlayıcılar × modeller × sağlık ×
kalite × kota. Elle seçim üstte ayrı katman — ezilmiyor, geçersizse okunurken atlanıyor, silinmiyor.

- [x] 6.1 `src/main/ai/routing/deriveRoutingTable.ts` — saf sıralama fonksiyonu, 8 test
- [x] 6.2 `src/main/ai/routing/ModelRoutingService.ts` — lifecycle servisi (`WhenReady`), `serviceRegistry.ts`'e kayıtlı. Tetik: sağlık tercihi değişimi (2sn debounce) + 60sn parmak izi taraması
- [x] 6.3 `routing.derived_table` paylaşılan önbellek anahtarı — main yazar, arayüz okur
- [x] 6.4 `categoryRouting.ts` adayları servisten alıyor (`elle seçilenler → türetilmiş`), 13 test
- [x] 6.5 `chat.routing.auto_enabled` varsayılanı `true`
- [ ] 6.6 `TaskRoutingSettings.tsx` yenile: türetilmiş satırlar "otomatik" etiketli, elle seçilenler sabit, kategori başına "otomatiğe dön" + **"neden bu model"** skor dökümü (Madde 3.4)
- [ ] 6.7 i18n: yeni metinler 13 katalogda (`pnpm i18n:check` eksik çeviriyi reddeder)

### Sonraki fazlar (plan dosyasında ayrıntılı)

- [ ] **Faz 1** — Dosya/görsel/web yeteneklerini varsayılan aç (çalışma klasörü seçici, onay akışı)
- [ ] **Faz 3** — Kota paneli: kullanılan / kalan / **yenilenme zamanı**
- [ ] **Faz 4** — Video üretimi (asenkron iş kuyruğu, ModelScope/DashScope/SiliconFlow)
- [ ] **Faz 5** — Kitap öğretmeni (müfredat + ders ilerlemesi)
- [ ] **Faz 7** — Çoklu AI görev dağıtımı + ana sayfa

## Faz 5 — Ayar arayüzleri (özelliklerin kullanılabilir olması için gerekli)

Motor tarafı bitti ama tercihleri girecek ekran yok; şu an ayarlar sadece veritabanında.

- [x] 5.1 Kategori → model eşleme ekranı: `TaskRoutingSettings.tsx`, Ayarlar > Genel içinde; aç/kapa + 5 kategori için model seçici
- [ ] 5.2 Key başına limit girişi ekranı (Madde 5'in kullanılabilir hâli)
- [x] 5.3 `chat.retry.health_priority_enabled` aç/kapa — yeniden deneme bölümüne eklendi
- [x] 5.4 i18n: `en-us.json` + `tr-tr.json` yazıldı (diğer diller İngilizceye düşer)

## Faz 4 — Manuel kontrol (Madde 4)

- [ ] 4.1 Manuel model seçimi zaten var; üstüne "bu seçimi hatırla/sabitle" → doğrula: yeni sohbette aynı model geliyor

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
- 0.5: CDP üzerinden `app.language=tr-tr` + "Cherry Assistant" prompt="Her zaman Türkçe cevap ver." — uygulama çalışırken uygulandı.
- 0.4: Tam akış doğrulandı. Tek engel: dev modunda ilk çalışmada Vite optimizatör bitince sayfa splash'ta kalıyor, tek `Page.reload()` çözüyor (production'da yok). API key olmadan sync models çalışıyor; mesaj gönderilince "API Key is invalid + Go to Settings" hatası düzgün gösteriliyor.
- 6.1 notu: test gerçek bir tasarım hatası yakaladı — kalite skoru **metin** yeteneğini ölçüyor, görsel üretiminde alakasız. Frontier sohbet modeli adanmış görsel modelini eziyordu; `NATIVE_IMAGE_BONUS = 100` kalite aralığının tamamını aşıyor.
- 6.1 notu 2: yalnızca görsel üreten model (`outputModalities` içinde `text` yok) sohbet turunu cevaplayamaz. "Kolay iş en zayıf adayı seçer" kuralı yüzünden kod kategorisinde seçilip her seferinde patlardı — kategori bazlı uygunluk filtresi eklendi.
- 6.2 notu: `ProviderService`/`ModelService` olay yaymıyor, key eklendiğini haber veremiyor. 60sn parmak izi taraması geçici çözüm; kalıcısı bu servislere `Emitter` eklemek.
- Doğrulama: `typecheck:node` + `typecheck:web` temiz; yönlendirme testleri 8 + 13 geçiyor.
- Ortam: Visual Studio Build Tools (MSVC 14.44) kuruldu — `better-sqlite3` Electron için derlenebiliyor, kurulum paketi üretimi açıldı.
- Engel notu: `@paymoapp/electron-shutdown-handler` derlenemediği için `node_modules` içindeki `dist/index.js`'te native yükleme try/catch'e alındı (modülün kendi kodu zaten `addon = null` durumunu karşılıyor). **Yeniden kurulumda tekrar uygulanmalı.**

---

## Karar defteri (neden böyle)

- **Neden Cherry Studio, neden sıfırdan değil:** sağlayıcı kataloğu, çoklu key rotasyonu, sağlık testi, model seçici ve Türkçe arayüz hazır geliyor; sıfırdan yazmak bunların hepsini yeniden yazmak demekti.
- **Neden sağlık sonucu kalıcı olmalı:** şu an `cacheService.setCasual` ile geçici bellekte; uygulama kapanınca kayboluyor ve model seçilirken zaten okunmuyor.
- **Neden tercih (Preference) katmanı:** sağlık testi arayüzde tetikleniyor ama model seçimi ana süreçte yapılıyor; iki süreçten de okunabilen tek kalıcı katman bu.
