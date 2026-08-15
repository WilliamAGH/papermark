import { PrismaAdapter } from "@next-auth/prisma-adapter";
import bcrypt from "bcryptjs";
import NextAuth, { type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";

const secureCookies = process.env.NEXTAUTH_URL?.startsWith("https://") ?? false;

function getAdminCredentials() {
  const email = process.env.AUTH_ADMIN_EMAIL?.trim().toLowerCase();
  const passwordHash = process.env.AUTH_ADMIN_PASSWORD_HASH;

  if (!email || !passwordHash) {
    throw new Error(
      "AUTH_ADMIN_EMAIL and AUTH_ADMIN_PASSWORD_HASH must be configured",
    );
  }

  return { email, passwordHash };
}

export const config = {
  maxDuration: 180,
};

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  pages: {
    error: "/login",
    signIn: "/login",
  },
  providers: [
    CredentialsProvider({
      name: "Administrator credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials.password) {
          return null;
        }

        const { email: adminEmail, passwordHash } = getAdminCredentials();
        const email = credentials.email.trim().toLowerCase();
        const passwordMatches = await bcrypt.compare(
          credentials.password,
          passwordHash,
        );

        if (email !== adminEmail || !passwordMatches) {
          return null;
        }

        const user = await prisma.user.upsert({
          where: { email: adminEmail },
          create: {
            email: adminEmail,
            emailVerified: new Date(),
            name: "Administrator",
          },
          update: {
            emailVerified: new Date(),
          },
        });

        await prisma.team.updateMany({
          where: {
            users: {
              some: {
                userId: user.id,
                role: "ADMIN",
              },
            },
          },
          data: {
            plan: "business",
          },
        });

        return user;
      },
    }),
  ],
  session: { strategy: "jwt" },
  cookies: {
    sessionToken: {
      name: `${secureCookies ? "__Secure-" : ""}next-auth.session-token`,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: secureCookies,
      },
    },
  },
  callbacks: {
    jwt: async ({ token, user }) => {
      if (user) {
        token.user = user;
      }
      return token;
    },
    session: async ({ session, token }) => {
      if (!token.sub || !token.email) {
        return session;
      }

      (session.user as CustomUser) = {
        id: token.sub,
        email: token.email,
        name: token.name,
        image: token.picture,
        ...(typeof token.user === "object" && token.user !== null
          ? token.user
          : {}),
      } as CustomUser;
      return session;
    },
  },
};

export default NextAuth(authOptions);
