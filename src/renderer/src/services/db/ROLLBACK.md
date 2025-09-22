# Rollback Strategy for Unified Database Service Migration

## Overview
This document outlines the rollback procedures for the unified database service migration. The migration uses feature flags to enable gradual rollout and quick rollback capabilities.

## Quick Rollback (< 1 minute)

### Via Browser Console
```javascript
// Disable the unified DB service immediately
localStorage.setItem('featureFlags', JSON.stringify({ USE_UNIFIED_DB_SERVICE: false }))
location.reload()
```

### Via Code (Emergency)
```typescript
// In src/renderer/src/config/featureFlags.ts
export const featureFlags: FeatureFlags = {
  USE_UNIFIED_DB_SERVICE: false  // Change from true to false
}
```

## Rollback Triggers

Monitor these indicators to determine if rollback is needed:

### Critical Issues (Immediate Rollback)
- [ ] Data loss or corruption
- [ ] Application crashes on startup
- [ ] Complete failure to load messages
- [ ] Agent sessions completely broken
- [ ] Performance degradation > 50%

### Major Issues (Rollback within 1 hour)
- [ ] Intermittent message loading failures (> 10% error rate)
- [ ] Memory leaks detected
- [ ] Performance degradation 20-50%
- [ ] File upload/attachment issues
- [ ] Message editing/deletion not working

### Minor Issues (Consider Rollback)
- [ ] Performance degradation < 20%
- [ ] UI glitches or inconsistencies
- [ ] Non-critical features affected
- [ ] Increased error logs but functionality intact

## Rollback Procedures

### Level 1: Feature Flag Toggle (Immediate)
**When:** Any critical issue detected
**Time:** < 1 minute
**Data Impact:** None

1. Set feature flag to false:
   ```javascript
   localStorage.setItem('featureFlags', JSON.stringify({ USE_UNIFIED_DB_SERVICE: false }))
   ```
2. Reload application
3. Verify original functionality restored
4. Alert team about rollback

### Level 2: Code Revert (Quick)
**When:** Feature flag not sufficient or broken
**Time:** < 5 minutes
**Data Impact:** None

1. Revert to previous commit:
   ```bash
   git revert HEAD  # If just deployed
   # or
   git checkout <last-known-good-commit>
   ```
2. Rebuild and deploy:
   ```bash
   yarn build:check
   yarn build
   ```
3. Test core functionality
4. Document issue for investigation

### Level 3: Full Rollback (Planned)
**When:** Systemic issues discovered
**Time:** 30 minutes
**Data Impact:** Potential data migration needed

1. Notify all stakeholders
2. Export any critical data if needed
3. Restore from backup branch:
   ```bash
   git checkout main
   git branch -D feature/unified-db-service
   git push origin --delete feature/unified-db-service
   ```
4. Clean up any migration artifacts:
   - Remove `messageThunk.v2.ts`
   - Remove `src/renderer/src/services/db/` if created
   - Remove feature flags configuration
5. Run full test suite
6. Deploy clean version

## Pre-Rollback Checklist

Before initiating rollback:

1. **Capture Current State**
   - [ ] Export performance metrics
   - [ ] Save error logs
   - [ ] Document specific failure scenarios
   - [ ] Note affected user percentage

2. **Preserve Evidence**
   - [ ] Take screenshots of errors
   - [ ] Export browser console logs
   - [ ] Save network traces if relevant
   - [ ] Backup current localStorage

3. **Communication**
   - [ ] Notify development team
   - [ ] Update status page if applicable
   - [ ] Prepare user communication if needed

## Post-Rollback Actions

After successful rollback:

1. **Verification**
   - [ ] Test message loading (regular chat)
   - [ ] Test agent sessions
   - [ ] Verify file attachments work
   - [ ] Check message editing/deletion
   - [ ] Confirm no data loss

2. **Investigation**
   - [ ] Analyze performance metrics
   - [ ] Review error logs
   - [ ] Identify root cause
   - [ ] Create bug report

3. **Planning**
   - [ ] Document lessons learned
   - [ ] Update rollback procedures if needed
   - [ ] Plan fixes for identified issues
   - [ ] Schedule retry with fixes

## Monitoring Commands

### Check Feature Flag Status
```javascript
// In browser console
JSON.parse(localStorage.getItem('featureFlags') || '{}')
```

### View Performance Metrics
```javascript
// In browser console (if performance monitor is exposed)
performanceMonitor.getAllComparisons()
```

### Check Error Rate
```javascript
// Check application logs
loggerService.getLogs().filter(log => log.level === 'error' && log.context.includes('DbService'))
```

## Recovery Validation

After rollback, validate system health:

1. **Functional Tests**
   ```bash
   yarn test
   yarn test:e2e  # If available
   ```

2. **Manual Validation**
   - Create new chat conversation
   - Send messages with attachments
   - Edit existing messages
   - Delete messages
   - Start agent session
   - Load historical messages

3. **Performance Check**
   - Message load time < 500ms
   - No memory leaks after 10 minutes
   - CPU usage normal
   - Network requests successful

## Emergency Contacts

- **Tech Lead:** [Contact Info]
- **DevOps:** [Contact Info]
- **Product Owner:** [Contact Info]

## Rollback History

| Date | Version | Issue | Rollback Type | Resolution |
|------|---------|-------|---------------|------------|
| -    | -       | -     | -             | -          |

## Notes

- Always prefer feature flag rollback first (least disruptive)
- Document any rollback in the history table above
- If multiple rollbacks needed, consider pausing migration
- Performance degradation baseline: original implementation metrics