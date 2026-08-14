import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { applySecurityHeaders } from "./lib/security";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

const securityHeadersMiddleware = createMiddleware().server(async ({ next, request }) => {
  const response = await next();

  // DEV-time check: if an HTML response is empty, log and return a helpful error page
  try {
    if (!response || !response.headers || typeof response.headers.get !== "function") {
      // Not an HTTP Response-like object; skip checks and return as-is.
      return response;
    }

    const contentType = response.headers.get("content-type") || "";
    if (response.status === 200 && contentType.includes("text/html")) {
      const cloned = response.clone();
      const text = await cloned.text().catch(() => "");
      if (!text || text.trim().length === 0) {
        console.error("SSR returned empty HTML response — returning error page instead.");
        return applySecurityHeaders(request, new Response(renderErrorPage(), {
          status: 500,
          headers: { "content-type": "text/html; charset=utf-8" },
        }));
      }
    }
  } catch (err) {
    console.error("Error while checking HTML response:", err);
  }

  return applySecurityHeaders(request, response);
});

export const startInstance = createStart(() => ({
  requestMiddleware: [errorMiddleware, securityHeadersMiddleware],
}));
