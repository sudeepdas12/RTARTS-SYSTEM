import { createFileRoute } from "@tanstack/react-router";
import { ExcelParser } from "@/lib/excel-parser";

export const Route = createFileRoute("/api/parse-excel")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
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
