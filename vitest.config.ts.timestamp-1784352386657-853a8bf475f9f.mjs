// vitest.config.ts
import { defineConfig } from "file:///sessions/inspiring-amazing-dijkstra/mnt/doc-forge/node_modules/vitest/dist/config.js";
import tsconfigPaths from "file:///sessions/inspiring-amazing-dijkstra/mnt/doc-forge/node_modules/vite-tsconfig-paths/dist/index.js";
var vitest_config_default = defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: false,
    environment: "node",
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "apps/vscode-extension/**"],
    coverage: {
      provider: "v8",
      include: ["packages/**/src/**/*.ts"],
      exclude: ["**/*.test.ts", "packages/testing/**"]
    }
  }
});
export {
  vitest_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZXN0LmNvbmZpZy50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiY29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2Rpcm5hbWUgPSBcIi9zZXNzaW9ucy9pbnNwaXJpbmctYW1hemluZy1kaWprc3RyYS9tbnQvZG9jLWZvcmdlXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCIvc2Vzc2lvbnMvaW5zcGlyaW5nLWFtYXppbmctZGlqa3N0cmEvbW50L2RvYy1mb3JnZS92aXRlc3QuY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9zZXNzaW9ucy9pbnNwaXJpbmctYW1hemluZy1kaWprc3RyYS9tbnQvZG9jLWZvcmdlL3ZpdGVzdC5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd2aXRlc3QvY29uZmlnJztcbmltcG9ydCB0c2NvbmZpZ1BhdGhzIGZyb20gJ3ZpdGUtdHNjb25maWctcGF0aHMnO1xuXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoe1xuICBwbHVnaW5zOiBbdHNjb25maWdQYXRocygpXSxcbiAgdGVzdDoge1xuICAgIGdsb2JhbHM6IGZhbHNlLFxuICAgIGVudmlyb25tZW50OiAnbm9kZScsXG4gICAgaW5jbHVkZTogWydwYWNrYWdlcy8qKi8qLnRlc3QudHMnLCAnYXBwcy8qKi8qLnRlc3QudHMnXSxcbiAgICBleGNsdWRlOiBbJyoqL25vZGVfbW9kdWxlcy8qKicsICcqKi9kaXN0LyoqJywgJ2FwcHMvdnNjb2RlLWV4dGVuc2lvbi8qKiddLFxuICAgIGNvdmVyYWdlOiB7XG4gICAgICBwcm92aWRlcjogJ3Y4JyxcbiAgICAgIGluY2x1ZGU6IFsncGFja2FnZXMvKiovc3JjLyoqLyoudHMnXSxcbiAgICAgIGV4Y2x1ZGU6IFsnKiovKi50ZXN0LnRzJywgJ3BhY2thZ2VzL3Rlc3RpbmcvKionXVxuICAgIH1cbiAgfVxufSk7XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQTRVLFNBQVMsb0JBQW9CO0FBQ3pXLE9BQU8sbUJBQW1CO0FBRTFCLElBQU8sd0JBQVEsYUFBYTtBQUFBLEVBQzFCLFNBQVMsQ0FBQyxjQUFjLENBQUM7QUFBQSxFQUN6QixNQUFNO0FBQUEsSUFDSixTQUFTO0FBQUEsSUFDVCxhQUFhO0FBQUEsSUFDYixTQUFTLENBQUMseUJBQXlCLG1CQUFtQjtBQUFBLElBQ3RELFNBQVMsQ0FBQyxzQkFBc0IsY0FBYywwQkFBMEI7QUFBQSxJQUN4RSxVQUFVO0FBQUEsTUFDUixVQUFVO0FBQUEsTUFDVixTQUFTLENBQUMseUJBQXlCO0FBQUEsTUFDbkMsU0FBUyxDQUFDLGdCQUFnQixxQkFBcUI7QUFBQSxJQUNqRDtBQUFBLEVBQ0Y7QUFDRixDQUFDOyIsCiAgIm5hbWVzIjogW10KfQo=
