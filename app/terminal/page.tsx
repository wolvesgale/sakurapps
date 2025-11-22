import { prisma } from "@/lib/prisma";
import { TerminalScreen } from "@/components/terminal/terminal-screen";

export const dynamic = "force-dynamic";

export default async function TerminalPage({
  searchParams
}: {
  searchParams?: { storeId?: string; terminalId?: string };
}) {
  const stores = await prisma.store.findMany({
    include: {
      users: {
        where: { role: "CAST", isActive: true },
        select: { id: true, displayName: true }
      }
    }
  });

  const defaultStoreId = searchParams?.storeId ?? stores[0]?.id ?? null;

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
      defaultStoreId={defaultStoreId}
      defaultTerminalId={searchParams?.terminalId ?? null}
    />
  );
}
