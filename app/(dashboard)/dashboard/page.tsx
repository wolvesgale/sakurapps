import { startOfDay, startOfWeek, startOfMonth } from "date-fns";
import { ja } from "date-fns/locale";
import { format } from "date-fns";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentSession } from "@/lib/session";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const dynamic = "force-dynamic";

async function createRide(formData: FormData) {
  "use server";
  const session = await getCurrentSession();

  if (!session || session.user.role !== "DRIVER") {
    throw new Error("Unauthorized");
  }

  const note = formData.get("note");
  const storeId = formData.get("storeId");

  if (!note || typeof note !== "string") {
    throw new Error("メモを入力してください");
  }

  await prisma.ride.create({
    data: {
      note,
      driverId: session.user.id,
      storeId: typeof storeId === "string" && storeId !== "__none__" ? storeId : null
    }
  });

  revalidatePath("/dashboard");
}

async function getOwnerData() {
  const now = new Date();
  const [today, week, month, casts] = await Promise.all([
    prisma.sale.aggregate({
      _sum: { amount: true },
      where: { createdAt: { gte: startOfDay(now) } }
    }),
    prisma.sale.aggregate({
      _sum: { amount: true },
      where: { createdAt: { gte: startOfWeek(now, { weekStartsOn: 1 }) } }
    }),
    prisma.sale.aggregate({
      _sum: { amount: true },
      where: { createdAt: { gte: startOfMonth(now) } }
    }),
    prisma.user.findMany({
      where: { role: "CAST", isActive: true },
      include: {
        attendances: {
          orderBy: { timestamp: "desc" },
          take: 1
        },
        store: true
      }
    })
  ]);

  const workingCasts = casts.filter((cast) => cast.attendances[0]?.type !== "CLOCK_OUT");

  return {
    today: today._sum.amount ?? 0,
    week: week._sum.amount ?? 0,
    month: month._sum.amount ?? 0,
    workingCasts
  };
}

async function getAdminData(storeId: string) {
  const now = new Date();
  const [today, week, month, casts] = await Promise.all([
    prisma.sale.aggregate({
      _sum: { amount: true },
      where: { createdAt: { gte: startOfDay(now) }, storeId }
    }),
    prisma.sale.aggregate({
      _sum: { amount: true },
      where: { createdAt: { gte: startOfWeek(now, { weekStartsOn: 1 }) }, storeId }
    }),
    prisma.sale.aggregate({
      _sum: { amount: true },
      where: { createdAt: { gte: startOfMonth(now) }, storeId }
    }),
    prisma.user.findMany({
      where: { role: "CAST", isActive: true, storeId },
      include: {
        attendances: {
          orderBy: { timestamp: "desc" },
          take: 1
        }
      }
    })
  ]);

  const workingCasts = casts.filter((cast) => cast.attendances[0]?.type !== "CLOCK_OUT");

  return {
    today: today._sum.amount ?? 0,
    week: week._sum.amount ?? 0,
    month: month._sum.amount ?? 0,
    workingCasts
  };
}

async function getDriverData(userId: string) {
  const [rides, stores] = await Promise.all([
    prisma.ride.findMany({
      where: { driverId: userId },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { store: true }
    }),
    prisma.store.findMany({ orderBy: { name: "asc" } })
  ]);

  return { rides, stores };
}

