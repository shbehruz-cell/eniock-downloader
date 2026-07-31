'use client';

import React, { useState, useRef, useEffect } from 'react';
import { COUNTRIES } from '@/lib/countries';

interface CountryCodeSelectorProps {
  value: string; // The dial code e.g. "+1"
  onChange: (code: string) => void;
}

export default function CountryCodeSelector({ value, onChange }: CountryCodeSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedCountry = COUNTRIES.find(c => c.dialCode === value) || COUNTRIES[0];

  const filteredCountries = COUNTRIES.filter(country => 
    country.name.toLowerCase().includes(search.toLowerCase()) || 
    country.dialCode.includes(search)
  );

  useEffect(() => {
    const handleClickOutside = (event: Event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    
    // Faqat click hodisasida dropdown tashqarisini yopish
    document.addEventListener('click', handleClickOutside);
    
    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, []);

  const toggleDropdown = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsOpen(prev => !prev);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={toggleDropdown}
        className="flex items-center gap-1.5 h-[56px] px-3 bg-black/5 hover:bg-black/10 active:bg-black/15 rounded-2xl transition-all duration-300 border border-transparent focus:border-black/20 outline-none select-none touch-manipulation"
      >
        <span className="text-lg">{selectedCountry?.flag}</span>
        <span className="font-semibold text-sm text-black">{selectedCountry?.dialCode}</span>
        <svg className={`w-3.5 h-3.5 text-black/60 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-2 w-64 bg-white border border-black/10 shadow-xl rounded-2xl z-50 overflow-hidden transform origin-top transition-all duration-300">
          <div className="p-2 border-b border-black/5 bg-white">
            <input
              type="text"
              placeholder="Search country..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-10 px-3 bg-black/5 rounded-xl outline-none text-sm font-medium transition-all focus:bg-black/10 focus:ring-2 focus:ring-black/20"
              autoFocus
            />
          </div>
          <div className="max-h-56 overflow-y-auto p-2 scrollbar-thin scrollbar-thumb-black/10">
            {filteredCountries.map((country, idx) => (
              <button
                key={`${country.code}_${idx}`}
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  onChange(country.dialCode);
                  setIsOpen(false);
                  setSearch('');
                }}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-left transition-colors ${
                  value === country.dialCode ? 'bg-black/5 text-black font-semibold' : 'hover:bg-black/5 text-black/80'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <span className="text-lg">{country.flag}</span>
                  <span className="text-xs truncate max-w-[130px]">{country.name}</span>
                </div>
                <span className="text-xs text-black/50 font-medium">{country.dialCode}</span>
              </button>
            ))}
            {filteredCountries.length === 0 && (
              <div className="p-4 text-center text-xs text-black/50">
                No countries found
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
