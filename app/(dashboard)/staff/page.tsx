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

function generateUsername(displayName: string): string {
  const base = displayName.trim().toLowerCase().replace(/[^a-z0-9]/g, "") || "user";
  return `${base}_${Date.now().toString(36)}`;
}

async function createCast(formData: FormData) {
  "use server";
  const session = await getCurrentSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.user.role)) redirect("/dashboard");

  const displayName = formData.get("displayName");
  const storeId = formData.get("storeId");

  if (!displayName || typeof displayName !== "string" || !displayName.trim()) {
    redirect("/staff?error=" + encodeURIComponent("表示名を入力してください"));
  }

  try {
    const resolvedStoreId =
      typeof storeId === "string" && storeId.length > 0
        ? storeId
        : session.user.storeId ?? (await getOrCreateDefaultStore()).id;

    await prisma.user.create({
      data: {
        displayName: displayName.trim(),
        username: generateUsername(displayName),
        role: "CAST",
        isActive: true,
        store: { connect: { id: resolvedStoreId } }
      }
    });
  } catch (error) {
    console.error("[staff:createCast]", error);
    redirect("/staff?error=" + encodeURIComponent("キャストの作成に失敗しました"));
  }

  revalidatePath("/staff");
  redirect("/staff");
}

async function createDriver(formData: FormData) {
  "use server";
  const session = await getCurrentSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.user.role)) redirect("/dashboard");

  const displayName = formData.get("displayName");
  const storeId = formData.get("storeId");

  if (!displayName || typeof displayName !== "string" || !displayName.trim()) {
    redirect("/staff?error=" + encodeURIComponent("表示名を入力してください"));
  }

  try {
    const resolvedStoreId =
      typeof storeId === "string" && storeId.length > 0
        ? storeId
        : session.user.storeId ?? (await getOrCreateDefaultStore()).id;

    await prisma.user.create({
      data: {
        displayName: displayName.trim(),
        username: generateUsername(displayName),
        role: "DRIVER",
        isActive: true,
        store: { connect: { id: resolvedStoreId } }
      }
    });
  } catch (error) {
    console.error("[staff:createDriver]", error);
    redirect("/staff?error=" + encodeURIComponent("ドライバーの作成に失敗しました"));
  }

  revalidatePath("/staff");
  redirect("/staff");
}

async function updateStaff(formData: FormData) {
  "use server";
  const session = await getCurrentSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.user.role)) redirect("/dashboard");

  const userId = formData.get("userId");
  const displayName = formData.get("displayName");
  const storeId = formData.get("storeId");

  if (!userId || typeof userId !== "string") redirect("/staff?error=" + encodeURIComponent("ユーザーIDが不明です"));
  if (!displayName || typeof displayName !== "string" || !displayName.trim()) {
    redirect("/staff?error=" + encodeURIComponent("表示名を入力してください"));
  }

  const data: Prisma.UserUpdateInput = { displayName: displayName.trim() };

  if (typeof storeId === "string" && storeId.length > 0) {
    data.store = { connect: { id: storeId } };
  }

  try {
    await prisma.user.update({ where: { id: userId }, data });
  } catch (error) {
    console.error("[staff:updateStaff]", error);
    redirect("/staff?error=" + encodeURIComponent("スタッフ情報の更新に失敗しました"));
  }

  revalidatePath("/staff");
  redirect("/staff");
}

async function deleteStaff(formData: FormData) {
  "use server";
  const session = await getCurrentSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.user.role)) redirect("/dashboard");

  const userId = formData.get("userId");
  if (!userId || typeof userId !== "string") redirect("/staff?error=" + encodeURIComponent("ユーザーIDが不明です"));

  try {
    await prisma.user.delete({ where: { id: userId } });
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as { code: string }).code === "P2003"
    ) {
      redirect("/staff?error=" + encodeURIComponent("関連データがあるため削除できません。先に勤怠・売上データを削除してください。"));
    }
    console.error("[staff:deleteStaff]", error);
    redirect("/staff?error=" + encodeURIComponent("削除に失敗しました"));
  }

  revalidatePath("/staff");
  redirect("/staff");
}

const roleLabel: Record<string, string> = { CAST: "キャスト", DRIVER: "ドライバー" };
const roleBadge: Record<string, string> = {
  CAST: "bg-pink-900/60 text-pink-200",
  DRIVER: "bg-blue-900/60 text-blue-200"
};

