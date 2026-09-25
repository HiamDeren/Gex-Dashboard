import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // a stray package-lock.json in the user's home dir otherwise makes Turbopack guess the wrong root
  turbopack: { root: import.meta.dirname },
};

export default nextConfig;
