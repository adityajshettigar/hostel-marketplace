import { NextResponse } from 'next/server';

// Phase 1 scaffold: placeholder (future price AI, categorisation, recommendations).

export async function GET() {
  return NextResponse.json({
    service: 'ai-service',
    status: 'scaffolding',
    phase: 1,
    method: 'GET',
  });
}
