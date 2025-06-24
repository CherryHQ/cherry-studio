# EIO Error Fix Documentation

## Problem

The application was experiencing `Error: write EIO` when trying to write to console streams. This commonly occurs in packaged Electron applications when:

- The app runs without a console (especially on Windows)
- Console streams have been closed or redirected
- The app attempts to write warnings/errors after streams are unavailable

## Solution

We've implemented a comprehensive logging solution that:

1. **Gracefully handles console write errors**

   - All console operations are wrapped in try-catch blocks
   - Errors are silently ignored to prevent crashes

2. **Uses file-based logging in production**

   - Console transport is disabled in production builds
   - All logs are written to files in the user data directory
   - Log files are located at: `[userData]/logs/main.log`

3. **Provides fallback crash logging**

   - If the logger itself fails, critical errors are written to `crash.log`
   - This ensures we never lose important error information

4. **Handles stdio stream errors**
   - EPIPE and EIO errors on stdout/stderr are explicitly ignored
   - Prevents the process from crashing due to closed streams

## Implementation Details

### Main Process Logger (`src/main/configs/logger.ts`)

- Configures electron-log with appropriate transports
- Disables console in production to avoid EIO errors
- Sets up file logging with rotation (10MB max size)
- Overrides global console methods with safe versions

### Renderer Process Logger (`src/renderer/src/config/logger.ts`)

- Mirrors main process configuration for consistency
- Wraps all console methods in error handlers
- Delegates actual logging to the main process

### Error Handlers (`src/main/index.ts`)

- Catches uncaught exceptions and unhandled promise rejections
- Logs errors to file with fallback to crash.log
- Prevents stdio stream errors from crashing the app

## Testing

To verify the fix:

1. Build the application for production
2. Run without a console (double-click the .exe on Windows)
3. Check logs are being written to the userData directory
4. Verify no crashes occur from console operations

## Debugging

If issues persist:

1. Check the `crash.log` file in the userData directory
2. Look for the main log file at `[userData]/logs/main.log`
3. Enable debug logging by setting `NODE_ENV=development`
