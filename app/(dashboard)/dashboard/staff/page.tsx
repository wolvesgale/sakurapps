import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentSession } from "@/lib/session";
import { hashPassword, isStrongPassword } from "@/lib/auth";
import { getOrCreateDefaultStore } from "@/lib/store";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const dynamic = "force-dynamic";

const allowedRoles: Prisma.UserCreateInput["role"][] = ["CAST", "DRIVER"];

async function createStaff(formData: FormData) {
  "use server";
  const session = await getCurrentSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.user.role)) {
    throw new Error("Unauthorized");
  }

  const displayName = formData.get("displayName");
  const username = formData.get("username");
  const email = formData.get("email");
  const password = formData.get("password");
  const role = formData.get("role");
  const storeId = formData.get("storeId");

  if (!displayName || typeof displayName !== "string") {
    throw new Error("表示名を入力してください");
  }

  if (!role || typeof role !== "string") {
    throw new Error("ロールを選択してください");
  }

  const selectedRole = role as Prisma.UserCreateInput["role"];

  if (!allowedRoles.includes(selectedRole)) {
    throw new Error("ロールを選択してください");
  }

  if (!username || typeof username !== "string" || username.trim().length === 0) {
    throw new Error("ユーザーIDを入力してください");
  }

  const normalizedUsername = username.trim();

  const defaultStore = await getOrCreateDefaultStore();

  const resolvedStoreId: string | null =
    typeof storeId === "string" && storeId.length > 0
      ? storeId
      : session.user.storeId ?? defaultStore.id;

  const requiresStoreAssociation = selectedRole !== "OWNER" && selectedRole !== "ADMIN";

  if (requiresStoreAssociation && !resolvedStoreId) {
    throw new Error("店舗を選択してください");
  }

  const normalizedEmail =
    typeof email === "string" && email.length > 0 ? email.toLowerCase() : null;

  const rawPassword = typeof password === "string" ? password : "";

  if (selectedRole !== "CAST" && !normalizedEmail) {
    throw new Error("メールアドレスを入力してください");
  }

  const data: Prisma.UserCreateInput = {
    displayName,
    username: normalizedUsername,
    role: selectedRole,
    isActive: true,
    ...(resolvedStoreId && selectedRole !== "OWNER"
      ? {
          store: {
            connect: { id: resolvedStoreId }
          }
        }
      : {}),
    ...(normalizedEmail ? { email: normalizedEmail } : {})
  };

  if (selectedRole === "CAST") {
    if (rawPassword.length > 0) {
      if (!isStrongPassword(rawPassword)) {
        throw new Error("8文字以上・大文字・小文字・数字を含むパスワードを設定してください");
      }
      data.passwordHash = await hashPassword(rawPassword);
    }
  } else {
    if (rawPassword.length === 0) {
      throw new Error("パスワードを入力してください");
    }
    if (!isStrongPassword(rawPassword)) {
      throw new Error("8文字以上・大文字・小文字・数字を含むパスワードを設定してください");
    }
    data.passwordHash = await hashPassword(rawPassword);
  }

  await prisma.user.create({
    data
  });

  revalidatePath("/dashboard/staff");
}

export default async function StaffPage() {
  const session = await getCurrentSession();

  if (!session || !["OWNER", "ADMIN"].includes(session.user.role)) {
    redirect("/dashboard");
  }

  const defaultStore = await getOrCreateDefaultStore();

  const stores = await prisma.store.findMany({
    orderBy: { name: "asc" }
  });

  const visibleStores =
    session.user.role === "ADMIN" && session.user.storeId
      ? stores.filter((store) => store.id === session.user.storeId)
      : stores.length > 0
        ? stores
        : [defaultStore];

  const staff = await prisma.user.findMany({
    where: {
      role: { in: ["CAST", "DRIVER"] },
      ...(session.user.role === "ADMIN" && session.user.storeId
        ? { storeId: session.user.storeId }
        : {})
    },
    include: { store: true },
    orderBy: { displayName: "asc" }
  });

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold text-pink-300">スタッフ管理</h1>
      <Card>
        <CardHeader>
          <CardTitle>スタッフ追加</CardTitle>
          <CardDescription>キャストは端末で PIN なし打刻、勤怠確定はオーナー承認で行います。</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={createStaff} className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="displayName">表示名</Label>
              <Input id="displayName" name="displayName" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="username">ユーザーID</Label>
              <Input
                id="username"
                name="username"
                required
                placeholder="staff01"
                autoComplete="username"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">メール (ドライバーは必須)</Label>
              <Input id="email" name="email" type="email" placeholder="login@example.com" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">パスワード (ドライバーは必須)</Label>
              <Input
                id="password"
                name="password"
                type="password"
                placeholder="ドライバーは強力なパスワードを設定してください"
              />
            </div>
            <div className="space-y-2">
              <Label>ロール</Label>
              <Select name="role" defaultValue="CAST">
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CAST">キャスト</SelectItem>
                  <SelectItem value="DRIVER">ドライバー</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <input type="hidden" name="storeId" value={visibleStores[0]?.id ?? defaultStore.id} />
            <div className="space-y-2">
              <Label>所属店舗</Label>
              <div className="rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-200">
                {visibleStores[0]?.name ?? defaultStore.name}
              </div>
              <p className="text-xs text-slate-500">Nest SAKURA 専用のため店舗選択は固定です。</p>
            </div>
            <Button type="submit" className="sm:col-span-2">
              スタッフを作成
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>スタッフ一覧</CardTitle>
          <CardDescription>有効/無効の切り替えは今後実装予定です。</CardDescription>
        </CardHeader>
        <CardContent>
          {staff.length === 0 ? (
            <p className="text-sm text-slate-400">スタッフが登録されていません。</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {staff.map((member) => (
                <li key={member.id} className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
                  <p className="text-lg font-semibold text-pink-200">{member.displayName}</p>
                  <p className="text-xs text-slate-400">ユーザーID: {member.username}</p>
                  <p className="text-xs text-slate-400">ロール: {member.role}</p>
                  <p className="text-xs text-slate-400">店舗: {member.store?.name ?? "未設定"}</p>
                  <p className="text-xs text-slate-500">
                    メール: {member.email ?? "未登録"} / 状態: {member.isActive ? "有効" : "停止"}
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
