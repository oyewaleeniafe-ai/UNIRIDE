import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Simple middleware — just redirect / to /login
// Auth checks are handled server-side in layouts and server actions
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Root redirect
  if (pathname === '/') {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/'],
};
