import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/session";
import { getOrCreateDefaultStore } from "@/lib/store";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

export const dynamic = "force-dynamic";

export default async function StoresPage() {
  const session = await getCurrentSession();

  if (!session || !["OWNER", "ADMIN"].includes(session.user.role)) {
    redirect("/dashboard");
  }

  const store = await getOrCreateDefaultStore();

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold text-pink-300">店舗情報</h1>

      <Card>
        <CardHeader>
          <CardTitle>{store.name}</CardTitle>
          <CardDescription>
            Nest SAKURA 専用のため、店舗の追加・削除は現在無効化しています。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-slate-100">
          <div>
            <Label className="text-xs text-slate-400">店舗名</Label>
            <p className="text-base font-semibold text-pink-200">{store.name}</p>
          </div>
          <div>
            <Label className="text-xs text-slate-400">住所</Label>
            <p className="text-base">{store.address ?? "未設定"}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs text-slate-400">開店時間</Label>
              <p className="text-base">{store.openingTime ?? "--:--"}</p>
            </div>
            <div>
              <Label className="text-xs text-slate-400">閉店時間</Label>
              <p className="text-base">{store.closingTime ?? "--:--"}</p>
            </div>
          </div>
          <p className="text-xs text-slate-500">
            今後マルチ店舗対応を復活させる際に設定編集を再開します。
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
