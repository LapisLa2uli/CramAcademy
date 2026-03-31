/** @type {import('next').NextConfig} */
const backendProxyTarget =
  process.env.BACKEND_PROXY_TARGET || "http://127.0.0.1:8000";

const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: "/backend-api/:path*",
        destination: `${backendProxyTarget.replace(/\/$/, "")}/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
