import { redirect } from "next/navigation";
import { addDays, formatISO, startOfDay } from "date-fns";
import { ja } from "date-fns/locale";
import { format } from "date-fns";
import { prisma } from "@/lib/prisma";
import { getCurrentSession } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";

type ReportsPageProps = {
  searchParams?: {
    date?: string;
    storeId?: string;
    castId?: string;
  };
};

export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  const session = await getCurrentSession();

  if (!session || !["OWNER", "ADMIN"].includes(session.user.role)) {
    redirect("/dashboard");
  }

  const stores = await prisma.store.findMany({ orderBy: { name: "asc" } });

  const dateParam = searchParams?.date ?? formatISO(new Date(), { representation: "date" });
  const selectedDate = new Date(dateParam);
  const start = startOfDay(selectedDate);
  const end = addDays(start, 1);

  const selectedStoreId =
    session.user.role === "ADMIN" ? session.user.storeId ?? undefined : searchParams?.storeId;

  const casts = await prisma.user.findMany({
    where: {
      role: "CAST",
      isActive: true,
      ...(selectedStoreId ? { storeId: selectedStoreId } : {}),
      ...(session.user.role === "ADMIN" && session.user.storeId
        ? { storeId: session.user.storeId }
        : {})
    },
    orderBy: { displayName: "asc" }
  });

  const selectedCastId = searchParams?.castId && casts.some((c) => c.id === searchParams.castId)
    ? searchParams.castId
    : undefined;

  const [attendances, sales] = await Promise.all([
    prisma.attendance.findMany({
      where: {
        timestamp: { gte: start, lt: end },
        ...(selectedStoreId ? { storeId: selectedStoreId } : {}),
        ...(selectedCastId ? { userId: selectedCastId } : {})
      },
      include: { user: true, store: true },
      orderBy: { timestamp: "desc" }
    }),
    prisma.sale.findMany({
      where: {
        createdAt: { gte: start, lt: end },
        ...(selectedStoreId ? { storeId: selectedStoreId } : {}),
        ...(selectedCastId ? { userId: selectedCastId } : {})
      },
      include: { user: true, store: true },
      orderBy: { createdAt: "desc" }
    })
  ]);

  const salesTotal = sales.reduce((sum, sale) => sum + sale.amount, 0);

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold text-pink-300">レポート</h1>
      <Card>
        <CardHeader>
          <CardTitle>フィルター</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 sm:grid-cols-3" method="get">
            <div className="space-y-2">
              <Label htmlFor="date">日付</Label>
              <Input id="date" name="date" type="date" defaultValue={formatISO(start, { representation: "date" })} />
            </div>
            <div className="space-y-2">
              <Label>店舗</Label>
              <Select name="storeId" defaultValue={selectedStoreId ?? ""}>
                <SelectTrigger>
                  <SelectValue placeholder="全店舗" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">全店舗</SelectItem>
                  {stores
                    .filter((store) =>
                      session.user.role === "ADMIN"
                        ? store.id === session.user.storeId
                        : true
                    )
                    .map((store) => (
                      <SelectItem key={store.id} value={store.id}>
                        {store.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>キャスト</Label>
              <Select name="castId" defaultValue={selectedCastId ?? ""}>
                <SelectTrigger>
                  <SelectValue placeholder="全キャスト" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">全キャスト</SelectItem>
                  {casts.map((cast) => (
                    <SelectItem key={cast.id} value={cast.id}>
                      {cast.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <button type="submit" className="hidden" />
          </form>
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>勤怠一覧</CardTitle>
          </CardHeader>
          <CardContent>
            {attendances.length === 0 ? (
              <p className="text-sm text-slate-400">勤怠記録がありません。</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {attendances.map((attendance) => (
                  <li key={attendance.id} className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
                    <p className="font-semibold text-pink-200">{attendance.user.displayName}</p>
                    <p className="text-xs text-slate-400">{attendance.store?.name ?? "店舗不明"}</p>
                    <p className="text-xs text-slate-500">
                      {format(attendance.timestamp, "PPPp", { locale: ja })} / {attendance.type}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>売上一覧 (合計: {formatCurrency(salesTotal)})</CardTitle>
          </CardHeader>
          <CardContent>
            {sales.length === 0 ? (
              <p className="text-sm text-slate-400">売上記録がありません。</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {sales.map((sale) => (
                  <li key={sale.id} className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
                    <p className="font-semibold text-pink-200">{sale.user.displayName}</p>
                    <p className="text-xs text-slate-400">{sale.store?.name ?? "店舗不明"}</p>
                    <p className="text-xs text-slate-500">
                      {format(sale.createdAt, "PPPp", { locale: ja })} / 区分: {sale.category}
                    </p>
                    <p className="text-sm text-slate-200">金額: {formatCurrency(sale.amount)}</p>
                    <p className="text-xs text-slate-500">卓番: {sale.tableNumber || "-"}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
