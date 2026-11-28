#if !defined(_M_X64)
#error The Windows system speech helper supports x64 only.
#endif

#include <windows.h>
#include <objbase.h>
#include <sapi.h>
#include <sphelper.h>
#include <wrl/client.h>

#include <algorithm>
#include <cerrno>
#include <climits>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cwchar>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <map>
#include <set>
#include <stdexcept>
#include <string>
#include <utility>
#include <variant>
#include <vector>

using Microsoft::WRL::ComPtr;

namespace {

struct HelperError : std::runtime_error {
    explicit HelperError(const char* code) : std::runtime_error(code) {}
};

struct ComApartment {
    HRESULT hr;
    ComApartment() : hr(CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED)) {}
    ~ComApartment() {
        if (SUCCEEDED(hr)) CoUninitialize();
    }
    ComApartment(const ComApartment&) = delete;
    ComApartment& operator=(const ComApartment&) = delete;
};

struct JsonValue;
using JsonArray = std::vector<JsonValue>;
using JsonObject = std::map<std::string, JsonValue>;

struct JsonValue {
    std::variant<std::nullptr_t, bool, double, int64_t, std::string, JsonArray, JsonObject> data;

    JsonValue() : data(nullptr) {}
    JsonValue(std::nullptr_t) : data(nullptr) {}
    JsonValue(bool value) : data(value) {}
    JsonValue(double value) : data(value) {}
    JsonValue(int value) : data(static_cast<int64_t>(value)) {}
    JsonValue(int64_t value) : data(value) {}
    JsonValue(const char* value) : data(std::string(value)) {}
    JsonValue(std::string value) : data(std::move(value)) {}
    JsonValue(JsonArray value) : data(std::move(value)) {}
    JsonValue(JsonObject value) : data(std::move(value)) {}

    bool isNull() const { return std::holds_alternative<std::nullptr_t>(data); }
    bool isString() const { return std::holds_alternative<std::string>(data); }
    bool isNumber() const { return std::holds_alternative<double>(data) || std::holds_alternative<int64_t>(data); }
    bool isObject() const { return std::holds_alternative<JsonObject>(data); }

    const std::string& asString() const { return std::get<std::string>(data); }
    const JsonObject& asObject() const { return std::get<JsonObject>(data); }
    double asNumber() const {
        if (const auto* integer = std::get_if<int64_t>(&data)) return static_cast<double>(*integer);
        return std::get<double>(data);
    }
};

namespace simple_json {

constexpr size_t kMaxNestingDepth = 64;

void appendUtf8CodePoint(std::string& out, uint32_t cp) {
    if (cp <= 0x7Fu) {
        out.push_back(static_cast<char>(cp));
    } else if (cp <= 0x7FFu) {
        out.push_back(static_cast<char>(0xC0u | (cp >> 6)));
        out.push_back(static_cast<char>(0x80u | (cp & 0x3Fu)));
    } else if (cp <= 0xFFFFu) {
        out.push_back(static_cast<char>(0xE0u | (cp >> 12)));
        out.push_back(static_cast<char>(0x80u | ((cp >> 6) & 0x3Fu)));
        out.push_back(static_cast<char>(0x80u | (cp & 0x3Fu)));
    } else {
        out.push_back(static_cast<char>(0xF0u | (cp >> 18)));
        out.push_back(static_cast<char>(0x80u | ((cp >> 12) & 0x3Fu)));
        out.push_back(static_cast<char>(0x80u | ((cp >> 6) & 0x3Fu)));
        out.push_back(static_cast<char>(0x80u | (cp & 0x3Fu)));
    }
}

class Parser {
public:
    explicit Parser(const std::string& input) : src_(input) {}

    JsonObject parseRootObject() {
        skipWhitespace();
        JsonValue root = parseValue(0);
        skipWhitespace();
        if (pos_ != src_.size() || !root.isObject()) throw HelperError("invalid_request");
        return std::move(std::get<JsonObject>(root.data));
    }

private:
    const std::string& src_;
    size_t pos_ = 0;

    void skipWhitespace() {
        while (pos_ < src_.size()) {
            const char ch = src_[pos_];
            if (ch == ' ' || ch == '\t' || ch == '\r' || ch == '\n') ++pos_;
            else break;
        }
    }

