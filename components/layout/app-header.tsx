"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const links = [
  { href: "/dashboard", label: "ダッシュボード" },
  { href: "/dashboard/staff", label: "スタッフ" },
  { href: "/dashboard/attendance", label: "勤怠管理" },
  { href: "/dashboard/reports", label: "レポート" },
  { href: "/dashboard/terminal-mgmt", label: "端末管理" }
];

export function AppHeader() {
  const pathname = usePathname();
  const { data } = useSession();
  const role = data?.user?.role;

  return (
    <header className="border-b border-slate-800 bg-slate-950/90">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-6 text-sm font-medium">
          <Link href="/dashboard" className="text-lg font-semibold text-pink-400">
            Sakurapps v2
          </Link>
          <nav className="flex items-center gap-4 text-slate-300">
            {links
              .filter((link) => {
                if (link.href === "/dashboard/stores" && !["OWNER", "ADMIN"].includes(role ?? ""))
                  return false;
                if (link.href === "/dashboard/staff" && role === "DRIVER") return false;
                if (link.href === "/dashboard/reports" && role === "DRIVER") return false;
                if (link.href === "/dashboard/terminal-mgmt" && role === "DRIVER") return false;
                if (link.href === "/dashboard/terminal-mgmt" && role === "CAST") return false;
                return true;
              })
              .map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "transition-colors hover:text-pink-300",
                    pathname.startsWith(link.href) ? "text-pink-400" : "text-slate-400"
                  )}
                >
                  {link.label}
                </Link>
              ))}
          </nav>
        </div>
        <div className="flex items-center gap-3 text-sm text-slate-200">
          <div className="text-right">
            <p className="font-semibold">{data?.user?.name ?? ""}</p>
            <p className="text-xs uppercase text-slate-400">{role}</p>
          </div>
          <Link href="/terminal" className="hidden sm:inline-block">
            <Button variant="secondary" size="sm">
              店舗端末画面へ
            </Button>
          </Link>
          <Button variant="ghost" size="sm" onClick={() => signOut({ callbackUrl: "/login" })}>
            ログアウト
          </Button>
        </div>
      </div>
    </header>
  );
}
