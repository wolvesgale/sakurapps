import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentSession } from "@/lib/session";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const dynamic = "force-dynamic";

async function createStore(formData: FormData) {
  "use server";
  const session = await getCurrentSession();
  if (!session || session.user.role !== "OWNER") {
    throw new Error("Unauthorized");
  }

  const name = formData.get("name");
  const address = formData.get("address");
  const openingTime = formData.get("openingTime");
  const closingTime = formData.get("closingTime");

  if (!name || typeof name !== "string") {
    throw new Error("店舗名を入力してください");
  }

  await prisma.store.create({
    data: {
      name,
      address: typeof address === "string" ? address : null,
      openingTime: typeof openingTime === "string" ? openingTime : null,
      closingTime: typeof closingTime === "string" ? closingTime : null
    }
  });

  revalidatePath("/stores");
}

export default async function StoresPage() {
  const session = await getCurrentSession();

  if (!session || !["OWNER", "ADMIN"].includes(session.user.role)) {
    redirect("/dashboard");
  }

  const stores = await prisma.store.findMany({
    where:
      session.user.role === "ADMIN" && session.user.storeId
        ? { id: session.user.storeId }
        : undefined,
    orderBy: { name: "asc" }
  });

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold text-pink-300">店舗管理</h1>
      {session.user.role === "OWNER" ? (
        <Card>
          <CardHeader>
            <CardTitle>新規店舗作成</CardTitle>
            <CardDescription>営業時間は24時間形式 (例: 18:00)</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={createStore} className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="name">店舗名</Label>
                <Input id="name" name="name" required />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="address">住所</Label>
                <Input id="address" name="address" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="openingTime">開店時間</Label>
                <Input id="openingTime" name="openingTime" placeholder="18:00" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="closingTime">閉店時間</Label>
                <Input id="closingTime" name="closingTime" placeholder="25:00" />
              </div>
              <Button type="submit" className="sm:col-span-2">
                追加する
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>店舗一覧</CardTitle>
        </CardHeader>
        <CardContent>
          {stores.length === 0 ? (
            <p className="text-sm text-slate-400">登録された店舗がありません。</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {stores.map((store) => (
                <li key={store.id} className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
                  <p className="text-lg font-semibold text-pink-200">{store.name}</p>
                  <p className="text-xs text-slate-400">{store.address ?? "住所未設定"}</p>
                  <p className="text-xs text-slate-500">
                    営業時間: {store.openingTime ?? "--:--"} - {store.closingTime ?? "--:--"}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

    </div>
  );
}
