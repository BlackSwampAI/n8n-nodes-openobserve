# Batch 1 API foundation

Research refreshed 2026-09-05 against the current generated Cloud [OAS 3.1 contract](https://api.openobserve.ai/api-doc/openapi.json), the pinned v0.92.2 container contract, the current [API authentication reference](https://openobserve.ai/docs/reference/api/), and [service-account guide](https://openobserve.ai/docs/user-guide/account-administration/identity-and-access-management/service-accounts/).

Both user passwords and service-account tokens authenticate through HTTP Basic with the email/account identifier as username and the secret as password. The harmless credential test lists at most one log stream inside the configured organization. Official documentation says self-hosted service accounts have full access by default, Enterprise service accounts require assigned roles, and Cloud does not support service accounts. Production self-hosted automation should use a least-privilege service account where the edition supports it; Cloud uses user credentials.

The shared foundation validates required HTTP/HTTPS base URLs, preserves reverse-proxy paths, rejects userinfo/query/fragment input, and rejects exact `.`/`..` organization or endpoint segments. It explicitly constructs either unversioned `/api/{org}/...` paths (the default) or current `/api/v2/{org}/...` paths. It also serializes repeated query parameters, converts supported time inputs to safe integer microseconds, supports endpoint-owned offset/cursor pagination callbacks, applies n8n-managed authentication, and maps/redacts errors. It implements no retries and no business-resource operations. Destructive or side-effecting operations must opt into any future retry policy explicitly; the default remains no retry.

Return All pagination has no item limit and continues until the endpoint reports no cursor or returns an empty page. Limited mode follows endpoint cursors across capped server pages until it reaches the user limit, encounters an empty page, or exhausts the endpoint, and truncates the final page to the exact limit. Every paginator has a finite maximum-page guard, and endpoints with object cursors must supply a logical cursor key so equivalent newly allocated cursors are detected.

## Contract and behavior notes

- `GET /api/{org_id}/streams` is present in both refreshed contracts and is safe for credential validation. The current contract supports `type`, `keyword`, `offset`, `limit`, and `sort` query parameters.
- The Cloud and pinned contracts both expose service-account CRUD, but route presence does not override edition semantics in the service-account guide.
- Base URLs are required deployment roots with no Cloud default, not `/api/{org}` URLs. A reverse-proxy prefix is retained and the shared builder appends an encoded unversioned or v2 API path. The static credential-test URL is a non-routable sentinel that authentication always replaces.
- Live v0.92.2 validation returned 200 for root email/password and self-hosted service-account email/token stream-list requests, 401 for an invalid password, and 404 for a missing organization. The disposable service account was deleted and its absence confirmed.
- No designated Cloud credentials were available, so Cloud execution and error bodies remain explicitly unverified.
