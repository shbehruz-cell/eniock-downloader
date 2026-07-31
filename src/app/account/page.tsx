'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { db, auth } from '@/lib/firebase';
import { updatePassword, updateProfile } from 'firebase/auth';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import GoBackButton from '@/components/GoBackButton';

export default function AccountPage() {
  const router = useRouter();
  const { user, userData: authUserData, loading: authLoading, signOut } = useAuth();
  const plan = authUserData?.plan || 'free';
  
  const [userData, setUserData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  
  // Settings Form States
  const [name, setName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  // Feedback states
  const [settingsError, setSettingsError] = useState('');
  const [settingsSuccess, setSettingsSuccess] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  useEffect(() => {
    if (!authLoading && !user && !isSigningOut) {
      router.push('/auth');
    }
  }, [user, authLoading, router, isSigningOut]);

  useEffect(() => {
    const fetchUserData = async () => {
      if (user) {
        try {
          const userRef = doc(db, 'users', user.uid);
          const snap = await getDoc(userRef);
          if (snap.exists()) {
            const data = snap.data();
            setUserData(data);
            setName(data.displayName || user.displayName || '');
          }
        } catch (error) {
          console.error("Error fetching user data:", error);
        } finally {
          setLoading(false);
        }
      }
    };
    fetchUserData();
  }, [user]);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSettingsError('');
    setSettingsSuccess(false);
    setSettingsLoading(true);

    try {
      if (auth.currentUser && user) {
        // 1. Update Display Name if changed
        if (name.trim() && name !== (userData?.displayName || user.displayName)) {
          await updateProfile(auth.currentUser, { displayName: name });
          const userRef = doc(db, 'users', user.uid);
          await updateDoc(userRef, { displayName: name });
          setUserData((prev: any) => ({ ...prev, displayName: name }));
        }

        // 2. Update Password if typed
        if (newPassword) {
          if (newPassword !== confirmPassword) {
            setSettingsError("New passwords don't match.");
            setSettingsLoading(false);
            return;
          }
          if (newPassword.length < 6) {
            setSettingsError("Password must be at least 6 characters.");
            setSettingsLoading(false);
            return;
          }
          await updatePassword(auth.currentUser, newPassword);
          const userRef = doc(db, 'users', user.uid);
          await updateDoc(userRef, { password: newPassword });
          setUserData((prev: any) => ({ ...prev, password: newPassword }));
        }

        setSettingsSuccess(true);
        setNewPassword('');
        setConfirmPassword('');
        
        setTimeout(() => {
          setIsSettingsModalOpen(false);
          setSettingsSuccess(false);
        }, 1500);
      }
    } catch (error: any) {
      console.error(error);
      setSettingsError(error.message || "Failed to update settings.");
    } finally {
      setSettingsLoading(false);
    }
  };

  const handleDeleteHistory = async (historyId: string) => {
    if (!user || !userData) return;
    const newHistory = userData.downloadHistory?.filter((h: any) => h.id !== historyId) || [];
    
    try {
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, { downloadHistory: newHistory });
      setUserData({ ...userData, downloadHistory: newHistory });
    } catch (error) {
      console.error("Failed to delete history item", error);
    }
  };

  const handleSignOut = async () => {
    try {
      setIsSigningOut(true);
      await signOut();
      router.push('/');
    } catch (error) {
      console.error("Failed to sign out", error);
      setIsSigningOut(false);
    }
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-[calc(100vh-80px)] flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-gray-200 border-t-[#ff3b30] rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!user) return null;

  const displayName = userData?.displayName || user.displayName || 'User';
  const displayEmail = userData?.email || user.email || '—';
  const photoURL = user.photoURL;
  const initialLetter = displayName.charAt(0).toUpperCase();

  return (
    <main className="flex flex-col items-center p-6 min-h-[calc(100vh-80px)]">
      <div className="w-full max-w-3xl relative animate-in fade-in duration-500">
        <div className="mb-6">
          <GoBackButton />
        </div>
        
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Your Account</h1>

        {/* Redesigned User Info Section */}
        <div className="bg-white rounded-[32px] p-8 shadow-sm mb-8 flex flex-col items-center text-center">
          {/* Profile Photo */}
          <div className="w-24 h-24 rounded-full overflow-hidden bg-gradient-to-tr from-[#ff3b30] to-[#ff9f0a] flex items-center justify-center text-white text-3xl font-bold shadow-md border-4 border-white mb-4">
            {photoURL ? (
              <img src={photoURL} alt="Profile" className="w-full h-full object-cover" />
            ) : (
              <span>{initialLetter}</span>
            )}
          </div>

          {/* User Name */}
          <h2 className="text-2xl font-bold text-gray-900 mb-1">{displayName}</h2>
          <p className="text-sm text-gray-500 mb-6">{displayEmail}</p>

          {/* Buttons */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsSettingsModalOpen(true)}
              className="bg-[#ff3b30] text-white rounded-full px-5 py-2.5 text-xs font-semibold hover:bg-[#e6352b] active:scale-[0.98] transition-all duration-300 shadow-sm"
            >
              Settings
            </button>
            <button
              onClick={handleSignOut}
              className="bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-full px-5 py-2.5 text-xs font-semibold active:scale-[0.98] transition-all duration-300"
            >
              Log Out
            </button>
          </div>
        </div>

        {/* Download History Section */}
        <div>
          <h2 className="text-xl font-semibold mb-6">Download History</h2>
          
          {(!userData?.downloadHistory || userData.downloadHistory.length === 0) ? (
            <div className="bg-white rounded-[32px] p-8 text-center text-gray-500 shadow-sm">
              You haven't downloaded any videos yet.
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {userData.downloadHistory.map((item: any, i: number) => (
                <div key={item.id || i} className="bg-white rounded-2xl p-4 flex items-center gap-4 shadow-sm">
                  <div className="w-[120px] aspect-video bg-gray-100 rounded-xl overflow-hidden relative shrink-0">
                    {item.thumbnail ? (
                      <img src={item.thumbnail} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-gray-200"></div>
                    )}
                    {item.duration && (
                      <div className="absolute bottom-1 right-1 bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded">
                        {item.duration}
                      </div>
                    )}
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-gray-900 truncate">{item.title || 'Unknown Video'}</h3>
                    <p className="text-sm text-gray-500">{item.size || 'Unknown size'} • {item.quality || 'Unknown quality'}</p>
                  </div>
                  
                  <div className="flex items-center gap-2 shrink-0">
                    <button 
                      onClick={() => router.push(`/?url=${encodeURIComponent(item.url)}`)}
                      className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-full text-sm font-medium transition-colors hidden sm:block"
                    >
                      Download Again
                    </button>
                    <button 
                      onClick={() => handleDeleteHistory(item.id)}
                      className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors"
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Floating Settings Modal */}
      {isSettingsModalOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-300">
          <div className="bg-white rounded-[32px] p-8 w-full max-w-md relative shadow-2xl border border-black/[0.03] animate-in slide-in-from-bottom-4 duration-300">
            <button 
              onClick={() => setIsSettingsModalOpen(false)}
              className="absolute top-6 right-6 text-gray-400 hover:text-gray-900 transition-colors"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            
            <h3 className="text-2xl font-bold mb-6 text-gray-900">Account Settings</h3>
            
            {settingsError && <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-xl text-sm border border-red-100">{settingsError}</div>}
            {settingsSuccess && <div className="mb-4 p-3 bg-green-50 text-green-600 rounded-xl text-sm border border-green-100">Settings saved successfully!</div>}

            <form onSubmit={handleSaveSettings} className="flex flex-col gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Display Name</label>
                <input
                  type="text"
                  placeholder="Your Name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full h-12 bg-gray-50 rounded-xl px-4 border border-gray-200 outline-none focus:border-[#ff3b30] focus:ring-4 focus:ring-[#ff3b30]/10 transition-all text-sm font-medium"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Email Address</label>
                <input
                  type="email"
                  value={displayEmail}
                  className="w-full h-12 bg-gray-100 rounded-xl px-4 border border-gray-200 outline-none text-sm text-gray-500 font-medium cursor-not-allowed"
                  disabled
                />
              </div>

              <div className="border-t border-gray-100 my-2 pt-4">
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Change Password</label>
                <div className="flex flex-col gap-3">
                  <input
                    type="password"
                    placeholder="New Password (min. 6 chars)"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full h-12 bg-gray-50 rounded-xl px-4 border border-gray-200 outline-none focus:border-[#ff3b30] focus:ring-4 focus:ring-[#ff3b30]/10 transition-all text-sm font-medium"
                  />
                  <input
                    type="password"
                    placeholder="Confirm New Password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full h-12 bg-gray-50 rounded-xl px-4 border border-gray-200 outline-none focus:border-[#ff3b30] focus:ring-4 focus:ring-[#ff3b30]/10 transition-all text-sm font-medium"
                  />
                </div>
              </div>

              <div className="bg-gray-50 rounded-2xl p-4 flex items-center justify-between mt-2">
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Current Plan</p>
                  <p className="text-sm font-bold text-gray-900 capitalize mt-0.5">{plan}</p>
                </div>
                <button 
                  type="button" 
                  onClick={() => {
                    setIsSettingsModalOpen(false);
                    router.push('/pricing');
                  }}
                  className="text-xs font-semibold text-[#ff3b30] hover:underline"
                >
                  Upgrade Plan
                </button>
              </div>

              <button
                type="submit"
                disabled={settingsLoading}
                className="w-full h-12 bg-[#ff3b30] text-white rounded-full font-semibold text-sm mt-4 hover:bg-[#e6352b] active:scale-[0.99] transition-all duration-300 shadow-sm flex items-center justify-center gap-2"
              >
                {settingsLoading ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Save Settings'
                )}
              </button>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
