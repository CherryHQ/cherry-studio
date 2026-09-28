# Cherry Studio Üzerine Kurulan Orkestrasyon Sistemi — Teknik Döküman

Bu dosya, Cherry Studio 2.0.14 fork'una eklenen model yönlendirme / sağlık / kota katmanını anlatır.
Başka bir araca (Copilot vb.) devretmek için hazırlanmıştır.

## Amaç

Elde birden çok ücretsiz/kısıtlı API anahtarı var. Sistem her isteği, **o iş için uygun**,
**o an gerçekten çalışan** ve **kotası dolmamış** modele göndermeli; hiçbir noktada isteği
reddetmemeli.

## Veri akışı

```
Kullanıcı mesajı
  │
  ├─ (elle model seçildiyse) ──────────────────────► o model kullanılır, aşağısı atlanır
  │
  ├─ routeDefaultModelId()            [kategori + zorluk ile varsayılanı değiştirir]
  │     ├─ classifyTaskCategory()     → code | research | writing | image | general
  │     ├─ estimateTaskDifficulty()   → hard | easy
  │     └─ sağlık hafızası + kalite skoru ile aday seçer
  │
  ├─ resolveApiKey()                  [sağlayıcı içinde anahtar seçimi]
  │     └─ filterKeysWithinQuota()    → limiti dolan anahtarı eler
  │
  └─ readRetryPolicy()                [başarısızlıkta yedek zinciri]
        ├─ yapılandırılmış liste varsa onu, yoksa buildAutoFallbackModelIds()
        └─ orderFallbackModels()      → sağlık, sonra kalite sırasına dizer
```

## Eklenen dosyalar

| Dosya | İşi |
|---|---|
| `src/shared/utils/modelQuality.ts` | Model kimliğinden 0-100 kalite puanı (regex tablosu, Eylül 2026 modelleri dahil) |
| `src/shared/utils/taskCategory.ts` | Kategori tespiti + zorluk tahmini (TR/EN anahtar kelime) |
| `src/shared/utils/apiKeyLimit.ts` | `providerId::keyId` kimlik üreteci (ana süreç ve arayüz ortak kullanır) |
| `src/main/ai/runtime/aiSdk/retry/modelHealthMemory.ts` | Sağlık testi sonucunu kalıcı tercihe yazar |
| `src/main/ai/runtime/aiSdk/retry/orderFallbackModels.ts` | Yedek zincirini sağlık + kaliteye göre sıralar |
| `src/main/ai/runtime/aiSdk/retry/autoFallbackModels.ts` | Liste boşsa sağlıklı modellerden otomatik zincir kurar |
| `src/main/data/services/apiKeyQuota.ts` | Limiti dolan API anahtarını seçimden eler |
| `src/main/ai/streamManager/context/categoryRouting.ts` | Kategori + zorluk + sağlık ile varsayılan modeli seçer |
| `src/renderer/pages/settings/GeneralSettings/TaskRoutingSettings.tsx` | Kategori→model eşleme arayüzü |
| `src/renderer/pages/settings/ProviderSettings/ConnectionSettings/ApiKeyQuotaLimit.tsx` | Anahtar başına limit girişi |

## Değiştirilen dosyalar

| Dosya | Değişiklik |
|---|---|
| `src/main/ai/AiService.ts` | `checkModel` sonucu artık kalıcı hafızaya yazılıyor |
| `src/main/ai/runtime/aiSdk/retry/retryPolicy.ts` | Yedek listesi sağlık sırasına diziliyor, boşsa otomatik üretiliyor |
| `src/main/ai/streamManager/context/PersistentChatContextProvider.ts` | Gönderim yolunda `routeDefaultModelId` çağrısı |
| `src/main/data/services/ProviderService.ts` | `resolveApiKey` içinde kota filtresi |
| `src/main/data/db/seeding/seeders/cherryaiDefaultModelSeeder.ts` | CherryIN sağlayıcıları `isEnabled: false` |
| `scripts/data-classify/data/target-key-definitions.json` | Yeni tercih anahtarları + değişen varsayılanlar |

## Eklenen tercih anahtarları

`scripts/data-classify/data/target-key-definitions.json` içinde tanımlanır, sonra
`cd scripts/data-classify && node scripts/generate-all.js` ile şemalar üretilir.
**Üretilen dosyalar elle düzenlenmez.**

| Anahtar | Tip | Varsayılan |
|---|---|---|
| `chat.retry.model_health` | `ModelHealthMemory` | `{}` |
| `chat.retry.health_priority_enabled` | boolean | `true` |
| `chat.routing.auto_enabled` | boolean | `false` |
| `chat.routing.category_models` | `CategoryModelMap` | `{}` |
| `chat.routing.api_key_limits` | `ApiKeyLimitMap` | `{}` |

