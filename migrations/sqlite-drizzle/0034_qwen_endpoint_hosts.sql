-- Match the URL authority, including optional userinfo and a valid port; preserve all other bytes.
WITH RECURSIVE
endpoint_urls AS (
  SELECT provider.provider_id, endpoint.key AS endpoint_key,
    json_extract(CASE WHEN endpoint.type = 'object' THEN endpoint.value ELSE '{}' END, '$.baseUrl') AS base_url
  FROM user_provider AS provider,
    json_each(CASE WHEN json_valid(provider.endpoint_configs) THEN provider.endpoint_configs ELSE '{}' END) AS endpoint
  WHERE json_type(CASE WHEN endpoint.type = 'object' THEN endpoint.value ELSE '{}' END, '$.baseUrl') = 'text'
),
http_urls AS (
  SELECT *, substr(base_url, 1, instr(base_url, '://') + 2) AS prefix,
    substr(base_url, instr(base_url, '://') + 3) AS remainder
  FROM endpoint_urls
  WHERE lower(substr(base_url, 1, instr(base_url, '://') + 2)) IN ('http://', 'https://')
    AND instr(base_url, char(0)) = 0
    AND base_url NOT GLOB ('*[' || char(1) || '-' || char(32) || char(127) || char(92) || ']*')
),
authorities AS (
  SELECT *, substr(remainder, 1,
    min(instr(remainder || '/', '/'), instr(remainder || '?', '?'), instr(remainder || '#', '#')) - 1
  ) AS authority
  FROM http_urls
),
host_parts(provider_id, endpoint_key, base_url, host_tail, host_start) AS (
  SELECT provider_id, endpoint_key, base_url, authority, length(prefix) + 1 FROM authorities
  UNION ALL
  SELECT provider_id, endpoint_key, base_url,
    substr(host_tail, instr(host_tail, '@') + 1), host_start + instr(host_tail, '@')
  FROM host_parts WHERE instr(host_tail, '@') > 0
),
hosts AS (
  SELECT *, lower(substr(host_tail, 1, instr(host_tail || ':', ':') - 1)) AS hostname,
    CASE WHEN instr(host_tail, ':') > 0 THEN substr(host_tail, instr(host_tail, ':') + 1) ELSE '' END AS port
  FROM host_parts WHERE instr(host_tail, '@') = 0
),
replacements AS (
  SELECT provider_id, endpoint_key,
    substr(base_url, 1, host_start - 1) ||
    CASE hostname
      WHEN 'dashscope.aliyuncs.com' THEN 'maas.qianwenaiapi.com'
      WHEN 'dashscope-intl.aliyuncs.com' THEN 'maas.qwencloudapi.com'
    END || substr(base_url, host_start + length(hostname)) AS base_url
  FROM hosts
  WHERE hostname IN ('dashscope.aliyuncs.com', 'dashscope-intl.aliyuncs.com')
    AND (port = '' OR (port NOT GLOB '*[^0-9]*' AND CAST(port AS INTEGER) <= 65535))
),
patches AS (
  SELECT provider_id, json_group_object(endpoint_key, json_object('baseUrl', base_url)) AS patch
  FROM replacements GROUP BY provider_id
)
UPDATE user_provider
SET endpoint_configs = json_patch(endpoint_configs, (SELECT patch FROM patches WHERE patches.provider_id = user_provider.provider_id))
WHERE provider_id IN (SELECT provider_id FROM patches);