export default async function DashboardPage() {
  const session = await getCurrentSession();

  if (!session) {
    return null;
  }

  if (session.user.role === "OWNER") {
    let data;
    try {
      data = await getOwnerData();
    } catch (error) {
      console.error("[dashboard] owner view", error);
      return (
        <Card className="border-red-900/40 bg-red-950/30 text-sm text-red-100">
          <CardHeader>
            <CardTitle>データ取得に失敗しました</CardTitle>
            <CardDescription>時間をおいて再度お試しください。</CardDescription>
          </CardHeader>
          <CardContent>
            <p>売上・出勤情報を読み込めませんでした。</p>
          </CardContent>
        </Card>
      );
    }
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold text-pink-300">オーナーダッシュボード</h1>
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>本日の売上</CardTitle>
              <CardDescription>{format(new Date(), "PPP", { locale: ja })}</CardDescription>
            </CardHeader>
            <CardContent className="text-3xl font-bold text-pink-400">
              {formatCurrency(data.today)}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>今週の売上</CardTitle>
              <CardDescription>月曜始まり</CardDescription>
            </CardHeader>
            <CardContent className="text-3xl font-bold text-pink-400">
              {formatCurrency(data.week)}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>今月の売上</CardTitle>
              <CardDescription>{format(new Date(), "LLLL", { locale: ja })}</CardDescription>
            </CardHeader>
            <CardContent className="text-3xl font-bold text-pink-400">
              {formatCurrency(data.month)}
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>出勤中のキャスト</CardTitle>
            <CardDescription>最新の勤怠イベントから推定</CardDescription>
          </CardHeader>
          <CardContent>
            {data.workingCasts.length === 0 ? (
              <p className="text-sm text-slate-400">現在出勤中のキャストはいません。</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {data.workingCasts.map((cast) => (
                  <li key={cast.id} className="flex items-center justify-between rounded-md bg-slate-900/60 px-4 py-3">
                    <span className="font-medium text-pink-200">{cast.displayName}</span>
                    <span className="text-xs text-slate-400">{cast.store?.name ?? "所属なし"}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (session.user.role === "ADMIN" && session.user.storeId) {
    let data;
    try {
      data = await getAdminData(session.user.storeId);
    } catch (error) {
      console.error("[dashboard] admin view", error);
      return (
        <Card className="border-red-900/40 bg-red-950/30 text-sm text-red-100">
          <CardHeader>
            <CardTitle>データ取得に失敗しました</CardTitle>
            <CardDescription>時間をおいて再度お試しください。</CardDescription>
          </CardHeader>
          <CardContent>
            <p>売上・出勤情報を読み込めませんでした。</p>
          </CardContent>
        </Card>
      );
    }
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold text-pink-300">店舗ダッシュボード</h1>
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>本日の売上</CardTitle>
            </CardHeader>
            <CardContent className="text-3xl font-bold text-pink-400">
              {formatCurrency(data.today)}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>今週の売上</CardTitle>
            </CardHeader>
            <CardContent className="text-3xl font-bold text-pink-400">
              {formatCurrency(data.week)}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>今月の売上</CardTitle>
            </CardHeader>
            <CardContent className="text-3xl font-bold text-pink-400">
              {formatCurrency(data.month)}
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>出勤中のキャスト</CardTitle>
          </CardHeader>
          <CardContent>
            {data.workingCasts.length === 0 ? (
              <p className="text-sm text-slate-400">現在出勤中のキャストはいません。</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {data.workingCasts.map((cast) => (
                  <li key={cast.id} className="flex items-center justify-between rounded-md bg-slate-900/60 px-4 py-3">
                    <span className="font-medium text-pink-200">{cast.displayName}</span>
                    <span className="text-xs text-slate-400">最新: {cast.attendances[0]?.type}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (session.user.role === "DRIVER") {
    let data;
    try {
      data = await getDriverData(session.user.id);
    } catch (error) {
      console.error("[dashboard] driver view", error);
      return (
        <Card className="border-red-900/40 bg-red-950/30 text-sm text-red-100">
          <CardHeader>
            <CardTitle>データ取得に失敗しました</CardTitle>
            <CardDescription>時間をおいて再度お試しください。</CardDescription>
          </CardHeader>
          <CardContent>
            <p>送迎記録を読み込めませんでした。</p>
          </CardContent>
        </Card>
      );
    }
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold text-pink-300">ドライバー送迎履歴</h1>
        <Card>
          <CardHeader>
            <CardTitle>送迎記録を追加</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={createRide} className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="note">内容</Label>
                <Input id="note" name="note" required placeholder="お客様送迎メモ" />
              </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>店舗 (任意)</Label>
              <Select name="storeId" defaultValue="__none__">
                <SelectTrigger>
                  <SelectValue placeholder="店舗を選択" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">未選択</SelectItem>
                  {data.stores.map((store) => (
                    <SelectItem key={store.id} value={store.id}>
                      {store.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
              <Button type="submit" className="sm:col-span-2">
                送迎を記録
              </Button>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>最新 20 件</CardTitle>
          </CardHeader>
          <CardContent>
            {data.rides.length === 0 ? (
              <p className="text-sm text-slate-400">まだ送迎履歴がありません。</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {data.rides.map((ride) => (
                  <li key={ride.id} className="rounded-md bg-slate-900/60 px-4 py-3">
                    <p className="font-medium text-pink-200">
                      {ride.store?.name ?? "店舗未設定"}
                    </p>
                    <p className="text-xs text-slate-400">
                      {format(ride.createdAt, "PPPp", { locale: ja })}
                    </p>
                    <p className="text-sm text-slate-300">{ride.note}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-8 text-center text-sm text-slate-300">
      権限がありません。
    </div>
  );
}
