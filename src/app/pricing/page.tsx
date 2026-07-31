'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { doc, getDoc, setDoc, addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import GoBackButton from '@/components/GoBackButton';

export default function PricingPage() {
  const router = useRouter();
  const { user, userData } = useAuth();
  const plan = userData?.plan || 'free';
  
  // Site config settings state
  const [config, setConfig] = useState({
    cardNumber: '9860 0000 0000 0000',
    cardHolder: 'ADMIN NAME',
    paymentInstructions: 'Ushbu kartaga tegishli pulni o\'tkazib, chekni rasm shaklida yuklang.',
    proPrice: '20',
    proDescription: 'Max quality: 720p • 10 URLs per day',
    maxPrice: '70',
    maxDescription: 'All qualities up to 4K • Unlimited downloads',
  });

  const [loading, setLoading] = useState<string | null>(null);
  
  // Payment Modal States
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState('');
  const [receiptBase64, setReceiptBase64] = useState('');
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  const [paymentError, setPaymentError] = useState('');

  // Fetch site configuration from Firestore on mount
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const configRef = doc(db, 'settings', 'site_config');
        const snap = await getDoc(configRef);
        if (snap.exists()) {
          setConfig(snap.data() as any);
        } else {
          // Initialize config in Firestore with default values if it doesn't exist
          await setDoc(configRef, config);
        }
      } catch (err) {
        console.error('Error fetching config:', err);
      }
    };
    fetchConfig();
  }, []);

  const handleUpgradeClick = (newPlan: string) => {
    if (!user) {
      router.push(`/auth?redirect=/pricing`);
      return;
    }
    if (plan === newPlan) return;

    setSelectedPlan(newPlan);
    setReceiptBase64('');
    setPaymentError('');
    setPaymentSuccess(false);
    setIsPaymentModalOpen(true);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 3 * 1024 * 1024) {
        setPaymentError('Fayl hajmi 3MB dan oshmasligi kerak');
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setReceiptBase64(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handlePaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!receiptBase64) {
      setPaymentError('Iltimos, to\'lov chekini yuklang.');
      return;
    }

    setLoading(selectedPlan);
    setPaymentError('');

    try {
      const price = selectedPlan === 'pro' ? config.proPrice : config.maxPrice;
      
      // Save payment proof to Firestore
      await addDoc(collection(db, 'payments'), {
        userId: user!.uid,
        userDisplayName: userData?.displayName || user!.displayName || 'User',
        userEmail: userData?.email || user!.email || '',
        userPhotoURL: user!.photoURL || '',
        plan: selectedPlan,
        amount: price,
        receipt: receiptBase64,
        status: 'pending',
        createdAt: serverTimestamp(),
      });

      setPaymentSuccess(true);
      
      // Redirect to home page after 5 seconds
      setTimeout(() => {
        setIsPaymentModalOpen(false);
        router.push('/');
      }, 5000);

    } catch (err: any) {
      console.error(err);
      setPaymentError(err.message || 'To\'lov yuborishda xatolik yuz berdi.');
    } finally {
      setLoading(null);
    }
  };

  const CheckIcon = () => (
    <svg className="w-5 h-5 text-green-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  );

  return (
    <main className="flex flex-col items-center p-6 min-h-[calc(100vh-80px)]">
      <div className="w-full max-w-5xl relative animate-in fade-in duration-500">
        <div className="mb-6">
          <GoBackButton />
        </div>
        
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4">Choose Your Plan</h1>
          <p className="text-xl text-gray-500">Download without limits</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
          {/* Free Plan */}
          <div className="bg-white rounded-[32px] p-8 border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
            <h2 className="text-2xl font-semibold mb-2">Free</h2>
            <div className="mb-6">
              <span className="text-4xl font-bold">$0</span>
              <span className="text-gray-500">/month</span>
            </div>
            
            <ul className="flex flex-col gap-4 mb-8">
              <li className="flex items-center gap-3"><CheckIcon /> 3 URLs per day</li>
              <li className="flex items-center gap-3"><CheckIcon /> Max quality: 480p</li>
              <li className="flex items-center gap-3"><CheckIcon /> Max video duration: 1 hour</li>
            </ul>

            <button
              disabled={plan === 'free'}
              className="w-full py-4 rounded-full font-medium transition-colors bg-gray-100 text-gray-500 cursor-default"
            >
              Current Plan
            </button>
          </div>

          {/* Pro Plan */}
          <div className="bg-white rounded-[32px] p-8 border-2 border-[#ff3b30] shadow-lg transform md:scale-105 relative z-10">
            <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-[#ff3b30] text-white px-4 py-1 rounded-full text-sm font-medium">
              Popular
            </div>
            <h2 className="text-2xl font-semibold mb-2">Pro</h2>
            <div className="mb-6">
              <span className="text-4xl font-bold">${config.proPrice}</span>
              <span className="text-gray-500">/month</span>
            </div>
            
            <ul className="flex flex-col gap-4 mb-8">
              <li className="flex items-center gap-3"><CheckIcon /> 10 URLs per day</li>
              <li className="flex items-center gap-3"><CheckIcon /> Max quality: 720p</li>
              <li className="flex items-center gap-3"><CheckIcon /> No duration limit</li>
              <li className="flex items-center gap-3"><CheckIcon /> Max file size: 1.5GB</li>
            </ul>

            <button
              onClick={() => handleUpgradeClick('pro')}
              disabled={plan === 'pro' || loading !== null}
              className={`w-full py-4 rounded-full font-medium transition-colors ${
                plan === 'pro'
                  ? 'bg-gray-100 text-gray-500 cursor-default'
                  : 'bg-[#ff3b30] text-white hover:bg-[#e6352b]'
              }`}
            >
              {plan === 'pro' ? 'Current Plan' : 'Upgrade to Pro'}
            </button>
          </div>

          {/* Max Plan */}
          <div className="bg-white rounded-[32px] p-8 border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
            <h2 className="text-2xl font-semibold mb-2">Max</h2>
            <div className="mb-6">
              <span className="text-4xl font-bold">${config.maxPrice}</span>
              <span className="text-gray-500">/month</span>
            </div>
            
            <ul className="flex flex-col gap-4 mb-8">
              <li className="flex items-center gap-3"><CheckIcon /> Unlimited daily downloads</li>
              <li className="flex items-center gap-3"><CheckIcon /> All qualities up to 4K</li>
              <li className="flex items-center gap-3"><CheckIcon /> No duration limit</li>
              <li className="flex items-center gap-3"><CheckIcon /> No file size limit</li>
            </ul>

            <button
              onClick={() => handleUpgradeClick('max')}
              disabled={plan === 'max' || loading !== null}
              className={`w-full py-4 rounded-full font-medium transition-colors ${
                plan === 'max'
                  ? 'bg-gray-100 text-gray-500 cursor-default'
                  : 'bg-[#1d1d1f] text-white hover:bg-black'
              }`}
            >
              {plan === 'max' ? 'Current Plan' : 'Upgrade to Max'}
            </button>
          </div>
        </div>
      </div>

      {/* Floating Payment Modal */}
      {isPaymentModalOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-300">
          <div className="bg-white rounded-[32px] p-6 sm:p-8 w-full max-w-md relative shadow-2xl border border-black/[0.03] animate-in slide-in-from-bottom-4 duration-300">
            
            {!paymentSuccess ? (
              <>
                <button 
                  onClick={() => setIsPaymentModalOpen(false)}
                  className="absolute top-6 right-6 text-gray-400 hover:text-gray-900 transition-colors"
                >
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>

                <h3 className="text-2xl font-bold mb-6 text-gray-900 capitalize">Upgrade to {selectedPlan}</h3>

                {paymentError && (
                  <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-xl text-sm border border-red-100">
                    {paymentError}
                  </div>
                )}

                {/* Card Info Container */}
                <div className="bg-gradient-to-br from-[#1d1d1f] to-[#2c2c2e] text-white p-6 rounded-2xl shadow-md mb-6 relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-24 h-24 bg-white/5 rounded-full -mr-8 -mt-8 pointer-events-none" />
                  <p className="text-xs text-white/50 uppercase tracking-wider mb-4 font-semibold">To'lov uchun karta</p>
                  <p className="text-xl sm:text-2xl font-mono tracking-widest mb-4 font-bold">{config.cardNumber}</p>
                  <div className="flex justify-between items-end">
                    <div>
                      <p className="text-[10px] text-white/40 uppercase tracking-wider">Karta Egasi</p>
                      <p className="text-sm font-semibold tracking-wide">{config.cardHolder}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-white/40 uppercase tracking-wider">Jami Narx</p>
                      <p className="text-lg font-bold">${selectedPlan === 'pro' ? config.proPrice : config.maxPrice}</p>
                    </div>
                  </div>
                </div>

                <div className="mb-6 bg-gray-50 border border-gray-100 rounded-2xl p-4 text-xs text-gray-600 leading-relaxed">
                  <p className="font-semibold text-gray-900 mb-1.5">Ko'rsatma:</p>
                  <p>{config.paymentInstructions}</p>
                </div>

                <form onSubmit={handlePaymentSubmit} className="flex flex-col gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">To'lov chekini yuklang (Rasm)</label>
                    <div className="relative border-2 border-dashed border-gray-200 hover:border-[#ff3b30] rounded-2xl p-4 text-center cursor-pointer transition-colors">
                      <input 
                        type="file" 
                        accept="image/*" 
                        onChange={handleFileChange}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        required
                      />
                      {receiptBase64 ? (
                        <div className="flex flex-col items-center gap-1">
                          <svg className="w-8 h-8 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          <span className="text-xs text-gray-600 font-semibold truncate max-w-[200px]">Chek tanlandi</span>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-1 text-gray-400">
                          <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                          </svg>
                          <span className="text-xs font-medium text-gray-500">Rasm yuklash uchun bosing</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading !== null}
                    className="w-full h-12 bg-[#ff3b30] text-white rounded-full font-semibold text-sm mt-2 hover:bg-[#e6352b] active:scale-[0.99] transition-all duration-300 shadow-sm flex items-center justify-center gap-2"
                  >
                    {loading !== null ? (
                      <>
                        <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Yuborilmoqda...
                      </>
                    ) : (
                      'To\'lov qildim'
                    )}
                  </button>
                </form>
              </>
            ) : (
              <div className="flex flex-col items-center text-center py-6 animate-in fade-in duration-300">
                <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mb-4 text-green-500">
                  <svg className="w-8 h-8 animate-bounce" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">To'lov yuborildi</h3>
                <p className="text-sm text-gray-500 leading-relaxed mb-1">To'lov tasdiqlanishi kutilmoqda...</p>
                <p className="text-xs text-gray-400">5 soniyadan keyin asosiy sahifaga yo'naltirilasiz.</p>
              </div>
            )}
            
          </div>
        </div>
      )}
    </main>
  );
}
