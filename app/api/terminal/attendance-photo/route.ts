export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { put } from "@vercel/blob";

// Accepts { imageData: base64String }
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { imageData?: string };
    if (!body.imageData || typeof body.imageData !== "string") {
      return NextResponse.json({ error: "画像データがありません" }, { status: 400 });
    }

    const dataUrlMatch = body.imageData.match(/^data:(.*?);base64,(.*)$/);
    const base64Payload = dataUrlMatch ? dataUrlMatch[2] : body.imageData;

    const buffer = Buffer.from(base64Payload, "base64");
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
