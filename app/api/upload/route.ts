import { env } from "cloudflare:workers";

interface UploadBucket {
  put(key: string, body: ArrayBuffer, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<{
    body: ReadableStream;
    httpMetadata?: { contentType?: string };
    writeHttpMetadata(headers: Headers): void;
  } | null>;
}

function getBucket() {
  const bucket = (env as unknown as { BUCKET?: UploadBucket }).BUCKET;
  if (!bucket) throw new Error("Document storage is unavailable");
  return bucket;
}

export async function POST(request: Request) {
  try {
    const data = await request.formData();
    const file = data.get("file");
    if (!(file instanceof File)) {
      return Response.json({ error: "Choose a PDF or image to upload" }, { status: 400 });
    }
    const allowed = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(file.type)) {
      return Response.json({ error: "Only PDF, JPG, PNG, and WebP files are accepted" }, { status: 400 });
    }
    if (file.size > 10 * 1024 * 1024) {
      return Response.json({ error: "The file must be smaller than 10 MB" }, { status: 400 });
    }
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
    const key = `documents/${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}-${safeName}`;
    await getBucket().put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type },
    });
    return Response.json({ key, name: file.name, type: file.type });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Upload failed" },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get("key") ?? "";
  if (!key.startsWith("documents/") || key.includes("..")) {
    return new Response("Invalid document", { status: 400 });
  }
  const object = await getBucket().get(key);
  if (!object) return new Response("Document not found", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Content-Disposition", "inline");
  headers.set("Cache-Control", "private, max-age=3600");
  return new Response(object.body, { headers });
}
