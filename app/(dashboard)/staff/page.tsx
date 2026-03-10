import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { hash } from "bcryptjs";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentSession } from "@/lib/session";
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
  if (!session || !["OWNER", "ADMIN"].includes(session.user.role)) throw new Error("Unauthorized");

  const displayName = formData.get("displayName");
  const pin = formData.get("pin");
  const storeId = formData.get("storeId");

  if (!displayName || typeof displayName !== "string" || !displayName.trim()) {
    throw new Error("表示名を入力してください");
  }
  if (!pin || typeof pin !== "string" || pin.length < 4) {
    throw new Error("PIN を4桁以上で入力してください");
  }

  const resolvedStoreId =
    typeof storeId === "string" && storeId.length > 0 ? storeId : session.user.storeId ?? null;
  if (!resolvedStoreId) throw new Error("店舗を選択してください");

  await prisma.user.create({
    data: {
      displayName: displayName.trim(),
      username: generateUsername(displayName),
      role: "CAST",
      isActive: true,
      castPinHash: await hash(pin, 10),
      store: { connect: { id: resolvedStoreId } }
    }
  });

  revalidatePath("/staff");
}

async function createDriver(formData: FormData) {
  "use server";
  const session = await getCurrentSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.user.role)) throw new Error("Unauthorized");

  const displayName = formData.get("displayName");
  const storeId = formData.get("storeId");

  if (!displayName || typeof displayName !== "string" || !displayName.trim()) {
    throw new Error("表示名を入力してください");
  }

  const resolvedStoreId =
    typeof storeId === "string" && storeId.length > 0 ? storeId : session.user.storeId ?? null;
  if (!resolvedStoreId) throw new Error("店舗を選択してください");

  await prisma.user.create({
    data: {
      displayName: displayName.trim(),
      username: generateUsername(displayName),
      role: "DRIVER",
      isActive: true,
      store: { connect: { id: resolvedStoreId } }
    }
  });

  revalidatePath("/staff");
}

async function updateStaff(formData: FormData) {
  "use server";
  const session = await getCurrentSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.user.role)) throw new Error("Unauthorized");

  const userId = formData.get("userId");
  const displayName = formData.get("displayName");
  const pin = formData.get("pin");
  const storeId = formData.get("storeId");

  if (!userId || typeof userId !== "string") throw new Error("ユーザーIDが不明です");
  if (!displayName || typeof displayName !== "string" || !displayName.trim()) {
    throw new Error("表示名を入力してください");
  }

  const data: Prisma.UserUpdateInput = { displayName: displayName.trim() };

  if (typeof storeId === "string" && storeId.length > 0) {
    data.store = { connect: { id: storeId } };
  }

  if (typeof pin === "string" && pin.length >= 4) {
    data.castPinHash = await hash(pin, 10);
  }

  await prisma.user.update({ where: { id: userId }, data });
  revalidatePath("/staff");
}

async function deleteStaff(formData: FormData) {
  "use server";
  const session = await getCurrentSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.user.role)) throw new Error("Unauthorized");

  const userId = formData.get("userId");
  if (!userId || typeof userId !== "string") throw new Error("ユーザーIDが不明です");

  await prisma.user.delete({ where: { id: userId } });
  revalidatePath("/staff");
}

const roleLabel: Record<string, string> = { CAST: "キャスト", DRIVER: "ドライバー" };
const roleBadge: Record<string, string> = {
  CAST: "bg-pink-900/60 text-pink-200",
  DRIVER: "bg-blue-900/60 text-blue-200"
};

export default async function StaffPage() {
  const session = await getCurrentSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.user.role)) redirect("/dashboard");

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

      {/* 追加フォーム */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* キャスト */}
        <Card className="border-pink-900/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="rounded-full bg-pink-900/60 px-2.5 py-0.5 text-sm text-pink-200">キャスト</span>
              追加
            </CardTitle>
            <CardDescription>端末から PIN で出退勤します。</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={createCast} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="cast-name">表示名</Label>
                <Input id="cast-name" name="displayName" required placeholder="さくら" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cast-pin">PIN（4〜8桁）</Label>
                <Input id="cast-pin" name="pin" type="password" placeholder="1234" maxLength={8} required autoComplete="new-password" />
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
                  {/* ヘッダー行 */}
                  <div className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                      <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${roleBadge[member.role] ?? "bg-slate-700 text-slate-200"}`}>
                        {roleLabel[member.role] ?? member.role}
                      </span>
                      <div>
                        <p className="font-semibold text-pink-100">{member.displayName}</p>
                        <p className="text-xs text-slate-500">
                          {member.store?.name ?? "店舗未設定"}
                          {member.role === "CAST" && (
                            <span className="ml-2">{member.castPinHash ? "・PIN設定済" : "・PIN未設定"}</span>
                          )}
                        </p>
                      </div>
                    </div>
                    {/* 削除ボタン */}
                    <form action={deleteStaff} className="shrink-0">
                      <input type="hidden" name="userId" value={member.id} />
                      <Button type="submit" size="sm" variant="destructive"
                        onClick={undefined}
                        className="text-xs">
                        削除
                      </Button>
                    </form>
                  </div>

                  {/* 編集フォーム（折りたたみ） */}
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
                      {member.role === "CAST" && (
                        <div className="space-y-1">
                          <Label className="text-xs text-slate-400">PIN 変更（空白で変更なし）</Label>
                          <Input name="pin" type="password" placeholder="新しいPIN" maxLength={8} autoComplete="new-password" className="md:w-36" />
                        </div>
                      )}
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
