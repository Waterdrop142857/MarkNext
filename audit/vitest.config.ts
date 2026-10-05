import viteConfig from "../vite.config";

export default async (environment: Parameters<typeof viteConfig>[0]) => ({
  ...await viteConfig(environment),
  test: { include: ["audit/repros.ts"], environment: "happy-dom" },
});
