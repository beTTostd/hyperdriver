import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  allowedDevOrigins: ["beta.hyperdriver.com.br"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.talishar.net",
        pathname: "/public/**",
      },
    ],
  },
};

export default nextConfig;
