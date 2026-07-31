import React from 'react';

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  color?: string;
  text?: string;
}

export default function LoadingSpinner({ size = 'md', color = 'text-black', text }: LoadingSpinnerProps) {
  const sizeClasses = {
    sm: 'w-5 h-5 border-2',
    md: 'w-8 h-8 border-3',
    lg: 'w-12 h-12 border-4',
  };

  return (
    <div className="flex flex-col items-center justify-center gap-3">
      <div 
        className={`${sizeClasses[size]} rounded-full border-t-transparent animate-spin ${color}`}
        style={{ borderColor: 'currentColor', borderTopColor: 'transparent' }}
      />
      {text && (
        <span className="text-sm font-medium text-black/60 animate-pulse">{text}</span>
      )}
    </div>
  );
}
