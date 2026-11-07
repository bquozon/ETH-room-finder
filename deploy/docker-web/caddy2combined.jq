# Caddy JSON access log -> Apache "combined" lines for GoAccess. Skips the once-a-minute /data/ refreshes.
select(.request.uri | startswith("/data/") | not)
| "\(.request.client_ip // .request.remote_ip) - - [\(.ts | floor | strftime("%d/%b/%Y:%H:%M:%S +0000"))] \"\(.request.method) \(.request.uri) \(.request.proto)\" \(.status) \(.size) \"\(.request.headers.Referer[0]? // "-")\" \"\(.request.headers["User-Agent"][0]? // "-")\""
