export function getPlatformFromURL(url: string): string | null {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();

    if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) {
      return 'youtube';
    }
    if (hostname.includes('instagram.com')) {
      return 'instagram';
    }
    if (hostname.includes('tiktok.com')) {
      return 'tiktok';
    }
    if (hostname.includes('facebook.com') || hostname.includes('fb.watch')) {
      return 'facebook';
    }
    if (hostname.includes('pinterest.com') || hostname.includes('pin.it')) {
      return 'pinterest';
    }
    if (hostname.includes('xiaohongshu.com')) {
      return 'rednote';
    }

    return 'general';
  } catch (error) {
    return null; // Invalid URL
  }
}

export function validateURL(url: string): { valid: boolean; platform: string | null } {
  const platform = getPlatformFromURL(url);
  return {
    valid: platform !== null,
    platform,
  };
}

export function validatePhoneNumber(phone: string): boolean {
  // Simple validation for phone numbers: Allows optional '+' at the start, followed by digits, spaces, dashes
  const phoneRegex = /^\+?[0-9\s\-()]{7,20}$/;
  return phoneRegex.test(phone);
}

export function validatePassword(password: string): { valid: boolean; message: string } {
  if (password.length < 8) {
    return { valid: false, message: 'Password must be at least 8 characters long.' };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one uppercase letter.' };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one number.' };
  }
  return { valid: true, message: '' };
}

export function sanitizeInput(input: string): string {
  // Simple sanitation to prevent basic XSS
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}
