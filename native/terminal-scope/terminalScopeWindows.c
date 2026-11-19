#define WIN32_LEAN_AND_MEAN
#include <winsock2.h>
#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
#include <wchar.h>

static SOCKET control = INVALID_SOCKET;
static char scope[37];

static int event(const char *name, DWORD value) {
  char message[256];
  int length = snprintf(message, sizeof(message),
    "{\"event\":\"%s\",\"scopeId\":\"%s\",\"value\":%lu,\"signal\":0}\n",
    name, scope, (unsigned long)value);
  if (length < 0 || length >= (int)sizeof(message)) return -1;
  for (int sent = 0; sent < length;) {
    int count = send(control, message + sent, length - sent, 0);
    if (count <= 0) return -1;
    sent += count;
  }
  return 0;
}

static wchar_t *command_line(int argc, wchar_t **argv) {
  size_t size = 1;
  for (int i = 5; i < argc; i++) size += 2 * wcslen(argv[i]) + 3;
  if (size > 32767) return NULL;
  wchar_t *result = calloc(size, sizeof(wchar_t));
  if (!result) return NULL;
  wchar_t *out = result;
  for (int i = 5; i < argc; i++) {
    if (i > 5) *out++ = L' ';
    *out++ = L'"';
    size_t slashes = 0;
    for (const wchar_t *p = argv[i];; p++) {
      if (*p == L'\\') { slashes++; continue; }
      size_t count = (*p == L'"' || !*p) ? slashes * 2 : slashes;
      while (count--) *out++ = L'\\';
      slashes = 0;
      if (!*p) break;
      if (*p == L'"') *out++ = L'\\';
      *out++ = *p;
    }
    *out++ = L'"';
  }
  *out = 0;
  return result;
}

static BOOL WINAPI ignore_control(DWORD type) {
  (void)type;
  return TRUE;
}

static void terminate_gracefully(void) {
  GenerateConsoleCtrlEvent(CTRL_BREAK_EVENT, 0);
}

int wmain(int argc, wchar_t **argv) {
  if (argc < 6 || wcscmp(argv[4], L"--")) return 64;
  int port = _wtoi(argv[1]);
  if (port < 1 || port > 65535 || wcslen(argv[2]) != 36) return 64;
  for (int i = 0; i < 36; i++) {
    wchar_t c = argv[2][i];
    if (!((c >= L'0' && c <= L'9') || (c >= L'a' && c <= L'f') || c == L'-')) return 64;
    scope[i] = (char)c;
  }
  int is_pty = wcscmp(argv[3], L"pty") == 0;
  HANDLE input = GetStdHandle(STD_INPUT_HANDLE);
  HANDLE output = GetStdHandle(STD_OUTPUT_HANDLE);
  HANDLE error_output = GetStdHandle(STD_ERROR_HANDLE);
  if (!is_pty) {
    FreeConsole();
    if (!AllocConsole()) return 71;
    ShowWindow(GetConsoleWindow(), SW_HIDE);
  }
  SetConsoleCtrlHandler(ignore_control, TRUE);
  WSADATA sockets;
  if (WSAStartup(MAKEWORD(2, 2), &sockets)) return 71;
  control = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
  struct sockaddr_in address = {0};
  address.sin_family = AF_INET;
  address.sin_port = htons((u_short)port);
  address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  if (control == INVALID_SOCKET || connect(control, (struct sockaddr *)&address, sizeof(address))) return 71;
  SetHandleInformation((HANDLE)control, HANDLE_FLAG_INHERIT, 0);
  wchar_t job_name[96];
  swprintf_s(job_name, 96, L"Local\\CherryStudio.Terminal.%ls", argv[2]);
  HANDLE job = CreateJobObjectW(NULL, job_name);
  if (!job || GetLastError() == ERROR_ALREADY_EXISTS) { event("error", GetLastError()); return 71; }
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = {0};
  limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits, sizeof(limits))) {
    event("error", GetLastError()); CloseHandle(job); return 71;
  }
  wchar_t *command = command_line(argc, argv);
  if (!command) { event("error", ERROR_INVALID_PARAMETER); CloseHandle(job); return 71; }
  STARTUPINFOW startup = {0};
  startup.cb = sizeof(startup);
  startup.dwFlags = STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW;
  startup.wShowWindow = SW_HIDE;
  startup.hStdInput = input;
  startup.hStdOutput = output;
  startup.hStdError = error_output;
  PROCESS_INFORMATION process = {0};
  DWORD flags = CREATE_SUSPENDED;
  if (!CreateProcessW(argv[5], command, NULL, NULL, TRUE, flags, NULL, NULL, &startup, &process)) {
    event("error", GetLastError()); free(command); CloseHandle(job); return 71;
  }
  free(command);
  if (!AssignProcessToJobObject(job, process.hProcess)) {
    event("error", GetLastError());
    TerminateProcess(process.hProcess, 125);
    WaitForSingleObject(process.hProcess, INFINITE);
    CloseHandle(process.hThread); CloseHandle(process.hProcess); CloseHandle(job);
    return 71;
  }
  int disconnected = event("ready", process.dwProcessId) < 0;
  int started = 0, exited = 0, forced = 0;
  ULONGLONG disconnected_at = 0;
  for (;;) {
    fd_set input;
    FD_ZERO(&input); FD_SET(control, &input);
    struct timeval timeout = { .tv_sec = 0, .tv_usec = 20000 };
    int selected = disconnected ? 0 : select(0, &input, NULL, NULL, &timeout);
    if (selected > 0) {
      char request;
      if (recv(control, &request, 1, 0) != 1) disconnected = 1;
      else if (request == 'S' && !started) {
        started = 1;
        if (ResumeThread(process.hThread) == (DWORD)-1) disconnected = 1;
        if (event("running", process.dwProcessId) < 0) disconnected = 1;
      } else if (request == 'T' || request == 'K') {
        started = 1;
        if (request == 'K') TerminateJobObject(job, 137);
        else if (!exited) terminate_gracefully();
      }
    } else if (selected == SOCKET_ERROR) disconnected = 1;
    if (disconnected && !disconnected_at) {
      disconnected_at = GetTickCount64();
      TerminateJobObject(job, 137);
      forced = 1;
    }
    if (!exited && WaitForSingleObject(process.hProcess, 0) == WAIT_OBJECT_0) {
      DWORD code;
      exited = 1;
      if (!GetExitCodeProcess(process.hProcess, &code) || event("exit", code) < 0) disconnected = 1;
    }
    JOBOBJECT_BASIC_ACCOUNTING_INFORMATION accounting;
    if (exited && QueryInformationJobObject(job, JobObjectBasicAccountingInformation, &accounting, sizeof(accounting), NULL) &&
        accounting.ActiveProcesses == 0) {
      event("empty", 0);
      CloseHandle(process.hThread); CloseHandle(process.hProcess); CloseHandle(job);
      closesocket(control); WSACleanup();
      return 0;
    }
    if (disconnected) {
      if (!disconnected_at) continue;
      if (!forced) { TerminateJobObject(job, 137); forced = 1; }
      if (GetTickCount64() - disconnected_at >= 5000) return 75;
      Sleep(20);
    }
  }
}
