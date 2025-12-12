export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { put } from "@vercel/blob";

async function readImageBuffer(req: Request): Promise<Buffer | null> {
  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const body = (await req.json()) as { imageData?: string };
    if (!body.imageData || typeof body.imageData !== "string") return null;

    const dataUrlMatch = body.imageData.match(/^data:(.*?);base64,(.*)$/);
    const base64Payload = dataUrlMatch ? dataUrlMatch[2] : body.imageData;
    return Buffer.from(base64Payload, "base64");
  }

  if (contentType.includes("multipart/form-data")) {
    const formData = await req.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File)) return null;
    return Buffer.from(await file.arrayBuffer());
  }

  return null;
}

// Accepts JSON data URLs or multipart/form-data("file") to remain backward compatible
export async function POST(req: Request) {
  try {
    const buffer = await readImageBuffer(req);
    if (!buffer || buffer.length === 0) {
      return NextResponse.json({ error: "画像データがありません" }, { status: 400 });
    }

    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      console.error("[attendance-photo upload] missing BLOB_READ_WRITE_TOKEN");
      return NextResponse.json({ error: "画像ストレージの設定が不足しています" }, { status: 400 });
    }

    const fileName = `attendance/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;

    const blob = await put(fileName, buffer, {
      access: "public",
      contentType: "image/jpeg"
    });

    return NextResponse.json({ url: blob.url });
  } catch (error) {
    console.error("[attendance-photo upload]", error);
    return NextResponse.json({ error: "画像のアップロードに失敗しました" }, { status: 500 });
  }
}
