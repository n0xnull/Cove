/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,

  // Leaflet uses browser globals — prevent SSR crash
  transpilePackages: ['leaflet'],

  // Allow leaflet CDN images
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'cdnjs.cloudflare.com',
      },
    ],
  },

  webpack: (config, { isServer }) => {
    // Leaflet relies on browser globals (window/document); exclude from SSR bundle
    if (isServer) {
      config.externals = [...(config.externals || []), 'leaflet'];
    }
    return config;
  },
};

module.exports = nextConfig;
