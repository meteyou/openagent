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
  --color-bg: #0b1020;
  --color-bg-secondary: #12182a;
  --color-bg-tertiary: #1a2237;
  --color-border: #27314a;
  --color-text: #e8ecf8;
  --color-text-secondary: #b2bccf;
  --color-text-muted: #7f8aa3;
  --color-primary: #5a66ff;
  --color-primary-hover: #7680ff;
  --color-primary-bg: rgba(90, 102, 255, 0.12);
  --color-danger: #ef4444;
  --color-success: #22c55e;
  --color-warning: #f59e0b;
  --color-user-bubble: #5a66ff;
  --color-assistant-bubble: #12182a;
  --color-system-bubble: #0f1526;
  --sidebar-width: 260px;
  --header-height: 56px;
  --font-family: 'Manrope', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
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