export default async function StaffPage({ searchParams }: { searchParams?: { error?: string } }) {
  const session = await getCurrentSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.user.role)) redirect("/dashboard");

  const errorMessage = searchParams?.error ?? null;

  const stores = await prisma.store.findMany({ orderBy: { name: "asc" } });
  const visibleStores =
    session.user.role === "ADMIN" && session.user.storeId
      ? stores.filter((s) => s.id === session.user.storeId)
      : stores;

  const staff = await prisma.user.findMany({
    where: {
      role: { in: ["CAST", "DRIVER"] },
      ...(session.user.role === "ADMIN" && session.user.storeId
        ? { storeId: session.user.storeId }
        : {})
    },
    include: { store: true },
    orderBy: [{ role: "asc" }, { displayName: "asc" }]
  });

  const defaultStoreId =
    session.user.storeId ?? (visibleStores.length === 1 ? visibleStores[0].id : undefined);

  const multiStore = visibleStores.length > 1;

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold text-pink-300">スタッフ管理</h1>

      {errorMessage && (
        <div className="rounded-lg border border-red-800/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">
          {errorMessage}
        </div>
      )}

      {/* 追加フォーム */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* キャスト */}
        <Card className="border-pink-900/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="rounded-full bg-pink-900/60 px-2.5 py-0.5 text-sm text-pink-200">キャスト</span>
              追加
            </CardTitle>
            <CardDescription>端末のスタッフ選択から出退勤します。</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={createCast} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="cast-name">表示名</Label>
                <Input id="cast-name" name="displayName" required placeholder="さくら" />
              </div>
              {multiStore && (
                <div className="space-y-2">
                  <Label>所属店舗</Label>
                  <Select name="storeId" defaultValue={defaultStoreId}>
                    <SelectTrigger><SelectValue placeholder="店舗を選択" /></SelectTrigger>
                    <SelectContent>
                      {visibleStores.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <Button type="submit" className="w-full bg-pink-700 hover:bg-pink-600 text-white">
                キャストを追加
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* ドライバー */}
        <Card className="border-blue-900/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="rounded-full bg-blue-900/60 px-2.5 py-0.5 text-sm text-blue-200">ドライバー</span>
              追加
            </CardTitle>
            <CardDescription>端末から名前を選んで写真付きで出退勤します。</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={createDriver} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="driver-name">表示名</Label>
                <Input id="driver-name" name="displayName" required placeholder="田中ドライバー" />
              </div>
              {multiStore && (
                <div className="space-y-2">
                  <Label>所属店舗</Label>
                  <Select name="storeId" defaultValue={defaultStoreId}>
                    <SelectTrigger><SelectValue placeholder="店舗を選択" /></SelectTrigger>
                    <SelectContent>
                      {visibleStores.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <Button type="submit" className="w-full bg-blue-700 hover:bg-blue-600 text-white">
                ドライバーを追加
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      {/* スタッフ一覧 */}
      <Card>
        <CardHeader>
          <CardTitle>スタッフ一覧</CardTitle>
          <CardDescription>
            キャスト {staff.filter((s) => s.role === "CAST").length} 名 ／
            ドライバー {staff.filter((s) => s.role === "DRIVER").length} 名
          </CardDescription>
        </CardHeader>
        <CardContent>
          {staff.length === 0 ? (
            <p className="text-sm text-slate-400">スタッフが登録されていません。</p>
          ) : (
            <ul className="space-y-3 text-sm">
              {staff.map((member) => (
                <li key={member.id} className="rounded-lg border border-slate-800 bg-slate-900/60">
                  <div className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                      <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${roleBadge[member.role] ?? "bg-slate-700 text-slate-200"}`}>
                        {roleLabel[member.role] ?? member.role}
                      </span>
                      <div>
                        <p className="font-semibold text-pink-100">{member.displayName}</p>
                        <p className="text-xs text-slate-500">{member.store?.name ?? "店舗未設定"}</p>
                      </div>
                    </div>
                    <form action={deleteStaff} className="shrink-0">
                      <input type="hidden" name="userId" value={member.id} />
                      <Button type="submit" size="sm" variant="destructive" className="text-xs">
                        削除
                      </Button>
                    </form>
                  </div>

                  <details className="border-t border-slate-800/60">
                    <summary className="cursor-pointer px-4 py-2 text-xs text-slate-400 hover:text-slate-300">
                      編集
                    </summary>
                    <form action={updateStaff} className="flex flex-col gap-3 p-4 pt-3 md:flex-row md:flex-wrap md:items-end">
                      <input type="hidden" name="userId" value={member.id} />
                      <div className="space-y-1">
                        <Label className="text-xs text-slate-400">表示名</Label>
                        <Input name="displayName" defaultValue={member.displayName} className="md:w-48" />
                      </div>
                      {multiStore && (
                        <div className="space-y-1">
                          <Label className="text-xs text-slate-400">所属店舗</Label>
                          <Select name="storeId" defaultValue={member.storeId ?? undefined}>
                            <SelectTrigger className="md:w-40"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {visibleStores.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                      <Button type="submit" size="sm" variant="secondary" className="md:self-end">
                        保存
                      </Button>
                    </form>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
