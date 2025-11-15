import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentSession } from "@/lib/session";
import { TerminalScreen } from "@/components/terminal/terminal-screen";

export const dynamic = "force-dynamic";

export default async function TerminalPage() {
  const session = await getCurrentSession();

  if (!session || !["OWNER", "ADMIN"].includes(session.user.role)) {
    redirect("/dashboard");
  }

  if (session.user.role === "ADMIN") {
    if (!session.user.storeId) {
      return (
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-6 text-sm text-slate-300">
          店舗が設定されていません。
        </div>
      );
    }

    const store = await prisma.store.findUnique({
      where: { id: session.user.storeId },
      include: {
        users: {
          where: { role: "CAST", isActive: true },
          select: { id: true, displayName: true }
        }
      }
    });

    if (!store) {
      return (
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-6 text-sm text-slate-300">
          店舗情報が見つかりません。
        </div>
      );
    }

    return (
      <TerminalScreen
        stores={[
          {
            id: store.id,
            name: store.name,
            openingTime: store.openingTime,
            closingTime: store.closingTime,
            casts: store.users
          }
        ]}
        defaultStoreId={store.id}
      />
    );
  }

  const stores = await prisma.store.findMany({
    include: {
      users: {
        where: { role: "CAST", isActive: true },
        select: { id: true, displayName: true }
      }
    }
  });

  return (
    <TerminalScreen
      stores={stores.map((store) => ({
        id: store.id,
        name: store.name,
        openingTime: store.openingTime,
        closingTime: store.closingTime,
        casts: store.users
      }))}
    />
  );
}
