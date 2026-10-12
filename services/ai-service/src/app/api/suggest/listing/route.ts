import { suggestListing } from '../../../../routes/suggest-listing';

export const dynamic = 'force-dynamic';

// POST /api/suggest/listing — assistive title/category/description draft.
export async function POST(request: Request) {
  return suggestListing(request);
}
