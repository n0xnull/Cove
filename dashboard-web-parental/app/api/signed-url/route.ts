import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

// Client dengan service role key — hanya berjalan di server (API route)
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Bucket yang diizinkan — whitelist eksplisit agar tidak bisa dipakai untuk bucket lain
const ALLOWED_BUCKETS = new Set([
  'audio-recordings',
  'video-recordings',
  'camera-photos',
  'screenshots',
  'file-transfers',
]);

export async function POST(req: NextRequest) {
  try {
    const { bucket, path, expiresIn = 3600 } = await req.json();

    if (!bucket || !path) {
      return NextResponse.json({ error: 'bucket dan path wajib diisi' }, { status: 400 });
    }
    if (!ALLOWED_BUCKETS.has(bucket)) {
      return NextResponse.json({ error: 'Bucket tidak diizinkan' }, { status: 403 });
    }

    const { data, error } = await supabaseAdmin.storage
      .from(bucket)
      .createSignedUrl(path, expiresIn);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (!data?.signedUrl) {
      return NextResponse.json({ error: 'Signed URL tidak tersedia' }, { status: 500 });
    }

    return NextResponse.json({ url: data.signedUrl });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Internal error' }, { status: 500 });
  }
}
