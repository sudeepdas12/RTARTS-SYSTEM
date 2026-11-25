import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { ExcelParser } from "@/lib/excel-parser";
import type { Database } from "@/integrations/supabase/types";

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB hard ceiling

export const Route = createFileRoute("/api/parse-excel")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const authHeader = request.headers.get("authorization") || "";
          if (!authHeader.startsWith("Bearer ")) {
            return new Response(JSON.stringify({ error: "Unauthorized: Bearer token required" }), {
              status: 401,
              headers: { "Content-Type": "application/json" },
            });
          }

          const token = authHeader.slice(7).trim();
          const supabaseUrl =
            process.env.SUPABASE_URL ||
            process.env.NEXT_PUBLIC_SUPABASE_URL ||
            process.env.VITE_SUPABASE_URL;
          const supabaseKey =
            process.env.SUPABASE_PUBLISHABLE_KEY ||
            process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
            process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

          if (!supabaseUrl || !supabaseKey) {
            return new Response(
              JSON.stringify({ error: "Server auth configuration unavailable" }),
              {
                status: 500,
                headers: { "Content-Type": "application/json" },
              },
            );
          }

          const supabase = createClient<Database>(supabaseUrl, supabaseKey, {
            global: {
              headers: {
                Authorization: `Bearer ${token}`,
              },
            },
            auth: { persistSession: false, autoRefreshToken: false },
          });

          const { data: userData, error: userErr } = await supabase.auth.getUser(token);
          if (userErr || !userData?.user) {
            return new Response(
              JSON.stringify({ error: "Unauthorized: invalid or expired session" }),
              {
                status: 401,
                headers: { "Content-Type": "application/json" },
              },
            );
          }

          const { data: roleRows, error: roleErr } = await supabase
            .from("user_roles")
            .select("role")
            .eq("user_id", userData.user.id);

          const allowedRoles = new Set([
            "admin",
            "supervisor",
            "finance_operator",
            "operator",
            "maker",
            "reconciliation_officer",
          ]);
          const hasRole = !roleErr && (roleRows || []).some((r: any) => allowedRoles.has(r.role));
          if (!hasRole) {
            return new Response(
              JSON.stringify({ error: "Forbidden: insufficient role permissions" }),
              {
                status: 403,
                headers: { "Content-Type": "application/json" },
              },
            );
          }

          const contentType = request.headers.get("content-type") || "";
          let fileName = "upload.xlsx";
          let buffer: ArrayBuffer;

          if (contentType.includes("multipart/form-data")) {
            const formData = await request.formData();
            const file = formData.get("file");
            if (!file || typeof file === "string") {
              return new Response(JSON.stringify({ error: "No file attached in form data" }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
              });
            }
            if ((file as File).size > MAX_UPLOAD_BYTES) {
              return new Response(
                JSON.stringify({ error: "File exceeds maximum 50 MB size limit" }),
                {
                  status: 413,
                  headers: { "Content-Type": "application/json" },
                },
              );
            }
            fileName = (file as File).name || "upload.xlsx";
            buffer = await (file as File).arrayBuffer();
          } else {
            fileName = decodeURIComponent(request.headers.get("x-filename") || "upload.xlsx");
            buffer = await request.arrayBuffer();
          }

          if (!buffer || buffer.byteLength === 0) {
            return new Response(JSON.stringify({ error: "File buffer is empty" }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }

          if (buffer.byteLength > MAX_UPLOAD_BYTES) {
            return new Response(
              JSON.stringify({ error: "File exceeds maximum 50 MB size limit" }),
              {
                status: 413,
                headers: { "Content-Type": "application/json" },
              },
            );
          }

          const parsed = await ExcelParser.parseBuffer(buffer, fileName);
          return new Response(JSON.stringify(parsed), {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
            },
          });
        } catch (err: any) {
          console.error("Server-side Excel parse failed:", err);
          return new Response(
            JSON.stringify({
              error: err?.message || "Internal spreadsheet parser error",
            }),
            {
              status: 500,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
      },
    },
  },
});
