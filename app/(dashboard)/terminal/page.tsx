import { prisma } from "@/lib/prisma";
import { TerminalScreen } from "@/components/terminal/terminal-screen";

export const dynamic = "force-dynamic";

export default async function TerminalPage() {
  const stores = await prisma.store.findMany({
    include: {
      users: {
        where: { role: "CAST", isActive: true },
        select: { id: true, displayName: true }
      }
    }
  });

  if (stores.length === 0) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-6 text-center text-sm text-slate-300">
        利用可能な店舗がありません。管理者にお問い合わせください。
      </div>
    );
  }

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
