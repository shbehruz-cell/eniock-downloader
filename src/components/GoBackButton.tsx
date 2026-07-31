'use client';

import React from 'react';
import { useRouter } from 'next/navigation';

export default function GoBackButton() {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        if (window.history.length > 2) {
          router.back();
        } else {
          router.push('/');
        }
      }}
      className="flex items-center gap-2 px-4 py-2 rounded-full bg-black/5 hover:bg-black/10 text-black/80 font-medium text-sm transition-all duration-300 ease-[cubic-bezier(0.25,0.46,0.45,0.94)] hover:-translate-x-1 active:translate-x-0"
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
      </svg>
      Go Back
    </button>
  );
}
