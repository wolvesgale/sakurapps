import { redirect } from "next/navigation";
import { ReactNode } from "react";
import { getCurrentSession } from "@/lib/session";
import { AppHeader } from "@/components/layout/app-header";

export default async function DashboardLayout({
  children
}: {
  children: ReactNode;
}) {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <AppHeader />
      <main className="mx-auto w-full max-w-6xl px-6 py-10">{children}</main>
    </div>
  );
}
