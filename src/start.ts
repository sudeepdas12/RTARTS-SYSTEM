import { createStart, createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

/**
 * Cross-Site Request Forgery (CSRF) & Origin Defense Middleware
 *
 * All state-changing requests and server function invocations are guarded:
 * 1. Sec-Fetch-Site: rejects cross-site attempts initiated by third-party origins.
 * 2. Origin/Host mismatch: validates that incoming Origin matches the Host.
 * 3. In tandem with `requireSupabaseAuth`, all mutating server RPCs require an explicit
 *    `Authorization: Bearer <token>` header that cross-site scripts cannot forge.
 */
const csrfMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    const request = getRequest();
    if (request?.headers) {
      const method = request.method?.toUpperCase();
      // Only state-mutating HTTP methods require CSRF/Origin enforcement
      if (method && ["POST", "PUT", "DELETE", "PATCH"].includes(method)) {
        const secFetchSite = request.headers.get("sec-fetch-site");
        const origin = request.headers.get("origin");
        const host = request.headers.get("host");

        // Reject cross-site requests if flagged by modern browser fetch metadata
        if (secFetchSite === "cross-site") {
          return new Response("Forbidden: Cross-site request rejected by CSRF policy.", {
            status: 403,
            headers: { "content-type": "text/plain; charset=utf-8" },
          });
        }

        // If Origin is provided, verify it matches Host
        if (origin && host) {
          try {
            const originHost = new URL(origin).host;
            if (originHost !== host) {
              return new Response("Forbidden: Origin mismatch rejected by CSRF policy.", {
                status: 403,
                headers: { "content-type": "text/plain; charset=utf-8" },
              });
            }
          } catch {
            return new Response("Forbidden: Malformed origin header.", {
              status: 403,
              headers: { "content-type": "text/plain; charset=utf-8" },
            });
          }
        }
      }
    }
  } catch {
    // If request context is not present (e.g. static SSG build), continue
  }
  return await next();
});

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

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth],
  requestMiddleware: [csrfMiddleware, errorMiddleware],
}));
