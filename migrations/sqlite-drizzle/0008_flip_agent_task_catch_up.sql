-- Agent tasks created before the v2 catch-up fix were persisted with the
-- framework default `skip-missed`, silently dropping a fire that elapsed while
-- the app was closed or the task paused. Flip them to `after-startup` so the
-- startup / resume recovery path makes the missed run up exactly once
-- (cherry-studio#18607).
UPDATE `job_schedule`
SET `catch_up_policy` = '{"kind":"after-startup","minutes":0}'
WHERE `type` = 'agent.task' AND `catch_up_policy` = '{"kind":"skip-missed"}';