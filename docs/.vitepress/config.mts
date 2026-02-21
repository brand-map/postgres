import { defineConfig } from "vitepress"

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "@brand-map/postgres",
  description: "Zero-Abstraction Postgres for TypeScript",
  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: "Overview", link: "/overview" },
      { text: "Getting Started", link: "/getting-started" },
      { text: "Bun", link: "/bun/" },
      { text: "pg", link: "/pg/" },
      { text: "SQL Core", link: "/sql-and-fragments" },
      { text: "Joins", link: "/joins-and-shortcuts" },
      { text: "Transactions", link: "/transactions" }
    ],

    sidebar: [
      {
        text: "Start",
        items: [
          { text: "Docs Home", link: "/" },
          { text: "Overview", link: "/overview" },
          { text: "Getting Started", link: "/getting-started" },
          { text: "Client Matrix", link: "/database-clients" },
          { text: "About", link: "/about" }
        ]
      },
      {
        text: "Bun",
        items: [
          { text: "Bun Overview", link: "/bun/" },
          { text: "Bun Runtime API", link: "/bun/runtime" },
          { text: "Bun Generation API", link: "/bun/generate" }
        ]
      },
      {
        text: "pg",
        items: [
          { text: "pg Overview", link: "/pg/" },
          { text: "pg Runtime API", link: "/pg/runtime" },
          { text: "pg Generation API", link: "/pg/generate" }
        ]
      },
      {
        text: "Core Querying",
        items: [
          { text: "SQL And Fragments", link: "/sql-and-fragments" },
          { text: "Joins And Shortcuts", link: "/joins-and-shortcuts" },
          { text: "Transactions", link: "/transactions" },
          { text: "Errors", link: "/errors" },
          { text: "Utility Types", link: "/utility-types" },
          { text: "Run-time Configuration", link: "/runtime-configuration" }
        ]
      },
      {
        text: "Examples",
        items: [
          { text: "Runtime API", link: "/api-examples" },
          { text: "Generator Config", link: "/markdown-examples" }
        ]
      }
    ],

    socialLinks: [{ icon: "github", link: "https://github.com/brand-map/postgres" }]
  }
})
