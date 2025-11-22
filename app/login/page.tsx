import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/session";
import { LoginForm } from "@/components/login-form";

export const metadata = {
  title: "ログイン | Sakurapps"
};

export default async function LoginPage() {
  const session = await getCurrentSession();
  if (session) {
    redirect("/dashboard");
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/80 p-8 shadow-xl">
        <h1 className="mb-6 text-center text-2xl font-semibold text-pink-400">Sakurapps v2</h1>
        <LoginForm />
      </div>
    </main>
  );
}
