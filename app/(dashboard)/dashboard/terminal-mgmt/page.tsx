import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentSession } from "@/lib/session";
import { getOrCreateDefaultStore } from "@/lib/store";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const dynamic = "force-dynamic";

async function registerTerminal(formData: FormData) {
  "use server";
  const session = await getCurrentSession();

  if (!session || !["OWNER", "ADMIN"].includes(session.user.role)) {
    throw new Error("Unauthorized");
  }

  const deviceId = formData.get("deviceId");
  const label = formData.get("label");
  const storeId = formData.get("storeId");

  if (!deviceId || typeof deviceId !== "string") {
    throw new Error("端末IDを入力してください");
  }

  const normalizedDeviceId = deviceId.trim();

  const defaultStore = await getOrCreateDefaultStore();

  const targetStoreId =
    session.user.role === "ADMIN"
      ? session.user.storeId ?? defaultStore.id
      : typeof storeId === "string" && storeId.length > 0
        ? storeId
        : defaultStore.id;

  if (!targetStoreId) {
    throw new Error("店舗を選択してください");
  }

  await prisma.terminal.create({
    data: {
      deviceId: normalizedDeviceId,
      label: typeof label === "string" && label.length > 0 ? label : null,
      store: {
        connect: { id: targetStoreId }
      }
    }
  });

  revalidatePath("/dashboard/terminal-mgmt");
}

export default async function TerminalManagementPage() {
  const session = await getCurrentSession();

  if (!session || !["OWNER", "ADMIN"].includes(session.user.role)) {
    redirect("/dashboard");
  }

  const defaultStore = await getOrCreateDefaultStore();

  let stores: Awaited<ReturnType<typeof prisma.store.findMany>> = [];
  type TerminalWithStore = Prisma.TerminalGetPayload<{ include: { store: true } }>;
  let terminals: TerminalWithStore[] = [];

  try {
    stores = await prisma.store.findMany({
      where:
        session.user.role === "ADMIN" && session.user.storeId
          ? { id: session.user.storeId }
          : undefined,
      orderBy: { name: "asc" }
    });
  } catch (error) {
    console.error("[terminal-mgmt:stores]", error);
    stores = [];
  }

  const normalizedStores = stores.length > 0 ? stores : [defaultStore];

  try {
    terminals = await prisma.terminal.findMany({
      where:
        session.user.role === "ADMIN" && session.user.storeId
          ? { storeId: session.user.storeId }
          : undefined,
      include: { store: true },
      orderBy: { createdAt: "desc" }
    });
  } catch (error) {
    console.error("[terminal-mgmt:terminals]", error);
    terminals = [];
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold text-pink-300">端末管理</h1>

      <Card>
        <CardHeader>
          <CardTitle>端末登録</CardTitle>
          <CardDescription>店舗ごとに許可する端末IDを登録してください。</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={registerTerminal} className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="deviceId">端末ID</Label>
              <Input id="deviceId" name="deviceId" placeholder="UUIDや登録コード" required />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="label">メモ (任意)</Label>
              <Input id="label" name="label" placeholder="カウンター端末など" />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>紐づけ店舗</Label>
              <Select
                name="storeId"
                defaultValue={normalizedStores[0]?.id ?? defaultStore.id}
                disabled={session.user.role === "ADMIN"}
              >
                <SelectTrigger>
                  <SelectValue placeholder="店舗を選択" />
                </SelectTrigger>
                <SelectContent>
                  {normalizedStores.map((store) => (
                    <SelectItem key={store.id} value={store.id}>
                      {store.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-500">ADMIN は自店舗のみ登録可能です。</p>
            </div>
            <Button type="submit" className="sm:col-span-2">
              端末を登録
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>登録済み端末</CardTitle>
        </CardHeader>
        <CardContent>
          {terminals.length === 0 ? (
            <p className="text-sm text-slate-400">登録済み端末がありません。</p>
          ) : (
            <ul className="space-y-3 text-sm">
              {terminals.map((terminal) => (
                <li key={terminal.id} className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
                  <div className="flex flex-col gap-1">
                    <p className="font-semibold text-pink-200">{terminal.label ?? "端末"}</p>
                    <p className="text-xs text-slate-400">ID: {terminal.deviceId}</p>
                    <p className="text-xs text-slate-500">店舗: {terminal.store?.name ?? "不明"}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