    char peek() const {
        if (pos_ >= src_.size()) throw HelperError("invalid_request");
        return src_[pos_];
    }

    char take() {
        const char ch = peek();
        ++pos_;
        return ch;
    }

    uint32_t parseHex4() {
        if (pos_ + 4 > src_.size()) throw HelperError("invalid_request");
        uint32_t value = 0;
        for (size_t i = 0; i < 4; ++i) {
            const char ch = src_[pos_++];
            value <<= 4;
            if (ch >= '0' && ch <= '9') value |= static_cast<uint32_t>(ch - '0');
            else if (ch >= 'a' && ch <= 'f') value |= static_cast<uint32_t>(ch - 'a' + 10);
            else if (ch >= 'A' && ch <= 'F') value |= static_cast<uint32_t>(ch - 'A' + 10);
            else throw HelperError("invalid_request");
        }
        return value;
    }

    std::string parseString() {
        if (take() != '"') throw HelperError("invalid_request");
        std::string out;
        while (pos_ < src_.size()) {
            const unsigned char ch = static_cast<unsigned char>(src_[pos_++]);
            if (ch == '"') return out;
            if (ch < 0x20u) throw HelperError("invalid_request");
            if (ch != '\\') {
                out.push_back(static_cast<char>(ch));
                continue;
            }
            const char esc = take();
            switch (esc) {
                case '"': out.push_back('"'); break;
                case '\\': out.push_back('\\'); break;
                case '/': out.push_back('/'); break;
                case 'b': out.push_back('\b'); break;
                case 'f': out.push_back('\f'); break;
                case 'n': out.push_back('\n'); break;
                case 'r': out.push_back('\r'); break;
                case 't': out.push_back('\t'); break;
                case 'u': {
                    const uint32_t cp = parseHex4();
                    if (cp >= 0xDC00u && cp <= 0xDFFFu) throw HelperError("invalid_request");
                    if (cp >= 0xD800u && cp <= 0xDBFFu) {
                        if (pos_ + 2 > src_.size() || src_[pos_] != '\\' || src_[pos_ + 1] != 'u') {
                            throw HelperError("invalid_request");
                        }
                        pos_ += 2;
                        const uint32_t low = parseHex4();
                        if (low < 0xDC00u || low > 0xDFFFu) throw HelperError("invalid_request");
                        const uint32_t combined = 0x10000u + (((cp - 0xD800u) << 10) | (low - 0xDC00u));
                        appendUtf8CodePoint(out, combined);
                    } else {
                        appendUtf8CodePoint(out, cp);
                    }
                    break;
                }
                default:
                    throw HelperError("invalid_request");
            }
        }
        throw HelperError("invalid_request");
    }

    JsonValue parseNumber() {
        const size_t start = pos_;
        if (src_[pos_] == '-') ++pos_;
        if (pos_ >= src_.size()) throw HelperError("invalid_request");
        if (src_[pos_] == '0') {
            ++pos_;
        } else if (src_[pos_] >= '1' && src_[pos_] <= '9') {
            while (pos_ < src_.size() && src_[pos_] >= '0' && src_[pos_] <= '9') ++pos_;
        } else {
            throw HelperError("invalid_request");
        }
        if (pos_ < src_.size() && src_[pos_] == '.') {
            ++pos_;
            if (pos_ >= src_.size() || src_[pos_] < '0' || src_[pos_] > '9') throw HelperError("invalid_request");
            while (pos_ < src_.size() && src_[pos_] >= '0' && src_[pos_] <= '9') ++pos_;
        }
        if (pos_ < src_.size() && (src_[pos_] == 'e' || src_[pos_] == 'E')) {
            ++pos_;
            if (pos_ < src_.size() && (src_[pos_] == '+' || src_[pos_] == '-')) ++pos_;
            if (pos_ >= src_.size() || src_[pos_] < '0' || src_[pos_] > '9') throw HelperError("invalid_request");
            while (pos_ < src_.size() && src_[pos_] >= '0' && src_[pos_] <= '9') ++pos_;
        }
        const std::string token = src_.substr(start, pos_ - start);
        errno = 0;
        char* end = nullptr;
        const double number = std::strtod(token.c_str(), &end);
        if (errno == ERANGE || end != token.c_str() + token.size() || !std::isfinite(number)) {
            throw HelperError("invalid_request");
        }
        return JsonValue(number);
    }

