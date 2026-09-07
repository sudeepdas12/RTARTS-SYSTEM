/**
 * Centralized logging utility.
 * Supports console logging in development and optional remote error tracking (e.g. Sentry) when configured.
 */

declare global {
  interface Window {
    Sentry?: {
      captureMessage: (msg: string, level?: string) => void;
      captureException: (err: any) => void;
    };
  }
}

export function initLogger() {
  const dsn = typeof import.meta !== "undefined" && import.meta.env ? import.meta.env.VITE_SENTRY_DSN : undefined;
  if (dsn && typeof window !== "undefined" && window.Sentry) {
    console.info("[Logger] Sentry integration active.");
  }
}

export const logger = {
  info: (message: any, ...optionalParams: any[]) => {
    console.info(message, ...optionalParams);
    if (typeof window !== "undefined" && window.Sentry?.captureMessage) {
      try {
        window.Sentry.captureMessage(typeof message === "string" ? message : JSON.stringify(message), "info");
      } catch {
        // Ignore Sentry dispatch error
      }
    }
  },
  warn: (message: any, ...optionalParams: any[]) => {
    console.warn(message, ...optionalParams);
    if (typeof window !== "undefined" && window.Sentry?.captureMessage) {
      try {
        window.Sentry.captureMessage(typeof message === "string" ? message : JSON.stringify(message), "warning");
      } catch {
        // Ignore Sentry dispatch error
      }
    }
  },
  error: (error: any, ...optionalParams: any[]) => {
    console.error(error, ...optionalParams);
    if (typeof window !== "undefined" && window.Sentry?.captureException) {
      try {
        window.Sentry.captureException(error);
      } catch {
        // Ignore Sentry dispatch error
      }
    }
  },
};

