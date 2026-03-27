<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>

<style>
*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

:root {
  --color-bg: #0f1117;
  --color-bg-secondary: #1a1b23;
  --color-bg-tertiary: #22232d;
  --color-border: #2e2f3a;
  --color-text: #e4e4e7;
  --color-text-secondary: #a1a1aa;
  --color-text-muted: #71717a;
  --color-primary: #6366f1;
  --color-primary-hover: #818cf8;
  --color-primary-bg: rgba(99, 102, 241, 0.1);
  --color-danger: #ef4444;
  --color-success: #22c55e;
  --color-warning: #f59e0b;
  --color-user-bubble: #6366f1;
  --color-assistant-bubble: #1e1f2a;
  --color-system-bubble: #1a1b23;
  --sidebar-width: 260px;
  --header-height: 56px;
  --font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}

html, body {
  height: 100%;
  font-family: var(--font-family);
  background-color: var(--color-bg);
  color: var(--color-text);
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

#__nuxt {
  height: 100%;
}

a {
  color: var(--color-primary);
  text-decoration: none;
}

a:hover {
  color: var(--color-primary-hover);
}

button {
  cursor: pointer;
  font-family: inherit;
}

input {
  font-family: inherit;
}
</style>