    JsonValue parseLiteral(const char* literal, JsonValue result) {
        const std::string view(literal);
        if (src_.compare(pos_, view.size(), view) != 0) throw HelperError("invalid_request");
        pos_ += view.size();
        return result;
    }

    JsonValue parseArray(size_t depth) {
        if (depth >= kMaxNestingDepth) throw HelperError("invalid_request");
        take();
        skipWhitespace();
        JsonArray arr;
        if (pos_ < src_.size() && src_[pos_] == ']') {
            ++pos_;
            return JsonValue(std::move(arr));
        }
        for (;;) {
            skipWhitespace();
            arr.push_back(parseValue(depth + 1));
            skipWhitespace();
            const char next = take();
            if (next == ']') break;
            if (next != ',') throw HelperError("invalid_request");
        }
        return JsonValue(std::move(arr));
    }

    JsonValue parseObject(size_t depth) {
        if (depth >= kMaxNestingDepth) throw HelperError("invalid_request");
        take();
        skipWhitespace();
        JsonObject obj;
        if (pos_ < src_.size() && src_[pos_] == '}') {
            ++pos_;
            return JsonValue(std::move(obj));
        }
        for (;;) {
            skipWhitespace();
            if (peek() != '"') throw HelperError("invalid_request");
            std::string key = parseString();
            skipWhitespace();
            if (take() != ':') throw HelperError("invalid_request");
            skipWhitespace();
            obj[std::move(key)] = parseValue(depth + 1);
            skipWhitespace();
            const char next = take();
            if (next == '}') break;
            if (next != ',') throw HelperError("invalid_request");
        }
        return JsonValue(std::move(obj));
    }

    JsonValue parseValue(size_t depth) {
        const char ch = peek();
        if (ch == '"') return JsonValue(parseString());
        if (ch == '{') return parseObject(depth);
        if (ch == '[') return parseArray(depth);
        if (ch == 't') return parseLiteral("true", JsonValue(true));
        if (ch == 'f') return parseLiteral("false", JsonValue(false));
        if (ch == 'n') return parseLiteral("null", JsonValue(nullptr));
        if (ch == '-' || (ch >= '0' && ch <= '9')) return parseNumber();
        throw HelperError("invalid_request");
    }
};

void writeEscapedString(std::string& out, const std::string& text) {
    out.push_back('"');
    for (const char rawCh : text) {
        const unsigned char ch = static_cast<unsigned char>(rawCh);
        switch (ch) {
            case '"': out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\b': out += "\\b"; break;
            case '\f': out += "\\f"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default:
                if (ch < 0x20u) {
                    static constexpr char kHex[] = "0123456789abcdef";
                    out += "\\u00";
                    out.push_back(kHex[(ch >> 4) & 0x0Fu]);
                    out.push_back(kHex[ch & 0x0Fu]);
                } else {
                    out.push_back(static_cast<char>(ch));
                }
                break;
        }
    }
    out.push_back('"');
}

void writeValue(std::string& out, const JsonValue& value) {
    if (value.isNull()) {
        out += "null";
    } else if (const auto* b = std::get_if<bool>(&value.data)) {
        out += (*b ? "true" : "false");
    } else if (const auto* i = std::get_if<int64_t>(&value.data)) {
        out += std::to_string(*i);
    } else if (const auto* d = std::get_if<double>(&value.data)) {
        if (!std::isfinite(*d)) {
            out += "null";
        } else {
            char buf[64]{};
            std::snprintf(buf, sizeof(buf), "%.17g", *d);
            out += buf;
        }
    } else if (const auto* s = std::get_if<std::string>(&value.data)) {
        writeEscapedString(out, *s);
    } else if (const auto* arr = std::get_if<JsonArray>(&value.data)) {
        out.push_back('[');
        for (size_t idx = 0; idx < arr->size(); ++idx) {
            if (idx > 0) out.push_back(',');
            writeValue(out, (*arr)[idx]);
        }
        out.push_back(']');
    } else if (const auto* obj = std::get_if<JsonObject>(&value.data)) {
        out.push_back('{');
        bool first = true;
        for (const auto& [key, member] : *obj) {
            if (!first) out.push_back(',');
            first = false;
            writeEscapedString(out, key);
            out.push_back(':');
            writeValue(out, member);
        }
        out.push_back('}');
    }
}

JsonObject parseObject(const std::string& input) {
    return Parser(input).parseRootObject();
}

std::string stringify(const JsonObject& objectValue) {
    std::string out;
    writeValue(out, JsonValue(objectValue));
    return out;
}

}  // namespace simple_json

