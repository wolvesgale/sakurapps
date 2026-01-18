export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { put } from "@vercel/blob";

const MAX_IMAGE_BYTES = 2.5 * 1024 * 1024; // ~2.5MB safety limit for mobile uploads

async function readJsonImageBuffer(req: Request): Promise<Buffer | null> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return null;

  const body = (await req.json().catch(() => null)) as { imageData?: string } | null;
  if (!body?.imageData || typeof body.imageData !== "string") return null;

  const dataUrlMatch = body.imageData.match(/^data:(.*?);base64,(.*)$/);
  const base64Payload = dataUrlMatch ? dataUrlMatch[2] : body.imageData;
  try {
    return Buffer.from(base64Payload, "base64");
  } catch {
    return null;
  }
}

async function readMultipartImageBuffer(req: Request): Promise<Buffer | null> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) return null;

  const form = await req.formData().catch(() => null);
  if (!form) return null;

  const file = form.get("file");
  if (!file || typeof file === "string") return null;

  try {
    const arrayBuffer = await file.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  try {
    const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
    if (!token) {
      console.error("[attendance-photo upload] missing BLOB_READ_WRITE_TOKEN");
      return NextResponse.json({ error: "画像ストレージの設定が不足しています" }, { status: 400 });
    }

    const buffer = (await readJsonImageBuffer(req)) ?? (await readMultipartImageBuffer(req));
    if (!buffer || buffer.length === 0) {
      return NextResponse.json({ error: "画像データがありません" }, { status: 400 });
    }
    if (buffer.length > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: "画像サイズが大きすぎます。もう一度撮影してください。" }, { status: 413 });
    }

    const fileName = `attendance/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;

    const blob = await put(fileName, buffer, {
      access: "public",
      contentType: "image/jpeg",
      token
    });

    return NextResponse.json({ url: blob.url });
  } catch (error) {
    console.error("[attendance-photo upload]", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    const hint = /unauthorized|401|403/i.test(message)
      ? "画像ストレージの認証に失敗しました。設定を確認してください。"
      : "画像のアップロードに失敗しました";
    return NextResponse.json({ error: hint }, { status: 500 });
  }
}
