import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

/**
 * Middleware that handles:
 * 1. Root redirect to /login
 * 2. Role-based route protection
 * 3. Security headers
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Root redirect
  if (pathname === '/') {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // Get session token.
  // secureCookie must mirror how Auth.js picked the cookie name server-side:
  // over HTTPS it issues `__Secure-authjs.session-token`, and the cookie name
  // is also the JWT decryption salt — without this, getToken always returns
  // null in production and logged-in users get bounced back to /login.
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0].trim();
  const isSecure =
    forwardedProto === 'https' || request.nextUrl.protocol === 'https:';

  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET,
    secureCookie: isSecure,
  });

  // Public routes that don't require authentication
  const publicRoutes = ['/login', '/register', '/forgot-password', '/reset-password', '/api/auth'];
  const isPublicRoute = publicRoutes.some((route) => pathname.startsWith(route));

  if (!isPublicRoute && !token) {
    // Protected route without session — redirect to login
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Role-based protection: student routes
  if (pathname.startsWith('/student') && token?.role && token.role !== 'STUDENT') {
    return NextResponse.redirect(new URL('/driver/dashboard', request.url));
  }

  // Role-based protection: driver routes
  if (pathname.startsWith('/driver') && token?.role && token.role !== 'DRIVER') {
    return NextResponse.redirect(new URL('/student/dashboard', request.url));
  }

  // If authenticated user tries to access login/register, redirect to their dashboard
  if (isPublicRoute && token) {
    if (token.role === 'STUDENT') {
      return NextResponse.redirect(new URL('/student/dashboard', request.url));
    } else if (token.role === 'DRIVER') {
      return NextResponse.redirect(new URL('/driver/dashboard', request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/',
    '/student/:path*',
    '/driver/:path*',
    '/login',
    '/register/:path*',
  ],
};