std::wstring wideFromUtf8(const std::string& utf8) {
    if (utf8.empty()) return {};
    if (utf8.size() > static_cast<size_t>(INT_MAX)) throw HelperError("invalid_request");
    const int utf8Len = static_cast<int>(utf8.size());
    const int wideLen = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, utf8.data(), utf8Len, nullptr, 0);
    if (wideLen <= 0) throw HelperError("invalid_request");
    std::wstring wide(static_cast<size_t>(wideLen), L'\0');
    const int written =
        MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, utf8.data(), utf8Len, wide.data(), wideLen);
    if (written != wideLen) throw HelperError("invalid_request");
    return wide;
}

std::string utf8FromWide(const std::wstring& wide) {
    if (wide.empty()) return {};
    if (wide.size() > static_cast<size_t>(INT_MAX / 4)) throw HelperError("native_helper_failed");
    const int wideLen = static_cast<int>(wide.size());
    const int utf8Len =
        WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, wide.data(), wideLen, nullptr, 0, nullptr, nullptr);
    if (utf8Len <= 0) throw HelperError("native_helper_failed");
    std::string utf8(static_cast<size_t>(utf8Len), '\0');
    const int written = WideCharToMultiByte(
        CP_UTF8, WC_ERR_INVALID_CHARS, wide.data(), wideLen, utf8.data(), utf8Len, nullptr, nullptr);
    if (written != utf8Len) throw HelperError("native_helper_failed");
    return utf8;
}

void require(HRESULT result, const char* code) {
    if (FAILED(result)) throw HelperError(code);
}

const JsonValue* findKey(const JsonObject& obj, const char* key) {
    const auto it = obj.find(key);
    return it == obj.end() ? nullptr : &it->second;
}

std::wstring requiredString(const JsonObject& request, const char* key) {
    const auto* value = findKey(request, key);
    if (!value || !value->isString()) throw HelperError("invalid_request");
    const auto result = wideFromUtf8(value->asString());
    if (result.empty() || result.find(L'\0') != std::wstring::npos) throw HelperError("invalid_request");
    return result;
}

JsonObject object() { return JsonObject{}; }

void put(JsonObject& target, const char* key, const std::wstring& value) {
    target[key] = JsonValue(utf8FromWide(value));
}

void put(JsonObject& target, const char* key, const wchar_t* value) {
    target[key] = JsonValue(utf8FromWide(std::wstring(value)));
}

void put(JsonObject& target, const char* key, const char* value) {
    target[key] = JsonValue(std::string(value));
}

void put(JsonObject& target, const char* key, int value) {
    target[key] = JsonValue(value);
}

void put(JsonObject& target, const char* key, JsonObject value) {
    target[key] = JsonValue(std::move(value));
}

void put(JsonObject& target, const char* key, JsonArray value) {
    target[key] = JsonValue(std::move(value));
}

JsonObject success(const char* operation, JsonObject result) {
    auto value = object();
    put(value, "operation", operation);
    put(value, "result", std::move(result));
    auto envelope = object();
    envelope["ok"] = JsonValue(true);
    put(envelope, "value", std::move(value));
    return envelope;
}

JsonObject failure(const char* code) {
    auto error = object();
    put(error, "code", code);
    put(error, "message", code);
    auto envelope = object();
    envelope["ok"] = JsonValue(false);
    put(envelope, "error", std::move(error));
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
    for (const auto& name : names) result.push_back(JsonValue(utf8FromWide(name)));
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
        put(voice, "id", tokenId(token.Get()));
        put(voice, "name", tokenName(token.Get()));
        put(voice, "locale", locale);
        put(voice, "quality", 0);
        result.push_back(JsonValue(std::move(voice)));
    }
    return result;
}

