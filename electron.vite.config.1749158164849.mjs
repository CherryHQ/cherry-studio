// electron.vite.config.ts
import react from "@vitejs/plugin-react-swc";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { resolve } from "path";
import { visualizer } from "rollup-plugin-visualizer";
var __electron_vite_injected_dirname = "J:\\Cherry\\CherryStudio-fire";
var visualizerPlugin = (type) => {
  return process.env[`VISUALIZER_${type.toUpperCase()}`] ? [visualizer({ open: true })] : [];
};
var electron_vite_config_default = defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({
        exclude: [
          "@cherrystudio/embedjs",
          "@cherrystudio/embedjs-openai",
          "@cherrystudio/embedjs-loader-web",
          "@cherrystudio/embedjs-loader-markdown",
          "@cherrystudio/embedjs-loader-msoffice",
          "@cherrystudio/embedjs-loader-xml",
          "@cherrystudio/embedjs-loader-pdf",
          "@cherrystudio/embedjs-loader-sitemap",
          "@cherrystudio/embedjs-libsql",
          "@cherrystudio/embedjs-loader-image",
          "p-queue",
          "webdav"
        ]
      }),
      ...visualizerPlugin("main")
    ],
    resolve: {
      alias: {
        "@main": resolve("src/main"),
        "@types": resolve("src/renderer/src/types"),
        "@shared": resolve("packages/shared")
      }
    },
    build: {
      rollupOptions: {
        external: ["@libsql/client"]
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        "@shared": resolve("packages/shared")
      }
    }
  },
  renderer: {
    plugins: [
      react({
        plugins: [
          [
            "@swc/plugin-styled-components",
            {
              displayName: true,
              // 开发环境下启用组件名称
              fileName: false,
              // 不在类名中包含文件名
              pure: true,
              // 优化性能
              ssr: false
              // 不需要服务端渲染
            }
          ]
        ]
      }),
      ...visualizerPlugin("renderer")
    ],
    resolve: {
      alias: {
        "@renderer": resolve("src/renderer/src"),
        "@shared": resolve("packages/shared")
      }
    },
    optimizeDeps: {
      exclude: ["pyodide"]
    },
    worker: {
      format: "es"
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__electron_vite_injected_dirname, "src/renderer/index.html"),
          miniWindow: resolve(__electron_vite_injected_dirname, "src/renderer/miniWindow.html")
        },
        output: {
          manualChunks: (id) => {
            if (id.includes(".worker") && id.endsWith("?worker")) {
              const workerName = id.split("/").pop()?.split(".")[0] || "worker";
              return `workers/${workerName}`;
            }
            return void 0;
          }
        }
      }
    }
  }
});
export {
  electron_vite_config_default as default
};
