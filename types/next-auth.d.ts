import NextAuth, { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: "OWNER" | "ADMIN" | "DRIVER" | "CAST";
      storeId?: string | null;
    } & DefaultSession["user"];
  }

  interface User {
    role: "OWNER" | "ADMIN" | "DRIVER" | "CAST";
    storeId?: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: "OWNER" | "ADMIN" | "DRIVER" | "CAST";
    storeId?: string | null;
  }
}