JsonObject resolveVoice(const JsonObject& request) {
    auto result = object();
    result["voice"] = JsonValue(nullptr);
    const auto locale = findKey(request, "locale") ? requiredString(request, "locale") : L"";
    const auto requested = locale.empty() ? 0 : LocaleNameToLCID(locale.c_str(), 0);
    if (!locale.empty() && !requested) return success("resolve_voice", std::move(result));

    ComPtr<ISpObjectToken> token;
    const auto defaultResult = SpGetDefaultTokenFromCategoryId(SPCAT_VOICES, token.GetAddressOf(), FALSE);
    if (FAILED(defaultResult) && defaultResult != SPERR_NOT_FOUND) require(defaultResult, "native_helper_failed");
    if (token && requested) {
        const auto languages = tokenLanguages(token.Get());
        if (std::find(languages.begin(), languages.end(), requested) == languages.end()) token.Reset();
    }
    if (!token && requested) {
        wchar_t attributes[32]{};
        swprintf_s(attributes, L"Language=%lx", static_cast<unsigned long>(requested));
        const auto match = SpFindBestToken(SPCAT_VOICES, attributes, nullptr, token.GetAddressOf());
        if (match != SPERR_NOT_FOUND) require(match, "native_helper_failed");
    }
    if (token) {
        const auto languages = tokenLanguages(token.Get());
        if (!languages.empty()) {
            const auto resolvedLocale = localeName(requested ? requested : languages.front());
            if (!resolvedLocale.empty()) {
                auto voice = object();
                put(voice, "id", tokenId(token.Get()));
                put(voice, "name", tokenName(token.Get()));
                put(voice, "locale", resolvedLocale);
                put(voice, "quality", 0);
                put(result, "voice", std::move(voice));
            }
        }
    }
    return success("resolve_voice", std::move(result));
}

JsonObject capabilities(const JsonObject& request) {
    const auto locale = requiredString(request, "locale");
    std::wstring supported;
    try {
        recognizerFor(locale);
        supported = localeName(requestedLcid(locale));
    } catch (const HelperError& error) {
        if (std::string(error.what()) != "unsupported_locale") throw;
    }
    auto result = object();
    put(result, "osVersion", L"Windows");
    put(result, "requestedLocale", locale);
    if (supported.empty()) result["supportedLocale"] = JsonValue(nullptr);
    else put(result, "supportedLocale", supported);
    put(result, "appleAssetStatus", supported.empty() ? L"unsupported" : L"installed");
    put(result, "voices", installedVoices());
    return success("capabilities", std::move(result));
}

JsonObject listAsrLocales() {
    auto result = object();
    const auto installed = installedLocales();
    put(result, "supported", installed);
    put(result, "installed", installed);
    return success("list_asr_locales", std::move(result));
}

ComPtr<ISpRecognizer> createRecognizer(const std::wstring& locale) {
    const auto engine = recognizerFor(locale);
    ComPtr<ISpRecognizer> recognizer;
    require(CoCreateInstance(CLSID_SpInprocRecognizer, nullptr, CLSCTX_INPROC_SERVER,
                             IID_PPV_ARGS(recognizer.GetAddressOf())), "transcription_failed");
    require(recognizer->SetRecognizer(engine.Get()), "transcription_failed");
    return recognizer;
}

ComPtr<ISpRecoGrammar> loadDictation(ISpRecoContext* context) {
    ComPtr<ISpRecoGrammar> grammar;
    require(context->CreateGrammar(1, grammar.GetAddressOf()), "transcription_failed");
    require(grammar->LoadDictation(nullptr, SPLO_STATIC), "transcription_failed");
    return grammar;
}

JsonObject probeAsr(const JsonObject& request) {
    const auto locale = requiredString(request, "locale");
    const auto recognizer = createRecognizer(locale);
    // An in-process recognizer has no default audio input. Do not set input or activate dictation here.
    ComPtr<ISpRecoContext> context;
    require(recognizer->CreateRecoContext(context.GetAddressOf()), "transcription_failed");
    loadDictation(context.Get());
    auto result = object();
    put(result, "locale", localeName(requestedLcid(locale)));
    return success("probe_asr", std::move(result));
}

