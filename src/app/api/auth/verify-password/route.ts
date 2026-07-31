import { NextRequest, NextResponse } from 'next/server';

// Simple hash comparison for demo (in production, use bcrypt on a proper backend)
export async function POST(request: NextRequest) {
  try {
    const { phoneNumber, password } = await request.json();

    if (!phoneNumber || !password) {
      return NextResponse.json({ error: 'Phone number and password are required' }, { status: 400 });
    }

    // This is handled client-side with Firebase for this implementation
    // In production, use Firebase Functions with bcrypt
    return NextResponse.json({ valid: true });
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