## Değiştirilen varsayılanlar

| Anahtar | Eski | Yeni | Sebep |
|---|---|---|---|
| `chat.retry.enabled` | `false` | `true` | Kapalıyken hiçbir otomatik geçiş çalışmıyordu |
| `chat.context_settings.max_messages` | `null` (sınırsız) | `10` | Her mesajda tüm geçmiş gönderiliyordu, ücretsiz kotayı bitiriyordu |

## Tasarım kuralları (bunları bozma)

1. **Elle seçim her zaman kazanır.** `routeDefaultModelId` yalnızca *varsayılanı* değiştirir;
   `mentionedModelIds` doluysa devreye girmez.
2. **Hiçbir istek reddedilmez.** Sağlık testi başarısızsa, kota doluysa veya sorgu hata verirse
   sistem yine dener — sağlayıcı iyileşmiş olabilir. Testlerin çoğu bu davranışı sabitler.
3. **Yönlendirme bir optimizasyondur, engel değil.** Bozuk yapılandırma mesajı durdurmaz;
   hata yakalanır, varsayılana dönülür.
4. **Sağlık sonucu düşürmez, sıralamayı değiştirir.** Son testi başarısız model listeden
   atılmaz, sona alınır.

## Türkçe metin işleme notu

Kalıplarda kapanış `\b` kullanılmaz: Türkçe eklemeli bir dildir, `\buygulama\b` kalıbı
"uygulama**sı**" ile eşleşmez. Tek istisna kısa `yaz\b` fiilidir — kapanış sınırı olmadan
"yazılım" gibi kelimeleri yutar. `yazılım` bilerek `code` kategorisine konmuştur.

## Testler

```bash
./node_modules/.bin/vitest run src/shared/utils/__tests__/ \
  src/main/ai/streamManager/context/__tests__/categoryRouting.test.ts \
  src/main/ai/runtime/aiSdk/retry/ \
  src/main/data/services/__tests__/apiKeyQuota.test.ts
```

Bilinen sorun: `better-sqlite3` şu an **Electron** için derli (uygulamanın çalışması için gerekli).
Gerçek veritabanı açan testler düz Node'da bu yüzden çalışmaz — ikili uyum (ABI) farklı.
Node için geri derlemek uygulamayı bozar; ikisi aynı anda mümkün değil.

## Derleme

```bash
# bağımlılıklar (bir kez)
pnpm install

# uygulamayı derle + çalıştırılabilir üret (kurulum paketi değil)
./node_modules/.bin/electron-vite build
./node_modules/.bin/electron-builder --win --x64 --dir --config.npmRebuild=false
# çıktı: dist/win-unpacked/Cherry Studio.exe
```

### Ortam notları (bu makineye özel)

- `.npmrc`: `engine-strict=false`, `manage-package-manager-versions=false`,
  `verify-deps-before-run=false` — Node 24.20 sürüm kilidini ve pnpm kendi kendini
  kurma davranışını aşmak için.
- `@paymoapp/electron-shutdown-handler` derlenemiyor (hazır ikili yok, Spectre kitaplıkları
  kurulu değil). `node_modules` içindeki kopyasında `install` betiği boşa alındı ve
  `dist/index.js` içindeki native yükleme `try/catch`'e sarıldı — modülün kendi kodu
  `addon = null` durumunu zaten karşılıyor. **Yeniden kurulumda tekrar uygulanmalı.**
- `node-pty` Spectre korumalı kitaplıklar olmadan derlenmiyor; bu yüzden paketleme
  `--config.npmRebuild=false` ile yapılır. Kurulum (NSIS) paketi bu yüzden henüz üretilemiyor.
- `better-sqlite3` Electron için `pnpm rebuild:electron` ile derlendi.

## Yapılmayanlar ve sebepleri

- **CrewAI / AutoGPT / Aider / Crawl4AI**: Python projeleri; bu uygulama Electron/TypeScript.
  Gömmek ayrı çalışma ortamı gerektirir. Karşılıkları uygulamada zaten var: MCP dosya araçları,
  web arama (Jina Reader, anahtarsız), ajan sistemi.
- **Pollinations için özel sağlayıcı adaptörü**: Pollinations basit bir GET-URL servisi;
  uygulamanın görsel sağlayıcı mimarisi OpenAI formatına göre. Adaptör yazmak yerine asistan
  talimatına markdown görsel bağlantısı ürettirmek yeterli ve kırılgan değil.
- **Web paneli otomasyonu (ChatGPT/Claude arayüzünü sürmek)**: kullanım şartlarına aykırı,
  hesap kapanmasına yol açar. Resmi CLI'lar (Claude Code, Gemini CLI) aynı işi yasal yoldan yapar;
  sağlayıcı listesinde `authMethods: ['external-cli']` ile tanımlıdırlar.
