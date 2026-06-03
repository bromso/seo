import bundleAnalyzer from "@next/bundle-analyzer"
import withSerwistInit from "@serwist/next"

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
})

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
})

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  transpilePackages: ["@repo/ui"],
  // Empty turbopack config to allow Serwist webpack config alongside Turbopack
  turbopack: {},
  // Enable source maps for production analysis
  productionBrowserSourceMaps: process.env.ANALYZE === "true",
  // Tree-shaking optimizations
  modularizeImports: {
    "@iconify/react": {
      transform: "@iconify/react",
      skipDefaultConversion: true,
    },
    "date-fns": {
      transform: "date-fns/{{member}}",
    },
  },
  // Compiler optimizations
  compiler: {
    removeConsole: process.env.NODE_ENV === "production",
  },
  // Webpack optimizations for chunk splitting
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.optimization = {
        ...config.optimization,
        splitChunks: {
          ...config.optimization.splitChunks,
          cacheGroups: {
            ...config.optimization.splitChunks?.cacheGroups,
            // Separate recharts into its own chunk
            recharts: {
              test: /[\\/]node_modules[\\/](recharts|d3-.*)[\\/]/,
              name: "recharts",
              chunks: "all",
              priority: 30,
            },
            // Separate dnd-kit into its own chunk
            dndkit: {
              test: /[\\/]node_modules[\\/]@dnd-kit[\\/]/,
              name: "dndkit",
              chunks: "all",
              priority: 30,
            },
            // Separate tanstack-table into its own chunk
            tanstack: {
              test: /[\\/]node_modules[\\/]@tanstack[\\/]/,
              name: "tanstack",
              chunks: "all",
              priority: 30,
            },
          },
        },
      }
    }
    return config
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "i.pravatar.cc",
      },
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      {
        protocol: "https",
        hostname: "plus.unsplash.com",
      },
      {
        protocol: "https",
        hostname: "images.pexels.com",
      },
      {
        protocol: "https",
        hostname: "picsum.photos",
      },
      {
        protocol: "https",
        hostname: "ui.shadcn.com",
      },
    ],
  },
}

export default withBundleAnalyzer(withSerwist(nextConfig))
