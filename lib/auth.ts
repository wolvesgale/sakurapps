import { prisma } from "@/lib/prisma";
import { compare, hash } from "bcryptjs";
import type { NextAuthOptions, User as NextAuthUser } from "next-auth";
import type { AdapterUser } from "next-auth/adapters";
import Credentials from "next-auth/providers/credentials";

type AuthorizeUser = NextAuthUser & {
  role: "OWNER" | "ADMIN" | "DRIVER" | "CAST";
  storeId?: string | null;
};

const isAuthorizeUser = (user: NextAuthUser | AdapterUser): user is AuthorizeUser =>
  "role" in user;

export const authOptions: NextAuthOptions = {
  pages: {
    signIn: "/login"
  },
  session: {
    strategy: "jwt"
  },
  providers: [
    Credentials({
      name: "Credentials",
      credentials: {
        username: { label: "ユーザーID", type: "text" },
        password: { label: "パスワード", type: "password" }
      },
      async authorize(credentials) {
        const username = credentials?.username?.trim();
        if (!username || !credentials?.password) {
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { username }
        });

        if (!user || !user.isActive) {
          return null;
        }

        const isValid = await compare(credentials.password, user.passwordHash ?? "");

        if (!isValid) {
          return null;
        }

        const authorizedUser: AuthorizeUser = {
          id: user.id,
          email: user.email,
          name: user.displayName,
          role: user.role,
          storeId: user.storeId
        };

        return authorizedUser;
      }
    })
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user && isAuthorizeUser(user)) {
        token.id = user.id;
        token.role = user.role;
        token.storeId = user.storeId ?? null;
        token.name = user.name;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.role = token.role;
        session.user.storeId = token.storeId ?? null;
        if (token.name) {
          session.user.name = token.name;
        }
      }
      return session;
    }
  }
};

export async function hashPassword(password: string) {
  return hash(password, 10);
}

export function isStrongPassword(password: string) {
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  return password.length >= 8 && hasUpper && hasLower && hasNumber;
}
