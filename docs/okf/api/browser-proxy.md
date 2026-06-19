---
type: API Reference
title: Browser Proxy Protocol
description: HTTP proxy for embedded browser tabs with URL rewriting, caching, and service worker injection.
tags: [proxy, http, browser, caching]
timestamp: 2026-06-19T00:00:00Z
---

# Browser Proxy Protocol

HTTP proxy running on port 7682 (prod) / 7782 (dev) for transparent browser tab proxying.

## Proxy URL Format

```
/p/<base64-encoded-url>/
```

Example: `http://localhost:7682/p/aHR0cHM6Ly9leGFtcGxlLmNvbS8=` proxies `https://example.com/`

## Features

### Header Stripping

Removes headers that prevent embedding:
- `X-Frame-Options`
- `Content-Security-Policy` (frame-ancestors)

### URL Rewriting

Rewrites relative URLs in HTML, CSS, and JavaScript to route through the proxy:
- `<a href="...">` → `<a href="/p/<b64>/...">`
- `url(...)` in CSS → `url(/p/<b64>/...)`
- `import` / `fetch()` URLs

### Service Worker Injection

Injects a service worker (`SW_SCRIPT`) for fetch interception, ensuring all subresources route through the proxy.

### Caching

- **On-disk LRU cache** — 512 MB default, stored in `cache/` directory
- **DNS cache** — 30 second TTL for upstream DNS resolution
- Cache key: full request URL

### WebSocket Proxying

Handles WebSocket upgrade requests for proxied targets, enabling real-time content.

## Usage in Frontend

```js
function proxyPathUrl(url) {
  return `/p/${btoa(url)}/`
}

// Create browser tab
iframe.src = proxyPathUrl('https://example.com')
```

## Related

- [Node Backend](../architecture/node-backend.md) implementation
- [Frontend Layer](../architecture/frontend.md) consumes this proxy
