'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';

export default function Header() {
  const { user } = useAuth();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ease-[cubic-bezier(0.25,0.46,0.45,0.94)] flex items-center justify-between px-6 h-16 ${
        scrolled ? 'backdrop-blur-xl bg-white/70 shadow-sm border-b border-black/5' : 'bg-transparent'
      }`}
    >
      <Link href="/" className="flex items-center gap-2 group transition-all duration-300 ease-[cubic-bezier(0.25,0.46,0.45,0.94)] hover:opacity-80">
        <span className="font-bold text-xl text-black">Eniock</span>
        <span className="bg-[#ff3b30] text-white text-sm font-semibold rounded-full px-3 py-1">Downloader</span>
      </Link>

      <div className="flex items-center gap-2 sm:gap-4">
        <Link
          href="/pricing"
          className="px-3 py-1.5 sm:px-5 sm:py-2 rounded-full font-medium text-xs sm:text-sm bg-white border border-black/10 text-black shadow-sm transition-all duration-300 ease-[cubic-bezier(0.25,0.46,0.45,0.94)] hover:-translate-y-0.5 hover:shadow-md active:translate-y-0"
        >
          Upgrade
        </Link>
        
        {user ? (
          <Link
            href="/account"
            className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-black/5 border border-black/10 overflow-hidden flex items-center justify-center transition-all duration-300 ease-[cubic-bezier(0.25,0.46,0.45,0.94)] hover:scale-105 active:scale-95"
          >
            {user.photoURL ? (
              <img src={user.photoURL} alt="User" className="w-full h-full object-cover" />
            ) : (
              <svg className="w-4 h-4 sm:w-5 sm:h-5 text-black/60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            )}
          </Link>
        ) : (
          <Link
            href="/auth"
            className="px-3 py-1.5 sm:px-5 sm:py-2 rounded-full font-medium text-xs sm:text-sm bg-black text-white transition-all duration-300 ease-[cubic-bezier(0.25,0.46,0.45,0.94)] hover:-translate-y-0.5 hover:shadow-md hover:bg-black/90 active:translate-y-0"
          >
            Sign In
          </Link>
        )}
      </div>
    </header>
  );
}
