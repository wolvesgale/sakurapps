import { prisma } from "@/lib/prisma";
import { compare } from "bcryptjs";
import type { NextAuthOptions } from "next-auth";
import Credentials from "next-auth/providers/credentials";

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
        email: { label: "Email", type: "text" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials.password) {
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { email: credentials.email.toLowerCase() }
        });

        if (!user || !user.isActive) {
          return null;
        }

        const isValid = await compare(credentials.password, user.passwordHash ?? "");

        if (!isValid) {
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          name: user.displayName,
          role: user.role,
          storeId: user.storeId
        } as any;
      }
    })
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as any).role;
        token.storeId = (user as any).storeId ?? null;
        token.name = user.name;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as any;
        session.user.storeId = (token.storeId as string | null) ?? null;
        if (token.name) {
          session.user.name = token.name as string;
        }
      }
      return session;
    }
  }
};
