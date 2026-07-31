'use client';

import { useState, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { auth, db } from '@/lib/firebase';
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signInWithPopup, 
  GoogleAuthProvider,
  updateProfile
} from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import GoBackButton from '@/components/GoBackButton';

function AuthContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get('redirect');

  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password || (mode === 'signup' && !name)) {
      setError('Please fill in all required fields');
      return;
    }
    setError('');
    setLoading(true);

    try {
      if (mode === 'signup') {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        await updateProfile(user, { displayName: name });

        const userRef = doc(db, 'users', user.uid);
        await setDoc(userRef, {
          email: user.email || '',
          displayName: name,
          plan: 'free',
          dailyDownloads: 0,
          lastDownloadDate: new Date().toISOString().split('T')[0],
          downloadHistory: [],
          createdAt: serverTimestamp(),
        });
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }

      router.push(redirect || '/');
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleAuth = async () => {
    setError('');
    setLoading(true);
    const provider = new GoogleAuthProvider();

    try {
      const userCredential = await signInWithPopup(auth, provider);
      const user = userCredential.user;

      const userRef = doc(db, 'users', user.uid);
      const userSnap = await getDoc(userRef);

      if (!userSnap.exists()) {
        await setDoc(userRef, {
          email: user.email || '',
          displayName: user.displayName || '',
          plan: 'free',
          dailyDownloads: 0,
          lastDownloadDate: new Date().toISOString().split('T')[0],
          downloadHistory: [],
          createdAt: serverTimestamp(),
        });
      }

      router.push(redirect || '/');
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Google Sign-In failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex flex-col items-center justify-center px-4 sm:px-6 min-h-[calc(100vh-80px)]">
      <div className="w-full max-w-sm relative">
        <div className="mb-4">
          <GoBackButton />
        </div>

        <div
          className="bg-white rounded-[32px] p-6 sm:p-10 shadow-sm border border-black/[0.04]"
          style={{ animation: 'slideUp 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94) both' }}
        >
          <div className="text-center mb-6">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-1.5">
              {mode === 'signin' ? 'Welcome Back' : 'Create Account'}
            </h1>
            <p className="text-sm text-gray-500">
              {mode === 'signin' ? 'Sign in to your account' : 'Register for an account'}
            </p>
          </div>

          {error && (
            <div className="mb-5 p-3.5 bg-red-50 text-red-600 rounded-2xl text-center text-xs border border-red-100">
              {error}
            </div>
          )}

          <form onSubmit={handleEmailAuth} className="flex flex-col gap-4">
            {mode === 'signup' && (
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Full Name"
                className="h-[56px] bg-gray-50 rounded-2xl px-4 text-sm border-[1.5px] border-black/6 outline-none focus:border-[#ff3b30] focus:ring-4 focus:ring-[#ff3b30]/10 transition-all duration-300"
                required
              />
            )}

            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email Address"
              className="h-[56px] bg-gray-50 rounded-2xl px-4 text-sm border-[1.5px] border-black/6 outline-none focus:border-[#ff3b30] focus:ring-4 focus:ring-[#ff3b30]/10 transition-all duration-300"
              required
            />

            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="h-[56px] bg-gray-50 rounded-2xl px-4 text-sm border-[1.5px] border-black/6 outline-none focus:border-[#ff3b30] focus:ring-4 focus:ring-[#ff3b30]/10 transition-all duration-300"
              required
            />

            <button
              type="submit"
              disabled={loading}
              className="mt-1 h-[52px] w-full bg-[#ff3b30] text-white rounded-full font-medium text-base disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#e6352b] active:scale-[0.99] transition-all duration-300 shadow-sm"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2 text-sm">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Processing...
                </span>
              ) : (
                mode === 'signin' ? 'Sign In' : 'Sign Up'
              )}
            </button>
          </form>

          <div className="relative my-6 flex items-center justify-center">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-black/5"></div>
            </div>
            <span className="relative px-3 bg-white text-xs text-gray-400 font-medium">OR</span>
          </div>

          <button
            type="button"
            onClick={handleGoogleAuth}
            disabled={loading}
            className="h-[52px] w-full bg-white border-[1.5px] border-black/8 hover:bg-gray-50 active:scale-[0.99] text-gray-700 rounded-full font-medium text-sm flex items-center justify-center gap-3 transition-all duration-300 shadow-sm"
          >
            <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            Sign in with Google
          </button>

          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={() => {
                setError('');
                setMode(mode === 'signin' ? 'signup' : 'signin');
              }}
              className="text-[#ff3b30] text-sm font-medium hover:underline transition-opacity"
            >
              {mode === 'signin' ? "Don't have an account? Sign Up" : 'Already have an account? Sign In'}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

export default function AuthPage() {
  return (
    <Suspense fallback={
      <main className="flex flex-col items-center justify-center p-6 min-h-[calc(100vh-80px)]">
        <div className="w-8 h-8 border-4 border-gray-200 border-t-[#ff3b30] rounded-full animate-spin"></div>
      </main>
    }>
      <AuthContent />
    </Suspense>
  );
}
