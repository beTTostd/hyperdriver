import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingIncludes: {
    "/*": ["./lib/decision-analysis-process.mjs", "./lib/decision-analysis-core.js", "./lib/decision-card-catalog.js", "./lib/decision-turn-search.js",
      "./lib/decision-opponent-knowledge.js", "./lib/decision-opponent-model.js", "./lib/decision-information-search.js", "./lib/decision-learning.js"],
  },
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
