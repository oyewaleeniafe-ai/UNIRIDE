import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';

const studentRoutes = ['/student/dashboard', '/student/book', '/student/rides', '/student/profile'];
const driverRoutes = ['/driver/dashboard', '/driver/rides', '/driver/inspection', '/driver/earnings', '/driver/profile'];

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const session = req.auth;

  // Unauthenticated users trying to access protected routes
  if (!session?.user) {
    if (pathname.startsWith('/student') || pathname.startsWith('/driver')) {
      return NextResponse.redirect(new URL('/login', req.url));
    }
    return NextResponse.next();
  }

  const role = (session.user as { role: string }).role;

  // Student trying to access driver routes
  if (role === 'STUDENT' && pathname.startsWith('/driver')) {
    return NextResponse.redirect(new URL('/student/dashboard', req.url));
  }

  // Driver trying to access student routes
  if (role === 'DRIVER' && pathname.startsWith('/student')) {
    return NextResponse.redirect(new URL('/driver/dashboard', req.url));
  }

  // Authenticated users on login/register pages
  if (pathname === '/login' || pathname.startsWith('/register')) {
    if (role === 'STUDENT') {
      return NextResponse.redirect(new URL('/student/dashboard', req.url));
    }
    if (role === 'DRIVER') {
      return NextResponse.redirect(new URL('/driver/dashboard', req.url));
    }
  }

  return NextResponse.next();
});

export const config = {
  matcher: ['/student/:path*', '/driver/:path*', '/login', '/register/:path*'],
};
