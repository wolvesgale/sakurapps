import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
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

  const normalizedEmail = typeof email === "string" && email.length > 0 ? email.toLowerCase() : null;

  const rawPassword = typeof password === "string" ? password : "";

  if (selectedRole !== "CAST" && !normalizedEmail) {
    throw new Error("メールアドレスを入力してください");
  }

  const storeRelation =
    defaultStore.id && !defaultStore.id.startsWith("dev-")
      ? {
          store: {
            connect: { id: defaultStore.id }
          }
        }
      : {};

  const data: Prisma.UserCreateInput = {
    displayName,
    username: normalizedUsername,
    role: selectedRole,
    isActive: true,
    ...(selectedRole !== "OWNER" && selectedRole !== "ADMIN" ? storeRelation : {}),
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

  try {
    await prisma.user.create({
      data
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const message =
        "このユーザーIDは既に使用されています。別のIDを入力してください。";
      redirect(`/dashboard/staff?error=${encodeURIComponent(message)}`);
    }

    console.error("[staff:create]", error);
    throw new Error("スタッフ作成に失敗しました。入力内容を確認してください。");
  }

  revalidatePath("/dashboard/staff");
  redirect("/dashboard/staff");
}

async function updateStaff(formData: FormData) {
  "use server";
  const session = await getCurrentSession();

  if (!session || !["OWNER", "ADMIN"].includes(session.user.role)) {
    throw new Error("Unauthorized");
  }

  const staffId = formData.get("staffId");
  const displayName = formData.get("displayName");
  const email = formData.get("email");
  const role = formData.get("role");
  const isActive = formData.get("isActive");

  if (!staffId || typeof staffId !== "string") {
    redirect(`/dashboard/staff?error=${encodeURIComponent("スタッフIDが不明です。")}`);
  }

  if (!displayName || typeof displayName !== "string" || displayName.trim().length === 0) {
    redirect(`/dashboard/staff?error=${encodeURIComponent("表示名を入力してください。")}`);
  }

  if (!role || typeof role !== "string") {
    redirect(`/dashboard/staff?error=${encodeURIComponent("ロールを選択してください。")}`);
  }

  const normalizedEmail =
    typeof email === "string" && email.length > 0 ? email.toLowerCase() : null;

  try {
    await prisma.user.update({
      where: { id: staffId },
      data: {
        displayName: displayName.trim(),
        role: role as Prisma.UserUpdateInput["role"],
        isActive: Boolean(isActive),
        ...(normalizedEmail ? { email: normalizedEmail } : { email: null })
      }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const message = "このメールアドレスは既に使用されています。別のメールを入力してください。";
      redirect(`/dashboard/staff?error=${encodeURIComponent(message)}`);
    }

    console.error("[staff:update]", error);
    redirect(`/dashboard/staff?error=${encodeURIComponent("スタッフ更新に失敗しました。")}`);
  }

  revalidatePath("/dashboard/staff");
  redirect("/dashboard/staff");
}

async function deleteStaff(formData: FormData) {
  "use server";
  const session = await getCurrentSession();

  if (!session || !["OWNER", "ADMIN"].includes(session.user.role)) {
    throw new Error("Unauthorized");
  }

  const staffId = formData.get("staffId");

  if (!staffId || typeof staffId !== "string") {
    redirect(`/dashboard/staff?error=${encodeURIComponent("スタッフIDが不明です。")}`);
  }

  try {
    await prisma.user.delete({
      where: { id: staffId }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      try {
        await prisma.user.update({
          where: { id: staffId },
          data: { isActive: false }
        });
        const message = "関連データがあるため削除できませんでした。代わりに無効化しました。";
        redirect(`/dashboard/staff?error=${encodeURIComponent(message)}`);
      } catch (secondaryError) {
        console.error("[staff:disable-fallback]", secondaryError);
      }
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      redirect(`/dashboard/staff?error=${encodeURIComponent("スタッフが見つかりませんでした。")}`);
    }

    console.error("[staff:delete]", error);
    redirect(`/dashboard/staff?error=${encodeURIComponent("スタッフ削除に失敗しました。")}`);
  }

  revalidatePath("/dashboard/staff");
  redirect("/dashboard/staff");
}

type StaffPageProps = {
  searchParams?: {
    error?: string;
    message?: string;
  };
};

export default async function StaffPage({ searchParams }: StaffPageProps) {
  const session = await getCurrentSession();

  if (!session || !["OWNER", "ADMIN"].includes(session.user.role)) {
    redirect("/dashboard");
  }

  const errorMessage = searchParams?.error ?? null;
  const infoMessage = searchParams?.message ?? null;

  const defaultStore = await getOrCreateDefaultStore();

  type StaffWithStore = Prisma.UserGetPayload<{ include: { store: true } }>;
  let staff: StaffWithStore[] = [];

  try {
    staff = await prisma.user.findMany({
      where: {
        role: { in: ["CAST", "DRIVER"] },
        ...(session.user.role === "ADMIN" && session.user.storeId
          ? { storeId: session.user.storeId }
          : {})
      },
      include: { store: true },
      orderBy: { displayName: "asc" }
    });
  } catch (error) {
    console.error("[staff:list]", error);
    staff = [];
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold text-pink-300">スタッフ管理</h1>
        <p className="text-xs text-slate-400">店舗は {defaultStore.name} 固定です。</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>スタッフ追加</CardTitle>
          <CardDescription>
            キャストは端末で PIN なし打刻、勤怠確定はオーナー承認で行います。店舗は Nest SAKURA 固定です。
          </CardDescription>
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
                  <SelectValue placeholder="ロールを選択" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CAST">キャスト</SelectItem>
                  <SelectItem value="DRIVER">ドライバー</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs text-slate-400 sm:col-span-2">
              店舗選択は Nest SAKURA 固定です。マルチ店舗運用は現在無効化しています。
            </div>
            {errorMessage && (
              <p className="sm:col-span-2 text-sm text-red-400">{errorMessage}</p>
            )}
            {infoMessage && !errorMessage ? (
              <p className="sm:col-span-2 text-sm text-green-400">{infoMessage}</p>
            ) : null}
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
                <li key={member.id} className="space-y-3 rounded-lg border border-slate-800 bg-slate-900/60 p-4">
                  <div className="flex flex-col gap-1">
                    <p className="text-lg font-semibold text-pink-200">{member.displayName}</p>
                    <p className="text-xs text-slate-400">ユーザーID: {member.username}</p>
                    <p className="text-xs text-slate-400">店舗: {member.store?.name ?? "未設定"}</p>
                    <p className="text-xs text-slate-500">
                      メール: {member.email ?? "未登録"} / 状態: {member.isActive ? "有効" : "停止"}
                    </p>
                  </div>
                  <form action={updateStaff} className="grid gap-3 sm:grid-cols-2">
                    <input type="hidden" name="staffId" value={member.id} />
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-300">表示名</Label>
                      <Input name="displayName" defaultValue={member.displayName} required />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-300">メール</Label>
                      <Input name="email" type="email" defaultValue={member.email ?? ""} placeholder="login@example.com" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-300">ロール</Label>
                      <Select name="role" defaultValue={member.role}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="CAST">キャスト</SelectItem>
                          <SelectItem value="DRIVER">ドライバー</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center gap-2 pt-5">
                      <input
                        id={`active-${member.id}`}
                        name="isActive"
                        type="checkbox"
                        defaultChecked={member.isActive}
                        className="h-4 w-4 rounded border border-slate-700 bg-black text-pink-400 focus-visible:outline-none"
                      />
                      <Label htmlFor={`active-${member.id}`} className="text-xs text-slate-300">
                        有効
                      </Label>
                    </div>
                    <div className="flex flex-wrap gap-2 sm:col-span-2">
                      <Button type="submit" size="sm">
                        更新
                      </Button>
                    </div>
                  </form>
                  <form action={deleteStaff} className="flex flex-wrap gap-2">
                    <input type="hidden" name="staffId" value={member.id} />
                    <Button type="submit" size="sm" variant="destructive">
                      削除
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
