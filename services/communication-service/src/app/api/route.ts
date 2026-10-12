import { NextResponse } from 'next/server';

// Phase 1 scaffold: placeholder (future chat, notifications and safety endpoints).

export async function GET() {
  return NextResponse.json({
    service: 'communication-service',
    status: 'scaffolding',
    phase: 1,
    method: 'GET',
  });
}
