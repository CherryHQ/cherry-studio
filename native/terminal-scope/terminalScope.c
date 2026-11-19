#define _GNU_SOURCE
#include <arpa/inet.h>
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <termios.h>
#include <time.h>
#include <unistd.h>
#ifdef __APPLE__
#include <sys/sysctl.h>
#endif

static int control = -1;
static const char *scope;

static int event(const char *name, long value, int signal_number) {
  char message[256];
  int length = snprintf(message, sizeof(message),
    "{\"event\":\"%s\",\"scopeId\":\"%s\",\"value\":%ld,\"signal\":%d}\n",
    name, scope, value, signal_number);
  if (length < 0 || (size_t)length >= sizeof(message)) return -1;
  for (int sent = 0; sent < length;) {
    ssize_t count = send(control, message + sent, (size_t)(length - sent), 0);
    if (count < 0 && errno == EINTR) continue;
    if (count <= 0) return -1;
    sent += (int)count;
  }
  return 0;
}

static int session_members(pid_t session, pid_t root) {
#ifdef __APPLE__
  int query[] = { CTL_KERN, KERN_PROC, KERN_PROC_ALL, 0 };
  size_t size = 0;
  if (sysctl(query, 4, NULL, &size, NULL, 0) < 0) return -1;
  size += 32 * sizeof(struct kinfo_proc);
  struct kinfo_proc *processes = malloc(size);
  if (!processes) return -1;
  if (sysctl(query, 4, processes, &size, NULL, 0) < 0) { free(processes); return -1; }
  int count = 0;
  for (size_t index = 0; index < size / sizeof(*processes); index++) {
    pid_t pid = processes[index].kp_proc.p_pid;
    if (pid <= 0 || pid == session || (pid == root && processes[index].kp_proc.p_stat == SZOMB)) continue;
    if (getsid(pid) == session && processes[index].kp_proc.p_stat != SZOMB) count++;
  }
  free(processes);
  return count;
#else
  DIR *directory = opendir("/proc");
  if (!directory) return -1;
  int count = 0;
  struct dirent *entry;
  while ((entry = readdir(directory))) {
    char *end;
    long pid = strtol(entry->d_name, &end, 10);
    if (!pid || *end || pid == session) continue;
    char filename[64], line[4096];
    snprintf(filename, sizeof(filename), "/proc/%ld/stat", pid);
    FILE *file = fopen(filename, "r");
    if (!file) continue;
    char *read = fgets(line, sizeof(line), file);
    fclose(file);
    if (!read) continue;
    char *fields = strrchr(line, ')');
    char state;
    long parent, group, sid;
    if (fields && sscanf(fields + 1, " %c %ld %ld %ld", &state, &parent, &group, &sid) == 4 &&
        sid == session && state != 'Z') count++;
  }
  closedir(directory);
  (void)root;
  return count;
#endif
}

static long elapsed_ms(const struct timespec *start) {
  struct timespec now;
  clock_gettime(CLOCK_MONOTONIC, &now);
  return (now.tv_sec - start->tv_sec) * 1000 + (now.tv_nsec - start->tv_nsec) / 1000000;
}

