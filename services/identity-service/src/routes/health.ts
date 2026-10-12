import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'identity-service',
    phase: 2,
    timestamp: new Date().toISOString(),
  });
}
