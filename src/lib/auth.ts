import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';

const nextAuth = NextAuth({
  providers: [
    Credentials({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const email = credentials.email as string;
        const password = credentials.password as string;

        const user = await prisma.user.findUnique({
          where: { email },
        });

        if (!user || !user.isActive) return null;

        const isValid = await bcrypt.compare(password, user.passwordHash);
        if (!isValid) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        };
      },
    }),
  ],
  session: {
    strategy: 'jwt',
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as unknown as { role: string }).role;
        token.userId = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (session.user as any).role = token.role as string;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (session.user as any).id = token.userId as string;
      }
      return session;
    },
  },
  pages: {
    signIn: '/login',
  },
});

export const handlers = nextAuth.handlers;
export const auth = nextAuth.auth;
export const signIn = nextAuth.signIn;
export const signOut = nextAuth.signOut;

// Helper to safely get user ID from session
export async function getUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user) {
    throw new Error('Not authenticated');
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (session.user as any).id as string;
}

export async function getUserRole(): Promise<string> {
  const session = await auth();
  if (!session?.user) {
    throw new Error('Not authenticated');
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (session.user as any).role as string;
}
