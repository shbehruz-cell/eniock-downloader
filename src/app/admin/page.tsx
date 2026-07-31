'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { db } from '@/lib/firebase';
import { 
  collection, 
  getDocs, 
  doc, 
  updateDoc, 
  deleteDoc, 
  getDoc, 
  setDoc,
  serverTimestamp
} from 'firebase/firestore';
import GoBackButton from '@/components/GoBackButton';

export default function AdminPage() {
  const router = useRouter();
  
  // Authentication state
  const [isAdminLoggedIn, setIsAdminLoggedIn] = useState(false);
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  // Main UI States
  const [activeTab, setActiveTab] = useState<'stats' | 'users' | 'payments' | 'settings'>('stats');
  
  // Data States
  const [users, setUsers] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>({
    cardNumber: '9860 0000 0000 0000',
    cardHolder: 'ADMIN NAME',
    paymentInstructions: 'Ushbu kartaga tegishli pulni o\'tkazib, chekni rasm shaklida yuklang.',
    proPrice: '20',
    proStarsPrice: '200',
    proDescription: 'Max quality: 720p • 10 URLs per day',
    maxPrice: '70',
    maxStarsPrice: '700',
    maxDescription: 'All qualities up to 4K • Unlimited downloads',
    telegramBotToken: '',
  });
  
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Stats filter state
  const [timeRange, setTimeRange] = useState<'daily' | 'monthly' | 'yearly' | 'total'>('daily');

  // Modals state
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [isEditUserModalOpen, setIsEditUserModalOpen] = useState(false);
  const [selectedReceipt, setSelectedReceipt] = useState<any>(null);
  const [isReceiptModalOpen, setIsReceiptModalOpen] = useState(false);
  const [viewingUserDetail, setViewingUserDetail] = useState<any>(null);
  const [isUserDetailModalOpen, setIsUserDetailModalOpen] = useState(false);

  // Edit User form state
  const [editPlan, setEditPlan] = useState('free');
  const [editDailyDownloads, setEditDailyDownloads] = useState(0);

  // Check sessionStorage for admin status on mount
  useEffect(() => {
    const logged = sessionStorage.getItem('isAdminLoggedIn');
    if (logged === 'true') {
      setIsAdminLoggedIn(true);
    }
  }, []);

  const handleAdminLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (adminUsername === 'admin' && adminPassword === 'eniock_admin_2026') {
      setIsAdminLoggedIn(true);
      sessionStorage.setItem('isAdminLoggedIn', 'true');
      setLoginError('');
    } else {
      setLoginError('Noto\'g\'ri login yoki parol');
    }
  };

  const handleAdminLogout = () => {
    setIsAdminLoggedIn(false);
    sessionStorage.removeItem('isAdminLoggedIn');
  };

  // Fetch Firestore Data
  const fetchData = async () => {
    if (!isAdminLoggedIn) return;
    setLoading(true);
    try {
      // 1. Fetch Users
      const usersSnap = await getDocs(collection(db, 'users'));
      const usersList = usersSnap.docs.map(doc => ({ uid: doc.id, ...doc.data() }));
      setUsers(usersList);

      // 2. Fetch Payments
      const paymentsSnap = await getDocs(collection(db, 'payments'));
      const paymentsList = paymentsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      // Sort payments: pending first, then by date descending
      paymentsList.sort((a: any, b: any) => {
        if (a.status === 'pending' && b.status !== 'pending') return -1;
        if (a.status !== 'pending' && b.status === 'pending') return 1;
        return (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0);
      });
      setPayments(paymentsList);

      // 3. Fetch Site Settings
      const settingsRef = doc(db, 'settings', 'site_config');
      const settingsSnap = await getDoc(settingsRef);
      if (settingsSnap.exists()) {
        setSettings(settingsSnap.data());
      }
    } catch (err) {
      console.error('Error fetching admin data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [isAdminLoggedIn]);

  // Edit User Handler
  const handleEditUserClick = (usr: any) => {
    setSelectedUser(usr);
    setEditPlan(usr.plan || 'free');
    setEditDailyDownloads(usr.dailyDownloads || 0);
    setIsEditUserModalOpen(true);
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;
    setActionLoading(selectedUser.uid);
    try {
      const userRef = doc(db, 'users', selectedUser.uid);
      await updateDoc(userRef, {
        plan: editPlan,
        dailyDownloads: editDailyDownloads
      });
      setIsEditUserModalOpen(false);
      await fetchData();
    } catch (err) {
      console.error(err);
      alert('Userni tahrirlashda xatolik yuz berdi');
    } finally {
      setActionLoading(null);
    }
  };

  // Delete User Handler
  const handleDeleteUser = async (uid: string) => {
    if (!confirm('Ushbu foydalanuvchini o\'chirishni xohlaysizmi? Bu amal qaytarilmaydi!')) return;
    setActionLoading(uid);
    try {
      await deleteDoc(doc(db, 'users', uid));
      await fetchData();
    } catch (err) {
      console.error(err);
      alert('Userni o\'chirishda xatolik yuz berdi');
    } finally {
      setActionLoading(null);
    }
  };

  // Confirm/Reject Payment Proofs
  const handleVerifyPayment = async (payment: any, status: 'confirmed' | 'rejected') => {
    setActionLoading(payment.id);
    try {
      // 1. Update Payment status
      const paymentRef = doc(db, 'payments', payment.id);
      await updateDoc(paymentRef, { status });

      // 2. If confirmed, upgrade User plan in Firestore
      if (status === 'confirmed') {
        const userRef = doc(db, 'users', payment.userId);
        await updateDoc(userRef, { plan: payment.plan });
      }

      // 3. Send Telegram Bot notification if payment is from Telegram platform and Bot Token is configured
      if (payment.platform === 'telegram' && settings.telegramBotToken && payment.chatId) {
        const msgText = status === 'confirmed'
          ? `✅ **To'lovingiz muvaffaqiyatli tasdiqlandi!**\n\nTarifingiz **${payment.plan.toUpperCase()}** planiga yangilandi. Bot xizmatlaridan to'liq foydalanishingiz mumkin! 🚀`
          : `❌ **To'lovingiz rad etildi.**\n\nIltimos, yuborgan chekingizni qaytadan tekshirib ko'ring yoki karta ma'lumotlarini tekshiring. Muammo bo'lsa, adminga murojaat qiling.`;

        try {
          await fetch(`https://api.telegram.org/bot${settings.telegramBotToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: payment.chatId,
              text: msgText,
              parse_mode: 'Markdown'
            })
          });
        } catch (botErr) {
          console.error('Failed to notify user via Telegram Bot:', botErr);
        }
      }

      setIsReceiptModalOpen(false);
      await fetchData();
    } catch (err) {
      console.error(err);
      alert('Amalni bajarishda xatolik yuz berdi');
    } finally {
      setActionLoading(null);
    }
  };

  // Save Settings Config
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading('save_settings');
    try {
      const settingsRef = doc(db, 'settings', 'site_config');
      await setDoc(settingsRef, settings);
      alert('Tizim sozlamalari muvaffaqiyatli saqlandi!');
      await fetchData();
    } catch (err) {
      console.error(err);
      alert('Sozlamalarni saqlashda xatolik yuz berdi');
    } finally {
      setActionLoading(null);
    }
  };

  // Statistics Calculations
  const getStatsData = () => {
    const now = new Date();
    const curYear = now.getFullYear();

    let downloadCount = 0;
    let registrationCount = 0;

    const activityData: { label: string; downloads: number; registrations: number }[] = [];

    if (timeRange === 'daily') {
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(now.getDate() - i);
        const dayStr = d.toISOString().split('T')[0];
        const dayLabel = d.toLocaleDateString('uz-UZ', { weekday: 'short' });

        let dayDownloads = 0;
        let dayRegs = 0;

        users.forEach(u => {
          if (u.createdAt) {
            const uDate = new Date(u.createdAt.seconds ? u.createdAt.seconds * 1000 : u.createdAt);
            if (uDate.toISOString().split('T')[0] === dayStr) dayRegs++;
          }
          if (u.downloadHistory && Array.isArray(u.downloadHistory)) {
            u.downloadHistory.forEach((h: any) => {
              if (h.downloadedAt && h.downloadedAt.split('T')[0] === dayStr) dayDownloads++;
            });
          }
        });

        activityData.push({ label: dayLabel, downloads: dayDownloads, registrations: dayRegs });
        if (i === 0) {
          downloadCount = dayDownloads;
          registrationCount = dayRegs;
        }
      }
    } else if (timeRange === 'monthly') {
      for (let i = 5; i >= 0; i--) {
        const d = new Date();
        d.setMonth(now.getMonth() - i);
        const monthVal = d.getMonth();
        const yearVal = d.getFullYear();
        const monthLabel = d.toLocaleDateString('uz-UZ', { month: 'short' });

        let monthDownloads = 0;
        let monthRegs = 0;

        users.forEach(u => {
          if (u.createdAt) {
            const uDate = new Date(u.createdAt.seconds ? u.createdAt.seconds * 1000 : u.createdAt);
            if (uDate.getMonth() === monthVal && uDate.getFullYear() === yearVal) monthRegs++;
          }
          if (u.downloadHistory && Array.isArray(u.downloadHistory)) {
            u.downloadHistory.forEach((h: any) => {
              if (h.downloadedAt) {
                const hDate = new Date(h.downloadedAt);
                if (hDate.getMonth() === monthVal && hDate.getFullYear() === yearVal) monthDownloads++;
              }
            });
          }
        });

        activityData.push({ label: monthLabel, downloads: monthDownloads, registrations: monthRegs });
        if (i === 0) {
          downloadCount = monthDownloads;
          registrationCount = monthRegs;
        }
      }
    } else if (timeRange === 'yearly') {
      for (let i = 2; i >= 0; i--) {
        const yearVal = curYear - i;
        const yearLabel = yearVal.toString();

        let yearDownloads = 0;
        let yearRegs = 0;

        users.forEach(u => {
          if (u.createdAt) {
            const uDate = new Date(u.createdAt.seconds ? u.createdAt.seconds * 1000 : u.createdAt);
            if (uDate.getFullYear() === yearVal) yearRegs++;
          }
          if (u.downloadHistory && Array.isArray(u.downloadHistory)) {
            u.downloadHistory.forEach((h: any) => {
              if (h.downloadedAt) {
                const hDate = new Date(h.downloadedAt);
                if (hDate.getFullYear() === yearVal) yearDownloads++;
              }
            });
          }
        });

        activityData.push({ label: yearLabel, downloads: yearDownloads, registrations: yearRegs });
        if (i === 0) {
          downloadCount = yearDownloads;
          registrationCount = yearRegs;
        }
      }
    } else {
      let totalDownloads = 0;
      let totalRegs = users.length;
      users.forEach(u => {
        if (u.downloadHistory && Array.isArray(u.downloadHistory)) {
          totalDownloads += u.downloadHistory.length;
        }
      });
      downloadCount = totalDownloads;
      registrationCount = totalRegs;
      
      activityData.push({ label: 'Jami', downloads: totalDownloads, registrations: totalRegs });
    }

    return { downloadCount, registrationCount, activityData };
  };

  const { downloadCount, registrationCount, activityData } = getStatsData();

  if (!isAdminLoggedIn) {
    return (
      <main className="flex flex-col items-center justify-center p-6 min-h-[calc(100vh-80px)]">
        <div className="w-full max-w-sm relative">
          <div className="mb-4">
            <GoBackButton />
          </div>

          <div
            className="bg-white rounded-[32px] p-8 shadow-sm border border-black/[0.04]"
            style={{ animation: 'slideUp 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94) both' }}
          >
            <div className="text-center mb-6">
              <h1 className="text-2xl font-bold text-gray-900 mb-1.5">Admin Kirish</h1>
              <p className="text-sm text-gray-500">Tizimga kirish uchun maxsus parolni kiriting</p>
            </div>

            {loginError && (
              <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-xl text-center text-xs border border-red-100">
                {loginError}
              </div>
            )}

            <form onSubmit={handleAdminLogin} className="flex flex-col gap-4">
              <input
                type="text"
                value={adminUsername}
                onChange={(e) => setAdminUsername(e.target.value)}
                placeholder="Username"
                className="h-12 bg-gray-50 rounded-xl px-4 text-sm border border-gray-200 outline-none focus:border-[#ff3b30] transition-colors"
                required
              />
              <input
                type="password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                placeholder="Parol"
                className="h-12 bg-gray-50 rounded-xl px-4 text-sm border border-gray-200 outline-none focus:border-[#ff3b30] transition-colors"
                required
              />
              <button
                type="submit"
                className="h-12 bg-[#ff3b30] text-white rounded-full font-semibold text-sm hover:bg-[#e6352b] active:scale-[0.99] transition-all"
              >
                Kirish
              </button>
            </form>
          </div>
        </div>
      </main>
    );
  }

  const maxDownloads = Math.max(...activityData.map(d => d.downloads), 5);
  const maxRegs = Math.max(...activityData.map(d => d.registrations), 5);

  return (
    <main className="flex flex-col items-center p-6 min-h-[calc(100vh-80px)]">
      <div className="w-full max-w-5xl relative animate-in fade-in duration-500">
        
        {/* Top Header */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Admin Panel</h1>
            <p className="text-sm text-gray-400 mt-1">Loyiha monitoringi va to'lovlarni boshqarish</p>
          </div>
          <button 
            onClick={handleAdminLogout}
            className="bg-gray-100 hover:bg-gray-200 active:scale-95 text-gray-700 text-xs font-semibold px-4 py-2 rounded-full transition-all"
          >
            Chiqish
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex bg-white rounded-full p-1 shadow-sm border border-gray-100 mb-8 max-w-md">
          <button 
            onClick={() => setActiveTab('stats')}
            className={`flex-1 text-center py-2.5 rounded-full text-xs font-semibold transition-all ${
              activeTab === 'stats' ? 'bg-[#ff3b30] text-white shadow-sm' : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            Statistika
          </button>
          <button 
            onClick={() => setActiveTab('users')}
            className={`flex-1 text-center py-2.5 rounded-full text-xs font-semibold transition-all ${
              activeTab === 'users' ? 'bg-[#ff3b30] text-white shadow-sm' : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            Userlar
          </button>
          <button 
            onClick={() => setActiveTab('payments')}
            className={`flex-1 text-center py-2.5 rounded-full text-xs font-semibold transition-all ${
              activeTab === 'payments' ? 'bg-[#ff3b30] text-white shadow-sm' : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            To'lovlar
          </button>
          <button 
            onClick={() => setActiveTab('settings')}
            className={`flex-1 text-center py-2.5 rounded-full text-xs font-semibold transition-all ${
              activeTab === 'settings' ? 'bg-[#ff3b30] text-white shadow-sm' : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            Sozlamalar
          </button>
        </div>

        {loading ? (
          <div className="py-20 flex flex-col items-center justify-center">
            <div className="w-8 h-8 border-4 border-gray-200 border-t-[#ff3b30] rounded-full animate-spin mb-3"></div>
            <p className="text-sm text-gray-400">Yuklanmoqda...</p>
          </div>
        ) : (
          <>
            {/* 1. STATISTIKA TAB */}
            {activeTab === 'stats' && (
              <div className="animate-in fade-in duration-300">
                {/* Filters */}
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-xl font-bold text-gray-900">Aktivlik monitoringi</h3>
                  <select 
                    value={timeRange} 
                    onChange={(e) => setTimeRange(e.target.value as any)}
                    className="bg-white border border-gray-200 rounded-xl px-4 py-2 text-xs font-semibold text-gray-700 focus:border-[#ff3b30] outline-none shadow-sm cursor-pointer"
                  >
                    <option value="daily">Kunlik</option>
                    <option value="monthly">Oylik</option>
                    <option value="yearly">Yillik</option>
                    <option value="total">Jami</option>
                  </select>
                </div>

                {/* Scorecards */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                  <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100 flex items-center gap-5">
                    <div className="w-12 h-12 bg-red-50 rounded-2xl flex items-center justify-center text-[#ff3b30]">
                      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider">Yuklangan videolar soni</p>
                      <p className="text-2xl font-bold text-gray-900 mt-1">{downloadCount}</p>
                    </div>
                  </div>
                  <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100 flex items-center gap-5">
                    <div className="w-12 h-12 bg-green-50 rounded-2xl flex items-center justify-center text-green-500">
                      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider">Yangi Ro'yxatdan o'tganlar</p>
                      <p className="text-2xl font-bold text-gray-900 mt-1">{registrationCount}</p>
                    </div>
                  </div>
                </div>

                {/* SVG Charts section */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  {/* Downloads Bar Chart */}
                  <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100">
                    <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-6">Yuklanishlar Grafigi</h4>
                    <div className="h-64 w-full flex items-end justify-between px-2 relative">
                      {activityData.map((d, idx) => {
                        const pct = (d.downloads / maxDownloads) * 160;
                        return (
                          <div key={idx} className="flex flex-col items-center flex-1 group">
                            <div className="opacity-0 group-hover:opacity-100 absolute bottom-full mb-1 bg-gray-900 text-white text-[10px] px-2 py-1 rounded font-bold transition-opacity pointer-events-none">
                              {d.downloads} marta
                            </div>
                            <div 
                              className="w-4 sm:w-5 bg-[#ff3b30] hover:bg-[#e6352b] transition-all"
                              style={{ height: `${Math.max(pct, 4)}px` }}
                            />
                            <span className="text-[10px] text-gray-400 font-medium mt-2.5 truncate w-full text-center">{d.label}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Registrations Line Chart */}
                  <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100">
                    <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-6">Foydalanuvchilar Ro'yxatdan o'tishi</h4>
                    <div className="h-64 w-full flex items-end justify-between px-2 relative">
                      {activityData.map((d, idx) => {
                        const pct = (d.registrations / maxRegs) * 160;
                        return (
                          <div key={idx} className="flex flex-col items-center flex-1 group">
                            <div className="opacity-0 group-hover:opacity-100 absolute bottom-full mb-1 bg-gray-900 text-white text-[10px] px-2 py-1 rounded font-bold transition-opacity pointer-events-none">
                              {d.registrations} user
                            </div>
                            <div 
                              className="w-4 sm:w-5 bg-green-500 hover:bg-green-600 transition-all"
                              style={{ height: `${Math.max(pct, 4)}px` }}
                            />
                            <span className="text-[10px] text-gray-400 font-medium mt-2.5 truncate w-full text-center">{d.label}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 2. USERLAR TAB */}
            {activeTab === 'users' && (
              <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100 animate-in fade-in duration-300">
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-xl font-bold text-gray-900 font-sans">Foydalanuvchilar ({users.length})</h3>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 text-gray-400 text-xs font-semibold uppercase tracking-wider">
                        <th className="pb-4 font-semibold">Tizim / Ism / Identifikator</th>
                        <th className="pb-4 font-semibold">Tarif Plan</th>
                        <th className="pb-4 font-semibold">Kunlik yuklashlar</th>
                        <th className="pb-4 font-semibold text-right">Amallar</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {users.map((usr: any) => (
                        <tr key={usr.uid} className="hover:bg-gray-50/50 transition-colors">
                          <td className="py-4">
                            <div className="font-semibold text-gray-900 flex items-center gap-2">
                              {usr.displayName || 'User'}
                              <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${
                                usr.platform === 'telegram' ? 'bg-blue-50 text-blue-500' : 'bg-gray-100 text-gray-500'
                              }`}>
                                {usr.platform || 'web'}
                              </span>
                            </div>
                            {usr.platform === 'telegram' ? (
                              <div className="text-xs text-gray-400 font-medium mt-0.5">
                                Telegram: @{usr.username || 'username'} | UUID: {usr.uid}
                              </div>
                            ) : (
                              <div className="text-xs text-gray-400 font-medium mt-0.5">{usr.email || '—'}</div>
                            )}
                          </td>
                          <td className="py-4 font-medium capitalize">
                            <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                              usr.plan === 'max' 
                                ? 'bg-purple-50 text-purple-600' 
                                : usr.plan === 'pro' 
                                  ? 'bg-red-50 text-[#ff3b30]' 
                                  : 'bg-gray-100 text-gray-600'
                            }`}>
                              {usr.plan || 'free'}
                            </span>
                          </td>
                          <td className="py-4 font-medium text-gray-700">{usr.dailyDownloads || 0} ta</td>
                          <td className="py-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button 
                                onClick={() => handleEditUserClick(usr)}
                                className="p-2 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-full transition-all"
                              >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                </svg>
                              </button>
                              <button 
                                onClick={() => handleDeleteUser(usr.uid)}
                                disabled={actionLoading === usr.uid}
                                className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-all"
                              >
                                {actionLoading === usr.uid ? (
                                  <span className="w-4 h-4 border-2 border-red-500/20 border-t-red-500 rounded-full animate-spin inline-block" />
                                ) : (
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                )}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* 3. TO'LOVLAR TAB */}
            {activeTab === 'payments' && (
              <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100 animate-in fade-in duration-300">
                <h3 className="text-xl font-bold text-gray-900 mb-6">Kelib tushgan to'lov cheklari ({payments.filter(p => p.status === 'pending').length} kutilmoqda)</h3>

                {payments.length === 0 ? (
                  <div className="text-center py-12 text-gray-400 text-sm">To'lovlar haqida so'rovlar mavjud emas.</div>
                ) : (
                  <div className="flex flex-col gap-4">
                    {payments.map((p: any) => (
                      <div key={p.id} className="border border-gray-100 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:border-gray-200 transition-all">
                        {/* Left Side: User Info */}
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-[#ff3b30] to-[#ff9f0a] flex items-center justify-center text-white text-sm font-bold shrink-0">
                            {p.userPhotoURL ? (
                              <img src={p.userPhotoURL} alt="" className="w-full h-full object-cover rounded-full" />
                            ) : (
                              <span>{(p.userDisplayName || 'U').charAt(0).toUpperCase()}</span>
                            )}
                          </div>
                          <div>
                            <div className="font-semibold text-gray-900 flex items-center gap-2">
                              {p.userDisplayName}
                              <span className="bg-gray-100 text-gray-500 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase">{p.plan}</span>
                              <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${
                                p.platform === 'telegram' ? 'bg-blue-50 text-blue-500' : 'bg-gray-100 text-gray-500'
                              }`}>
                                {p.platform || 'web'}
                              </span>
                            </div>
                            <div className="text-xs text-gray-400 font-medium mt-0.5">
                              {p.platform === 'telegram' ? `Telegram UUID: ${p.userId}` : p.userEmail}
                            </div>
                          </div>
                        </div>

                        {/* Right Side: Actions */}
                        <div className="flex items-center gap-3 self-end sm:self-auto">
                          <div className="text-right hidden md:block mr-2">
                            <p className="text-xs text-gray-400 font-medium">To'langan miqdor</p>
                            <p className="text-sm font-bold text-gray-900">${p.amount}</p>
                          </div>
                          <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                            p.status === 'confirmed' 
                              ? 'bg-green-50 text-green-600'
                              : p.status === 'rejected'
                                ? 'bg-red-50 text-red-600'
                                : 'bg-yellow-50 text-yellow-600'
                          }`}>
                            {p.status === 'confirmed' ? 'Tasdiqlandi' : p.status === 'rejected' ? 'Rad etildi' : 'Kutilmoqda'}
                          </span>

                          <button 
                            onClick={() => {
                              setViewingUserDetail(p);
                              setIsUserDetailModalOpen(true);
                            }}
                            className="p-2 text-gray-400 hover:text-gray-950 hover:bg-gray-50 rounded-full transition-all border border-gray-100"
                            title="Foydalanuvchi ma'lumoti"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                          </button>

                          <button 
                            onClick={() => {
                              setSelectedReceipt(p);
                              setIsReceiptModalOpen(true);
                            }}
                            className="bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold px-4 py-2 rounded-full transition-all"
                          >
                            Chekni ko'rish
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 4. SOZLAMALAR TAB */}
            {activeTab === 'settings' && (
              <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100 animate-in fade-in duration-300">
                <h3 className="text-xl font-bold text-gray-900 mb-6">Tizim Sozlamalari (CRUD)</h3>

                <form onSubmit={handleSaveSettings} className="flex flex-col gap-6 max-w-2xl">
                  
                  {/* Telegram Bot Token Config */}
                  <div className="border-b border-gray-100 pb-6">
                    <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Telegram Bot Token</label>
                    <input 
                      type="text" 
                      value={settings.telegramBotToken || ''}
                      onChange={(e) => setSettings({ ...settings, telegramBotToken: e.target.value })}
                      placeholder="Telegram Bot Father-dan olingan token"
                      className="w-full h-11 bg-gray-50 border border-gray-200 rounded-xl px-4 outline-none focus:border-[#ff3b30] text-sm font-semibold text-gray-900"
                    />
                    <p className="text-[10px] text-gray-400 mt-1">Bot orqali to'lov holatini foydalanuvchiga yuborish uchun to'g'ri token kiritilishi shart.</p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Karta raqami (To'lov uchun)</label>
                      <input 
                        type="text" 
                        value={settings.cardNumber}
                        onChange={(e) => setSettings({ ...settings, cardNumber: e.target.value })}
                        className="w-full h-11 bg-gray-50 border border-gray-200 rounded-xl px-4 outline-none focus:border-[#ff3b30] text-sm font-semibold text-gray-900"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Karta Egasi (Ism Familiya)</label>
                      <input 
                        type="text" 
                        value={settings.cardHolder}
                        onChange={(e) => setSettings({ ...settings, cardHolder: e.target.value })}
                        className="w-full h-11 bg-gray-50 border border-gray-200 rounded-xl px-4 outline-none focus:border-[#ff3b30] text-sm font-semibold text-gray-900"
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">To'lov ko'rsatmasi / O'rgatish qismi</label>
                    <textarea 
                      rows={3}
                      value={settings.paymentInstructions}
                      onChange={(e) => setSettings({ ...settings, paymentInstructions: e.target.value })}
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl p-4 outline-none focus:border-[#ff3b30] text-sm font-medium text-gray-700 resize-none leading-relaxed"
                      required
                    />
                  </div>

                  <div className="border-t border-gray-100 pt-6">
                    <h4 className="text-sm font-semibold text-gray-900 mb-4">Tarif Narxlari va Tavsiflari</h4>
                    
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-4">
                      {/* Pro plan config */}
                      <div className="border border-gray-100 rounded-2xl p-4 bg-gray-50/50">
                        <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">PRO Plan Sozlamalari</p>
                        <div className="flex flex-col gap-3">
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-[10px] text-gray-400 font-semibold mb-1">Narxi ($)</label>
                              <input 
                                type="text" 
                                value={settings.proPrice}
                                onChange={(e) => setSettings({ ...settings, proPrice: e.target.value })}
                                className="w-full h-9 bg-white border border-gray-200 rounded-lg px-3 outline-none focus:border-[#ff3b30] text-sm font-semibold text-gray-900"
                                required
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] text-gray-400 font-semibold mb-1">Stars narxi (🌟)</label>
                              <input 
                                type="number" 
                                value={settings.proStarsPrice || ''}
                                onChange={(e) => setSettings({ ...settings, proStarsPrice: e.target.value })}
                                className="w-full h-9 bg-white border border-gray-200 rounded-lg px-3 outline-none focus:border-[#ff3b30] text-sm font-semibold text-gray-900"
                                required
                              />
                            </div>
                          </div>
                          <div>
                            <label className="block text-[10px] text-gray-400 font-semibold mb-1">Tavsifi (Qisqa)</label>
                            <input 
                              type="text" 
                              value={settings.proDescription}
                              onChange={(e) => setSettings({ ...settings, proDescription: e.target.value })}
                              className="w-full h-9 bg-white border border-gray-200 rounded-lg px-3 outline-none focus:border-[#ff3b30] text-sm text-gray-700"
                              required
                            />
                          </div>
                        </div>
                      </div>

                      {/* Max plan config */}
                      <div className="border border-gray-100 rounded-2xl p-4 bg-gray-50/50">
                        <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">MAX Plan Sozlamalari</p>
                        <div className="flex flex-col gap-3">
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-[10px] text-gray-400 font-semibold mb-1">Narxi ($)</label>
                              <input 
                                type="text" 
                                value={settings.maxPrice}
                                onChange={(e) => setSettings({ ...settings, maxPrice: e.target.value })}
                                className="w-full h-9 bg-white border border-gray-200 rounded-lg px-3 outline-none focus:border-[#ff3b30] text-sm font-semibold text-gray-900"
                                required
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] text-gray-400 font-semibold mb-1">Stars narxi (🌟)</label>
                              <input 
                                type="number" 
                                value={settings.maxStarsPrice || ''}
                                onChange={(e) => setSettings({ ...settings, maxStarsPrice: e.target.value })}
                                className="w-full h-9 bg-white border border-gray-200 rounded-lg px-3 outline-none focus:border-[#ff3b30] text-sm font-semibold text-gray-900"
                                required
                              />
                            </div>
                          </div>
                          <div>
                            <label className="block text-[10px] text-gray-400 font-semibold mb-1">Tavsifi (Qisqa)</label>
                            <input 
                              type="text" 
                              value={settings.maxDescription}
                              onChange={(e) => setSettings({ ...settings, maxDescription: e.target.value })}
                              className="w-full h-9 bg-white border border-gray-200 rounded-lg px-3 outline-none focus:border-[#ff3b30] text-sm text-gray-700"
                              required
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={actionLoading === 'save_settings'}
                    className="w-full sm:w-auto h-12 bg-[#ff3b30] hover:bg-[#e6352b] text-white rounded-full font-semibold text-sm px-8 transition-colors shadow-sm active:scale-98 flex items-center justify-center gap-2"
                  >
                    {actionLoading === 'save_settings' ? (
                      <>
                        <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Saqlanmoqda...
                      </>
                    ) : (
                      'Sozlamalarni saqlash'
                    )}
                  </button>
                </form>
              </div>
            )}
          </>
        )}
      </div>

      {/* Edit User Modal */}
      {isEditUserModalOpen && selectedUser && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white rounded-[32px] p-8 w-full max-w-sm relative shadow-2xl animate-in slide-in-from-bottom-4">
            <button 
              onClick={() => setIsEditUserModalOpen(false)}
              className="absolute top-6 right-6 text-gray-400 hover:text-gray-900"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <h3 className="text-xl font-bold text-gray-900 mb-6">Userni tahrirlash</h3>
            <form onSubmit={handleSaveUser} className="flex flex-col gap-4">
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Foydalanuvchi tarifi</label>
                <select 
                  value={editPlan}
                  onChange={(e) => setEditPlan(e.target.value)}
                  className="w-full h-11 bg-gray-50 border border-gray-200 rounded-xl px-4 outline-none text-sm font-semibold text-gray-900"
                >
                  <option value="free">Free (Bepul)</option>
                  <option value="pro">Pro</option>
                  <option value="max">Max</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Kunlik yuklashlar soni</label>
                <input 
                  type="number" 
                  value={editDailyDownloads}
                  onChange={(e) => setEditDailyDownloads(parseInt(e.target.value) || 0)}
                  className="w-full h-11 bg-gray-50 border border-gray-200 rounded-xl px-4 outline-none text-sm font-semibold text-gray-900"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={actionLoading === selectedUser.uid}
                className="w-full h-11 bg-[#ff3b30] hover:bg-[#e6352b] text-white rounded-full font-semibold text-sm mt-3 flex items-center justify-center gap-2"
              >
                {actionLoading === selectedUser.uid ? 'Saqlanmoqda...' : 'Saqlash'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* View Receipt Image Modal */}
      {isReceiptModalOpen && selectedReceipt && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white rounded-[32px] p-6 sm:p-8 w-full max-w-lg relative shadow-2xl animate-in slide-in-from-bottom-4 flex flex-col max-h-[90vh]">
            <button 
              onClick={() => setIsReceiptModalOpen(false)}
              className="absolute top-6 right-6 text-gray-400 hover:text-gray-900 z-10 bg-white/80 p-1.5 rounded-full backdrop-blur-sm"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            <h3 className="text-xl font-bold text-gray-900 mb-2">To'lov Cheki</h3>
            <p className="text-xs text-gray-400 mb-4">{selectedReceipt.userDisplayName} • Tarif: <span className="font-bold text-[#ff3b30] uppercase">{selectedReceipt.plan}</span></p>

            {/* Scrollable Receipt Image Container */}
            <div className="flex-1 overflow-y-auto rounded-2xl bg-gray-50 border border-gray-100 p-2 flex items-center justify-center mb-6">
              {selectedReceipt.receipt ? (
                <img 
                  src={selectedReceipt.receipt} 
                  alt="Receipt" 
                  className="max-h-[50vh] object-contain rounded-xl"
                />
              ) : (
                <p className="text-xs text-gray-400 py-10">Rasm topilmadi</p>
              )}
            </div>

            {/* Confirm / Reject Actions */}
            {selectedReceipt.status === 'pending' ? (
              <div className="flex items-center gap-3">
                <button
                  onClick={() => handleVerifyPayment(selectedReceipt, 'rejected')}
                  disabled={actionLoading === selectedReceipt.id}
                  className="flex-1 h-12 bg-red-50 hover:bg-red-100 active:scale-[0.98] text-red-600 font-semibold text-sm rounded-full transition-all"
                >
                  Rad etish
                </button>
                <button
                  onClick={() => handleVerifyPayment(selectedReceipt, 'confirmed')}
                  disabled={actionLoading === selectedReceipt.id}
                  className="flex-1 h-12 bg-[#ff3b30] hover:bg-[#e6352b] active:scale-[0.98] text-white font-semibold text-sm rounded-full transition-all flex items-center justify-center gap-2"
                >
                  {actionLoading === selectedReceipt.id ? (
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    'Tasdiqlash'
                  )}
                </button>
              </div>
            ) : (
              <div className="text-center text-xs font-bold py-2 uppercase tracking-wider text-gray-400">
                Ushbu to'lov allaqachon ko'rib chiqilgan: <span className={selectedReceipt.status === 'confirmed' ? 'text-green-500' : 'text-red-500'}>{selectedReceipt.status}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* User Details Modal (Eye icon) */}
      {isUserDetailModalOpen && viewingUserDetail && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white rounded-[32px] p-8 w-full max-w-md relative shadow-2xl animate-in slide-in-from-bottom-4">
            <button 
              onClick={() => setIsUserDetailModalOpen(false)}
              className="absolute top-6 right-6 text-gray-400 hover:text-gray-900"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            <h3 className="text-xl font-bold text-gray-900 mb-6">Foydalanuvchi Ma'lumotlari</h3>
            
            <div className="flex flex-col gap-4 text-sm text-gray-700">
              <div className="flex justify-between items-center pb-2.5 border-b border-gray-100">
                <span className="text-gray-400 font-medium">To'liq ism</span>
                <span className="font-semibold text-gray-900">{viewingUserDetail.userDisplayName}</span>
              </div>
              <div className="flex justify-between items-center pb-2.5 border-b border-gray-100">
                <span className="text-gray-400 font-medium">Tizim (Platforma)</span>
                <span className="font-semibold text-gray-900 uppercase">{viewingUserDetail.platform || 'web'}</span>
              </div>
              {viewingUserDetail.platform === 'telegram' ? (
                <div className="flex justify-between items-center pb-2.5 border-b border-gray-100">
                  <span className="text-gray-400 font-medium">Telegram ID (UUID)</span>
                  <span className="font-semibold text-gray-900">{viewingUserDetail.userId}</span>
                </div>
              ) : (
                <div className="flex justify-between items-center pb-2.5 border-b border-gray-100">
                  <span className="text-gray-400 font-medium">Email manzili</span>
                  <span className="font-semibold text-gray-900">{viewingUserDetail.userEmail}</span>
                </div>
              )}
              <div className="flex justify-between items-center pb-2.5 border-b border-gray-100">
                <span className="text-gray-400 font-medium">So'ralgan Plan</span>
                <span className="font-bold text-[#ff3b30] uppercase">{viewingUserDetail.plan}</span>
              </div>
              <div className="flex justify-between items-center pb-2.5 border-b border-gray-100">
                <span className="text-gray-400 font-medium">To'lov miqdori</span>
                <span className="font-bold text-gray-900">${viewingUserDetail.amount}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400 font-medium">Yuborilgan sana</span>
                <span className="font-medium text-gray-500">
                  {viewingUserDetail.createdAt?.seconds 
                    ? new Date(viewingUserDetail.createdAt.seconds * 1000).toLocaleString('uz-UZ')
                    : '—'}
                </span>
              </div>
            </div>

            <button
              onClick={() => setIsUserDetailModalOpen(false)}
              className="w-full h-11 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-full mt-6 text-sm"
            >
              Yopish
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
