import { getStore } from "@netlify/blobs";
import { isSupportedOrderDocument, isSupportedReceiptDocument } from "../../upload-types";

function getDocumentStore() {
  return getStore({ name: "erentals-documents", consistency: "strong" });
}

export async function POST(request: Request) {
  try {
    const data = await request.formData();
    const file = data.get("file");
    const kind = String(data.get("kind") ?? "");
    if (!(file instanceof File)) {
      return Response.json({ error: "Choose a PDF or image to upload" }, { status: 400 });
    }
    const allowed = kind === "order" ? isSupportedOrderDocument(file.type) : isSupportedReceiptDocument(file.type);
    if (!allowed) {
      return Response.json({ error: kind === "order" ? "Only images, PDF, XLS, XLSX, and CSV files are accepted" : "Only images and PDF files are accepted" }, { status: 400 });
    }
    if (file.size > 10 * 1024 * 1024) {
      return Response.json({ error: "The file must be smaller than 10 MB" }, { status: 400 });
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
    const key = `documents/${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}-${safeName}`;
    await getDocumentStore().set(key, await file.arrayBuffer(), {
      metadata: { contentType: file.type, originalName: file.name },
      onlyIfNew: true,
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
  try {
    const key = new URL(request.url).searchParams.get("key") ?? "";
    if (!key.startsWith("documents/") || key.includes("..")) {
      return new Response("Invalid document", { status: 400 });
    }

    const object = await getDocumentStore().getWithMetadata(key, {
      type: "stream",
      consistency: "strong",
    });
    if (!object) return new Response("Document not found", { status: 404 });

    const contentType =
      typeof object.metadata.contentType === "string"
        ? object.metadata.contentType
        : "application/octet-stream";
    const headers = new Headers({
      "Content-Type": contentType,
      "Content-Disposition": "inline",
      "Cache-Control": "private, max-age=3600",
    });
    return new Response(object.data, { headers });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "Unable to load document", {
      status: 500,
    });
  }
}
