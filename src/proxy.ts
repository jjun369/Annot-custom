import { NextRequest, NextResponse } from 'next/server';

export function proxy(request: NextRequest) {
  const expectedToken = process.env.PAGEDOCK_DESKTOP_TOKEN;
  if (!expectedToken) return NextResponse.next();

  const providedToken = request.headers.get('x-pagedock-desktop-token');
  if (providedToken === expectedToken) return NextResponse.next();

  return new NextResponse('PageDock desktop access only', { status: 403 });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|pagedock-mark.svg).*)'],
};
