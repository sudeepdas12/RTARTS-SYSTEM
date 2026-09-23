/**
 * Ambient type declarations for Supabase Edge Functions running on Deno runtime.
 * Resolves Deno globals and remote URL module imports for VS Code / TypeScript LSP.
 */

declare namespace Deno {
  export interface Env {
    get(key: string): string | undefined;
    set(key: string, value: string): void;
    delete(key: string): void;
    toObject(): Record<string, string>;
  }
  export const env: Env;
  export function serve(handler: (req: Request) => Response | Promise<Response>): void;
}

declare module "https://deno.land/std*" {
  export function serve(handler: (req: Request) => Response | Promise<Response>): any;
  export const serveListener: any;
}

declare module "https://deno.land/x/*" {
  export const SMTPClient: any;
  export const SmtpClient: any;
  const anyExport: any;
  export default anyExport;
}

declare module "https://esm.sh/@supabase/supabase-js*" {
  export * from "@supabase/supabase-js";
}

declare module "https://*" {
  const content: any;
  export default content;
}
