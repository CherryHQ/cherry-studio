#include <errno.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

int main(int argc, char **argv) {
  if (argc < 3) return 64;
  int writing = strcmp(argv[1], "write") == 0;
  if ((!writing && strcmp(argv[1], "read") != 0) || (writing && argc != 4)) return 64;
  alarm(5);
  FILE *file = fopen(argv[2], writing ? "w" : "r");
  if (!file) {
    if (errno == EACCES || errno == EPERM) {
      puts("PERMISSION_DENIED");
      return 77;
    }
    perror("open");
    return 74;
  }
  if (writing) {
    if (fputs(argv[3], file) == EOF) { fclose(file); return 74; }
  } else {
    char buffer[4096];
    size_t size;
    while ((size = fread(buffer, 1, sizeof(buffer), file)) > 0) {
      if (fwrite(buffer, 1, size, stdout) != size) { fclose(file); return 74; }
    }
    if (ferror(file)) { fclose(file); return 74; }
  }
  return fclose(file) == 0 ? 0 : 74;
}
