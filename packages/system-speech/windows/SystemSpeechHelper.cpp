#include <windows.h>
#include <sapi.h>
#include <sphelper.h>
#include <wrl/client.h>
#include <winrt/Windows.Data.Json.h>

#include <algorithm>
#include <climits>
#include <cmath>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>

using Microsoft::WRL::ComPtr;
using namespace winrt::Windows::Data::Json;

namespace {

struct HelperError : std::runtime_error {
    explicit HelperError(const char* code) : std::runtime_error(code) {}
};

void require(HRESULT result, const char* code) {
    if (FAILED(result)) throw HelperError(code);
}

std::wstring requiredString(const JsonObject& request, const wchar_t* key) {
    if (!request.HasKey(key) || request.Lookup(key).ValueType() != JsonValueType::String)
        throw HelperError("invalid_request");
    const auto value = request.GetNamedString(key);
    const std::wstring result(value.begin(), value.end());
    if (result.empty() || result.find(L'\0') != std::wstring::npos) throw HelperError("invalid_request");
    return result;
}

JsonObject object() { return JsonObject{}; }

void put(JsonObject& target, const wchar_t* key, const std::wstring& value) {
    target.SetNamedValue(key, JsonValue::CreateStringValue(winrt::hstring(value)));
}

void put(JsonObject& target, const wchar_t* key, const wchar_t* value) {
    target.SetNamedValue(key, JsonValue::CreateStringValue(winrt::hstring(value)));
}

void put(JsonObject& target, const wchar_t* key, int value) {
    target.SetNamedValue(key, JsonValue::CreateNumberValue(value));
}

void put(JsonObject& target, const wchar_t* key, JsonObject value) {
    target.SetNamedValue(key, value);
}

void put(JsonObject& target, const wchar_t* key, JsonArray value) {
    target.SetNamedValue(key, value);
}

JsonObject success(const wchar_t* operation, JsonObject result) {
    auto value = object();
    put(value, L"operation", operation);
    put(value, L"result", result);
    auto envelope = object();
    envelope.SetNamedValue(L"ok", JsonValue::CreateBooleanValue(true));
    put(envelope, L"value", value);
    return envelope;
}

JsonObject failure(const char* code) {
    auto error = object();
    const auto name = winrt::to_hstring(code);
    put(error, L"code", std::wstring(name.c_str()));
    put(error, L"message", std::wstring(name.c_str()));
    auto envelope = object();
    envelope.SetNamedValue(L"ok", JsonValue::CreateBooleanValue(false));
    put(envelope, L"error", error);
    return envelope;
}

std::vector<ComPtr<ISpObjectToken>> tokens(const wchar_t* category) {
    ComPtr<IEnumSpObjectTokens> enumeration;
    if (FAILED(SpEnumTokens(category, nullptr, nullptr, enumeration.GetAddressOf()))) return {};
    std::vector<ComPtr<ISpObjectToken>> result;
    ComPtr<ISpObjectToken> token;
    while (enumeration->Next(1, token.ReleaseAndGetAddressOf(), nullptr) == S_OK) {
        result.push_back(token);
    }
    return result;
}

std::wstring tokenId(ISpObjectToken* token) {
    wchar_t* raw = nullptr;
    require(token->GetId(&raw), "native_helper_failed");
    std::wstring result(raw);
    CoTaskMemFree(raw);
    return result;
}

std::wstring tokenName(ISpObjectToken* token) {
    wchar_t* raw = nullptr;
    if (FAILED(SpGetDescription(token, &raw))) return L"";
    std::wstring result(raw);
    CoTaskMemFree(raw);
    return result;
}

std::vector<LCID> tokenLanguages(ISpObjectToken* token) {
    ComPtr<ISpDataKey> attributes;
    if (FAILED(token->OpenKey(L"Attributes", attributes.GetAddressOf()))) return {};
    wchar_t* raw = nullptr;
    if (FAILED(attributes->GetStringValue(L"Language", &raw))) return {};
    std::wstring languages(raw);
    CoTaskMemFree(raw);
    std::vector<LCID> result;
    size_t start = 0;
    while (start < languages.size()) {
        const auto end = languages.find(L';', start);
        const auto part = languages.substr(start, end - start);
        wchar_t* parsedEnd = nullptr;
        const auto lcid = wcstoul(part.c_str(), &parsedEnd, 16);
        if (parsedEnd != part.c_str() && *parsedEnd == L'\0') result.push_back(static_cast<LCID>(lcid));
        if (end == std::wstring::npos) break;
        start = end + 1;
    }
    return result;
}

std::wstring localeName(LCID lcid) {
    wchar_t name[LOCALE_NAME_MAX_LENGTH]{};
    if (!LCIDToLocaleName(lcid, name, LOCALE_NAME_MAX_LENGTH, 0)) return L"";
    return name;
}

LCID requestedLcid(const std::wstring& locale) {
    const auto lcid = LocaleNameToLCID(locale.c_str(), 0);
    if (!lcid) throw HelperError("unsupported_locale");
    return lcid;
}

ComPtr<ISpObjectToken> recognizerFor(const std::wstring& locale) {
    const auto requested = requestedLcid(locale);
    for (const auto& token : tokens(SPCAT_RECOGNIZERS)) {
        const auto languages = tokenLanguages(token.Get());
        if (std::find(languages.begin(), languages.end(), requested) != languages.end()) return token;
    }
    throw HelperError("unsupported_locale");
}

JsonArray installedLocales() {
    std::set<std::wstring> names;
    for (const auto& token : tokens(SPCAT_RECOGNIZERS)) {
        for (const auto lcid : tokenLanguages(token.Get())) {
            const auto name = localeName(lcid);
            if (!name.empty()) names.insert(name);
        }
    }
    JsonArray result;
    for (const auto& name : names) result.Append(JsonValue::CreateStringValue(winrt::hstring(name)));
    return result;
}

JsonArray installedVoices() {
    JsonArray result;
    for (const auto& token : tokens(SPCAT_VOICES)) {
        const auto languages = tokenLanguages(token.Get());
        if (languages.empty()) continue;
        const auto locale = localeName(languages.front());
        if (locale.empty()) continue;
        auto voice = object();
        put(voice, L"id", tokenId(token.Get()));
        put(voice, L"name", tokenName(token.Get()));
        put(voice, L"locale", locale);
        put(voice, L"quality", 0);
        result.Append(voice);
    }
    return result;
}

JsonObject capabilities(const JsonObject& request) {
    const auto locale = requiredString(request, L"locale");
    std::wstring supported;
    try {
        recognizerFor(locale);
        supported = localeName(requestedLcid(locale));
    } catch (const HelperError& error) {
        if (std::string(error.what()) != "unsupported_locale") throw;
    }
    auto result = object();
    put(result, L"osVersion", L"Windows");
    put(result, L"requestedLocale", locale);
    if (supported.empty()) result.SetNamedValue(L"supportedLocale", JsonValue::CreateNullValue());
    else put(result, L"supportedLocale", supported);
    put(result, L"appleAssetStatus", supported.empty() ? L"unsupported" : L"installed");
    put(result, L"voices", installedVoices());
    return success(L"capabilities", result);
}

JsonObject listAsrLocales() {
    auto result = object();
    const auto installed = installedLocales();
    put(result, L"supported", installed);
    put(result, L"installed", installed);
    return success(L"list_asr_locales", result);
}

JsonObject transcribe(const JsonObject& request) {
    const auto locale = requiredString(request, L"locale");
    const auto inputPath = requiredString(request, L"inputPath");
    const auto engine = recognizerFor(locale);
    ComPtr<ISpRecognizer> recognizer;
    require(CoCreateInstance(CLSID_SpInprocRecognizer, nullptr, CLSCTX_INPROC_SERVER,
                             IID_PPV_ARGS(recognizer.GetAddressOf())), "transcription_failed");
    require(recognizer->SetRecognizer(engine.Get()), "transcription_failed");
    ComPtr<ISpStream> input;
    require(SpBindToFile(inputPath.c_str(), SPFM_OPEN_READONLY, input.GetAddressOf()), "transcription_failed");
    require(recognizer->SetInput(input.Get(), TRUE), "transcription_failed");
    ComPtr<ISpRecoContext> context;
    require(recognizer->CreateRecoContext(context.GetAddressOf()), "transcription_failed");
    const auto interest = SPFEI(SPEI_RECOGNITION) | SPFEI(SPEI_SR_END_STREAM);
    require(context->SetInterest(interest, interest), "transcription_failed");
    require(context->SetNotifyWin32Event(), "transcription_failed");
    ComPtr<ISpRecoGrammar> grammar;
    require(context->CreateGrammar(1, grammar.GetAddressOf()), "transcription_failed");
    require(grammar->LoadDictation(nullptr, SPLO_STATIC), "transcription_failed");
    require(grammar->SetDictationState(SPRS_ACTIVE), "transcription_failed");

    std::wstring transcript;
    bool ended = false;
    while (!ended) {
        if (context->WaitForNotifyEvent(INFINITE) != S_OK) throw HelperError("transcription_failed");
        SPEVENT event{};
        ULONG count = 0;
        while (context->GetEvents(1, &event, &count) == S_OK && count == 1) {
            if (event.eEventId == SPEI_RECOGNITION) {
                auto* recognition = reinterpret_cast<ISpRecoResult*>(event.lParam);
                wchar_t* text = nullptr;
                if (recognition &&
                    recognition->GetText(SP_GETWHOLEPHRASE, SP_GETWHOLEPHRASE, TRUE, &text, nullptr) == S_OK && text) {
                    if (!transcript.empty()) transcript += L" ";
                    transcript += text;
                }
                CoTaskMemFree(text);
            } else if (event.eEventId == SPEI_SR_END_STREAM) {
                ended = true;
            }
            SpClearEvent(&event);
        }
    }
    auto result = object();
    put(result, L"locale", localeName(requestedLcid(locale)));
    put(result, L"text", transcript);
    return success(L"transcribe", result);
}

uint32_t read32(std::istream& input) {
    unsigned char bytes[4]{};
    if (!input.read(reinterpret_cast<char*>(bytes), 4)) throw HelperError("synthesis_failed");
    return static_cast<uint32_t>(bytes[0]) | (static_cast<uint32_t>(bytes[1]) << 8) |
           (static_cast<uint32_t>(bytes[2]) << 16) | (static_cast<uint32_t>(bytes[3]) << 24);
}

int wavFrames(const std::wstring& path) {
    std::ifstream input(std::filesystem::path(path), std::ios::binary);
    char name[4]{};
    if (!input.read(name, 4) || std::string(name, 4) != "RIFF") throw HelperError("synthesis_failed");
    read32(input);
    if (!input.read(name, 4) || std::string(name, 4) != "WAVE") throw HelperError("synthesis_failed");
    while (input.read(name, 4)) {
        const auto size = read32(input);
        if (std::string(name, 4) == "data") {
            if (!size || size % 2 || size / 2 > static_cast<uint32_t>(INT_MAX))
                throw HelperError("synthesis_failed");
            return static_cast<int>(size / 2);
        }
        input.seekg(size + (size & 1u), std::ios::cur);
    }
    throw HelperError("synthesis_failed");
}

JsonObject synthesize(const JsonObject& request) {
    const auto voiceId = requiredString(request, L"voiceId");
    const auto text = requiredString(request, L"text");
    const auto outputPath = requiredString(request, L"outputPath");
    if (!request.HasKey(L"speed") || request.Lookup(L"speed").ValueType() != JsonValueType::Number)
        throw HelperError("invalid_request");
    const auto speed = request.GetNamedNumber(L"speed");
    if (!std::isfinite(speed) || speed < 0.5 || speed > 2.0) throw HelperError("invalid_request");

    ComPtr<ISpObjectToken> selected;
    for (const auto& token : tokens(SPCAT_VOICES)) {
        if (tokenId(token.Get()) == voiceId) {
            selected = token;
            break;
        }
    }
    if (!selected) throw HelperError("voice_unavailable");

    WAVEFORMATEX format{};
    format.wFormatTag = WAVE_FORMAT_PCM;
    format.nChannels = 1;
    format.nSamplesPerSec = 16000;
    format.wBitsPerSample = 16;
    format.nBlockAlign = 2;
    format.nAvgBytesPerSec = 32000;
    try {
        ComPtr<ISpStream> output;
        require(SpBindToFile(outputPath.c_str(), SPFM_CREATE_ALWAYS, output.GetAddressOf(),
                             &SPDFID_WaveFormatEx, &format), "synthesis_failed");
        ComPtr<ISpVoice> voice;
        require(CoCreateInstance(CLSID_SpVoice, nullptr, CLSCTX_ALL,
                                 IID_PPV_ARGS(voice.GetAddressOf())), "synthesis_failed");
        require(voice->SetVoice(selected.Get()), "synthesis_failed");
        require(voice->SetRate(static_cast<long>(std::lround((speed - 1.0) * 10))), "synthesis_failed");
        require(voice->SetOutput(output.Get(), FALSE), "synthesis_failed");
        require(voice->Speak(text.c_str(), SPF_IS_NOT_XML, nullptr), "synthesis_failed");
        voice.Reset();
        require(output->Close(), "synthesis_failed");
        const auto frames = wavFrames(outputPath);
        auto result = object();
        put(result, L"voiceId", voiceId);
        put(result, L"outputPath", outputPath);
        put(result, L"sampleRate", 16000);
        put(result, L"channels", 1);
        put(result, L"frameCount", frames);
        return success(L"synthesize", result);
    } catch (...) {
        std::error_code ignored;
        std::filesystem::remove(outputPath, ignored);
        throw;
    }
}

JsonObject execute(const JsonObject& request) {
    const auto operation = requiredString(request, L"operation");
    if (operation == L"capabilities") return capabilities(request);
    if (operation == L"list_asr_locales") return listAsrLocales();
    if (operation == L"transcribe") return transcribe(request);
    if (operation == L"synthesize") return synthesize(request);
    throw HelperError("invalid_request");
}

}  // namespace

int main() {
    try {
        winrt::init_apartment(winrt::apartment_type::single_threaded);
        JsonObject response;
        try {
            std::string input(1024 * 1024 + 1, '\0');
            std::cin.read(input.data(), static_cast<std::streamsize>(input.size()));
            input.resize(static_cast<size_t>(std::cin.gcount()));
            if (input.empty() || input.size() > 1024 * 1024) throw HelperError("invalid_request");
            JsonObject request;
            try {
                request = JsonObject::Parse(winrt::to_hstring(input));
            } catch (const winrt::hresult_error&) {
                throw HelperError("invalid_request");
            }
            response = execute(request);
        } catch (const HelperError& error) {
            response = failure(error.what());
        } catch (...) {
            response = failure("native_helper_failed");
        }
        std::cout << winrt::to_string(response.Stringify()) << '\n';
    } catch (...) {
        std::cout << "{\"ok\":false,\"error\":{\"code\":\"native_helper_failed\",\"message\":\"native_helper_failed\"}}\n";
    }
}
