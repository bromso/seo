import bundleAnalyzer from "@next/bundle-analyzer"
import withSerwistInit from "@serwist/next"
import type { NextConfig } from "next"

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
})

const nextConfig: NextConfig = {
  // Empty turbopack config to allow Serwist webpack config alongside Turbopack
  turbopack: {},
  // Enable source maps for bundle analysis
  productionBrowserSourceMaps: process.env.ANALYZE === "true",
  // Modularize imports for better tree-shaking
  modularizeImports: {
    "@iconify/react": {
      transform: "@iconify/react",
      skipDefaultConversion: true,
    },
    "react-icons": {
      transform: "react-icons/{{member}}",
    },
  },
  // Compiler optimizations
  compiler: {
    // Remove console.log in production
    removeConsole: process.env.NODE_ENV === "production",
  },
  // Webpack optimizations for better chunk splitting
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.optimization = {
        ...config.optimization,
        splitChunks: {
          ...config.optimization.splitChunks,
          cacheGroups: {
            ...config.optimization.splitChunks?.cacheGroups,
            // Separate motion into its own chunk (heavy animation library)
            motion: {
              test: /[\\/]node_modules[\\/]motion[\\/]/,
              name: "motion",
              chunks: "all",
              priority: 30,
            },
            // Separate radix-ui into its own chunk
            radix: {
              test: /[\\/]node_modules[\\/]@radix-ui[\\/]/,
              name: "radix",
              chunks: "all",
              priority: 30,
            },
          },
        },
      }
    }
    return config
  },
}

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
})

export default withBundleAnalyzer(withSerwist(nextConfig))
