import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: ["beta.hyperdriver.com.br"],
};

export default nextConfig;
