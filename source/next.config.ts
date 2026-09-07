import type { NextConfig } from 'next';

const nextConfig: NextConfig = process.env.LAB_MAINLAND === '1' ? { output: 'standalone' } : {};

export default nextConfig;
