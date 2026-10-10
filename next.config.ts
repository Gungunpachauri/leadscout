import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // libSQL ships native bindings and non-JS files; load it from node_modules at runtime.
  serverExternalPackages: ["@libsql/client", "libsql"],
};

export default nextConfig;
