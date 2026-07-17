import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  allowedDevOrigins: ["0.0.0.0", "127.0.0.1", "localhost", "::1"],
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "exil.club",
      },
      {
        protocol: "https",
        hostname: "maexzuerich.com",
      },
      {
        protocol: "https",
        hostname: "supermarket.li",
      },
      {
        protocol: "https",
        hostname: "www.ticketcorner.ch",
      },
      {
        protocol: "https",
        hostname: "www.plaza-zurich.ch",
      },
    ],
  },
};

export default nextConfig;
