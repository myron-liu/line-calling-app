/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Consume @shared/game-rules TS source directly from the workspace.
  transpilePackages: ["@shared/game-rules"],
  // Self-contained server bundle for Docker (see apps/web/Dockerfile).
  output: "standalone",
};

export default nextConfig;