int main(int argc, char **argv) {
  if (argc < 6) return 64;
  int port = atoi(argv[1]);
  scope = argv[2];
  int is_pty = strcmp(argv[3], "pty") == 0;
  if (port < 1 || port > 65535 || strlen(scope) != 36 || strcmp(argv[4], "--")) return 64;
  for (const char *p = scope; *p; p++) if (!((*p >= '0' && *p <= '9') || (*p >= 'a' && *p <= 'f') || *p == '-')) return 64;
  signal(SIGPIPE, SIG_IGN);
  signal(SIGHUP, SIG_IGN);
  signal(SIGINT, SIG_IGN);
  signal(SIGQUIT, SIG_IGN);
  signal(SIGTTOU, SIG_IGN);
  control = socket(AF_INET, SOCK_STREAM, 0);
  if (control < 0 || fcntl(control, F_SETFD, FD_CLOEXEC) < 0) return 71;
  struct sockaddr_in address = {0};
  address.sin_family = AF_INET;
  address.sin_port = htons((unsigned short)port);
  address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  if (connect(control, (struct sockaddr *)&address, sizeof(address)) < 0) return 71;
  if (getsid(0) != getpid() && setsid() < 0) { event("error", errno, 0); return 71; }
  int gate[2];
  if (pipe(gate) < 0) { event("error", errno, 0); return 71; }
  pid_t root = fork();
  if (root < 0) { event("error", errno, 0); return 71; }
  if (root == 0) {
    close(gate[1]);
    close(control);
    if (setpgid(0, 0) < 0) _exit(125);
    char start = 0;
    ssize_t count;
    do { count = read(gate[0], &start, 1); } while (count < 0 && errno == EINTR);
    close(gate[0]);
    if (count != 1 || start != 'S') _exit(125);
    signal(SIGPIPE, SIG_DFL);
    signal(SIGHUP, SIG_DFL);
    signal(SIGINT, SIG_DFL);
    signal(SIGQUIT, SIG_DFL);
    signal(SIGTTOU, SIG_DFL);
    execv(argv[5], &argv[5]);
    _exit(127);
  }
  close(gate[0]);
  if (setpgid(root, root) < 0 && errno != EACCES) { close(gate[1]); gate[1] = -1; event("error", errno, 0); }
  if (is_pty && tcsetpgrp(STDIN_FILENO, root) < 0) { close(gate[1]); gate[1] = -1; event("error", errno, 0); }
  int disconnected = event("ready", root, 0) < 0;
  int started = 0, exited = 0, forced = 0;
  struct timespec disconnect_at = {0};
  for (;;) {
    struct pollfd descriptor = { .fd = control, .events = POLLIN };
    int polled = disconnected ? 0 : poll(&descriptor, 1, 20);
    if (polled > 0) {
      char command;
      ssize_t count = recv(control, &command, 1, 0);
      if (count <= 0) disconnected = 1;
      else if (command == 'S' && !started && gate[1] >= 0) {
        started = 1;
        if (write(gate[1], "S", 1) != 1) disconnected = 1;
        close(gate[1]); gate[1] = -1;
        if (event("running", root, 0) < 0) disconnected = 1;
      } else if (command == 'T' || command == 'K') {
        if (gate[1] >= 0) { close(gate[1]); gate[1] = -1; }
        kill(-root, command == 'K' ? SIGKILL : is_pty ? SIGHUP : SIGTERM);
      }
    } else if (polled < 0 && errno != EINTR) disconnected = 1;
    if (disconnected && disconnect_at.tv_sec == 0) {
      clock_gettime(CLOCK_MONOTONIC, &disconnect_at);
      if (gate[1] >= 0) { close(gate[1]); gate[1] = -1; }
      kill(-root, is_pty ? SIGHUP : SIGTERM);
    }
    if (disconnected && !forced && elapsed_ms(&disconnect_at) >= 3000) {
      kill(-root, SIGKILL);
      forced = 1;
    }
    siginfo_t status = {0};
    if (!exited && waitid(P_PID, (id_t)root, &status, WEXITED | WNOHANG | WNOWAIT) == 0 && status.si_pid == root) {
      exited = 1;
      if (event("exit", status.si_code == CLD_EXITED ? status.si_status : -1,
          status.si_code == CLD_EXITED ? 0 : status.si_status) < 0) disconnected = 1;
    }
    if (exited && session_members(getpid(), root) == 0) {
      event("empty", 0, 0);
      waitpid(root, NULL, 0);
      close(control);
      return 0;
    }
    if (disconnected) {
      if (disconnect_at.tv_sec == 0) continue;
      if (elapsed_ms(&disconnect_at) >= 5000) return 75;
      struct timespec delay = { .tv_nsec = 20000000 };
      nanosleep(&delay, NULL);
    }
  }
}