JsonObject transcribe(const JsonObject& request) {
    const auto locale = requiredString(request, "locale");
    const auto inputPath = requiredString(request, "inputPath");
    const auto recognizer = createRecognizer(locale);
    ComPtr<ISpStream> input;
    require(SPBindToFile(inputPath.c_str(), SPFM_OPEN_READONLY, input.GetAddressOf()), "transcription_failed");
    require(recognizer->SetInput(input.Get(), TRUE), "transcription_failed");
    ComPtr<ISpRecoContext> context;
    require(recognizer->CreateRecoContext(context.GetAddressOf()), "transcription_failed");
    const auto interest = SPFEI(SPEI_RECOGNITION) | SPFEI(SPEI_END_SR_STREAM);
    require(context->SetInterest(interest, interest), "transcription_failed");
    require(context->SetNotifyWin32Event(), "transcription_failed");
    const auto grammar = loadDictation(context.Get());
    require(grammar->SetDictationState(SPRS_ACTIVE), "transcription_failed");

    std::wstring transcript;
    HRESULT recognitionResult = S_OK;
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
                    recognition->GetText(static_cast<ULONG>(SP_GETWHOLEPHRASE), static_cast<ULONG>(SP_GETWHOLEPHRASE),
                                         TRUE, &text, nullptr) == S_OK && text) {
                    if (!transcript.empty()) transcript += L" ";
                    transcript += text;
                }
                CoTaskMemFree(text);
            } else if (event.eEventId == SPEI_END_SR_STREAM) {
                recognitionResult = static_cast<HRESULT>(event.lParam);
                ended = true;
            }
            SpClearEvent(&event);
        }
    }
    require(recognitionResult, "transcription_failed");
    auto result = object();
    put(result, "locale", localeName(requestedLcid(locale)));
    put(result, "text", transcript);
    return success("transcribe", std::move(result));
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
    const auto voiceId = requiredString(request, "voiceId");
    const auto text = requiredString(request, "text");
    const auto outputPath = requiredString(request, "outputPath");
    const auto* speedValue = findKey(request, "speed");
    if (!speedValue || !speedValue->isNumber()) throw HelperError("invalid_request");
    const auto speed = speedValue->asNumber();
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
        require(SPBindToFile(outputPath.c_str(), SPFM_CREATE_ALWAYS, output.GetAddressOf(),
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
        put(result, "voiceId", voiceId);
        put(result, "outputPath", outputPath);
        put(result, "sampleRate", 16000);
        put(result, "channels", 1);
        put(result, "frameCount", frames);
        return success("synthesize", std::move(result));
    } catch (...) {
        std::error_code ignored;
        std::filesystem::remove(outputPath, ignored);
        throw;
    }
}

JsonObject execute(const JsonObject& request) {
    const auto operation = requiredString(request, "operation");
    if (operation == L"resolve_voice") return resolveVoice(request);
    if (operation == L"capabilities") return capabilities(request);
    if (operation == L"list_asr_locales") return listAsrLocales();
    if (operation == L"probe_asr") return probeAsr(request);
    if (operation == L"transcribe") return transcribe(request);
    if (operation == L"synthesize") return synthesize(request);
    throw HelperError("invalid_request");
}

}  // namespace

int main() {
    try {
        ComApartment com;
        if (FAILED(com.hr)) {
            std::cout << "{\"ok\":false,\"error\":{\"code\":\"native_helper_failed\",\"message\":\"native_helper_failed\"}}\n";
            return 0;
        }
        JsonObject response;
        try {
            std::string input(1024 * 1024 + 1, '\0');
            std::cin.read(input.data(), static_cast<std::streamsize>(input.size()));
            input.resize(static_cast<size_t>(std::cin.gcount()));
            if (input.empty() || input.size() > 1024 * 1024) throw HelperError("invalid_request");
            const JsonObject request = simple_json::parseObject(input);
            response = execute(request);
        } catch (const HelperError& error) {
            response = failure(error.what());
        } catch (...) {
            response = failure("native_helper_failed");
        }
        std::cout << simple_json::stringify(response) << '\n';
    } catch (...) {
        std::cout << "{\"ok\":false,\"error\":{\"code\":\"native_helper_failed\",\"message\":\"native_helper_failed\"}}\n";
    }
}
