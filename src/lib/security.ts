const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

export function sanitizeText(value: string, maxLength = 2000): string {
  return value
    .replace(/[\u0000-\u001F\u007F]+/g, " ")
    .replace(/<script|<iframe|javascript:|on\w+=/gi, "")
    .trim()
    .slice(0, maxLength);
}

export function isRateLimited(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();
  const previous = rateLimitMap.get(key);

  if (!previous || previous.resetAt <= now) {
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }

  if (previous.count >= maxRequests) {
    return true;
  }

  previous.count += 1;
  rateLimitMap.set(key, previous);
  return false;
}

export function applySecurityHeaders(request: Request, response: Response): Response {
  const headers = new Headers(response.headers);
  const url = new URL(request.url);
  const isHttps =
    url.protocol === "https:" ||
    request.headers.get("x-forwarded-proto") === "https" ||
    request.headers.get("cf-visitor")?.includes("https") === true;

  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https://fonts.gstatic.com",
    "connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com",
    "media-src 'self'",
    "upgrade-insecure-requests",
  ].join("; ");

  if (!headers.has("content-security-policy")) {
    headers.set("content-security-policy", csp);
  }
  if (!headers.has("x-content-type-options")) {
    headers.set("x-content-type-options", "nosniff");
  }
  if (!headers.has("x-frame-options")) {
    headers.set("x-frame-options", "DENY");
  }
  if (!headers.has("referrer-policy")) {
    headers.set("referrer-policy", "strict-origin-when-cross-origin");
  }
  if (!headers.has("permissions-policy")) {
    headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(), interest-cohort=()");
  }
  if (!headers.has("cross-origin-opener-policy")) {
    headers.set("cross-origin-opener-policy", "same-origin");
  }
  if (!headers.has("cross-origin-resource-policy")) {
    headers.set("cross-origin-resource-policy", "same-origin");
  }
  if (!headers.has("x-dns-prefetch-control")) {
    headers.set("x-dns-prefetch-control", "off");
  }
  if (isHttps && !headers.has("strict-transport-security")) {
    headers.set("strict-transport-security", "max-age=31536000; includeSubDomains; preload");
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
