#!/usr/bin/env bash
# Generates all thin app/api route files (sibling import-depth pattern).
set -euo pipefail
cd "$(dirname "$0")/.."

# Root api health route (replaces the Phase 1 scaffold placeholder).
cat > src/app/api/route.ts <<'EOF'
import { NextResponse } from 'next/server';
import { pool } from '../../../db';

export async function GET() {
  try {
    await pool.query('SELECT 1');
    return NextResponse.json({ ok: true, service: 'transaction-service' });
  } catch (err) {
    console.error('[transaction:health]', err);
    return NextResponse.json({ ok: false, service: 'transaction-service' }, { status: 500 });
  }
}
EOF

# transactions
mkdir -p src/app/api/transactions
cat > src/app/api/transactions/route.ts <<'EOF'
export { createTransaction as POST, listTransactions as GET } from '../../../routes/transactions';
EOF

mkdir -p 'src/app/api/transactions/[id]'
cat > 'src/app/api/transactions/[id]/route.ts' <<'EOF'
import { getTransaction } from '../../../../routes/transactions';

export const GET = getTransaction;
EOF

mkdir -p 'src/app/api/transactions/[id]/escrow/init'
cat > 'src/app/api/transactions/[id]/escrow/init/route.ts' <<'EOF'
import { initEscrow } from '../../../../../routes/escrow';

export const POST = initEscrow;
EOF

mkdir -p 'src/app/api/transactions/[id]/verify-handover'
cat > 'src/app/api/transactions/[id]/verify-handover/route.ts' <<'EOF'
import { verifyHandover } from '../../../../../routes/handover';

export const POST = verifyHandover;
EOF

mkdir -p 'src/app/api/transactions/[id]/dispute'
cat > 'src/app/api/transactions/[id]/dispute/route.ts' <<'EOF'
import { createDispute } from '../../../../../src/routes/disputes';

export const POST = createDispute;
EOF

mkdir -p 'src/app/api/disputes/[id]/resolve'
cat > 'src/app/api/disputes/[id]/resolve/route.ts' <<'EOF'
import { resolveDispute } from '../../../../../src/routes/disputes';

export const PATCH = resolveDispute;
EOF

mkdir -p src/app/api/webhooks/razorpay
cat > src/app/api/webhooks/razorpay/route.ts <<'EOF'
import { handleRazorpayWebhook } from '../../../routes/webhook';

export const POST = handleRazorpayWebhook;
EOF

echo "route files generated"