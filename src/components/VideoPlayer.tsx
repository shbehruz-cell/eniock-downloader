'use client';

import React, { useRef, useState } from 'react';

interface VideoPlayerProps {
  url: string;
  thumbnail?: string;
  title?: string;
}

export default function VideoPlayer({ url, thumbnail, title }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasError, setHasError] = useState(false);

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  if (hasError && thumbnail) {
    return (
      <div className="relative w-full aspect-video rounded-[2rem] overflow-hidden bg-black/5 border border-black/10 shadow-sm">
        <img src={thumbnail} alt={title || "Video thumbnail"} className="w-full h-full object-cover" />
        <div className="absolute inset-0 flex items-center justify-center bg-black/20">
          <span className="bg-white/80 backdrop-blur-md px-4 py-2 rounded-full text-sm font-medium text-black">Video unavailable</span>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full aspect-video rounded-[2rem] overflow-hidden bg-black/5 group border border-black/10 shadow-sm transition-all duration-300 ease-[cubic-bezier(0.25,0.46,0.45,0.94)] hover:shadow-md">
      <video
        ref={videoRef}
        src={url}
        poster={thumbnail}
        className="w-full h-full object-cover"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onError={() => setHasError(true)}
        controlsList="nodownload"
        title={title}
      />
      <div className="absolute bottom-4 left-4 right-4 flex items-center gap-4 bg-white/70 backdrop-blur-xl px-4 py-3 rounded-full opacity-0 group-hover:opacity-100 transition-all duration-300 ease-[cubic-bezier(0.25,0.46,0.45,0.94)] transform translate-y-2 group-hover:translate-y-0">
        <button 
          onClick={togglePlay}
          className="w-10 h-10 rounded-full bg-white flex items-center justify-center text-black shadow-sm transition-all hover:scale-105 active:scale-95"
        >
          {isPlaying ? (
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
          ) : (
            <svg className="w-5 h-5 ml-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
            </svg>
          )}
        </button>
        <div className="flex-1">
          <div className="h-1.5 w-full bg-black/10 rounded-full overflow-hidden">
            <div className="h-full bg-black w-1/3 rounded-full"></div>
          </div>
        </div>
      </div>
    </div>
  );
}
