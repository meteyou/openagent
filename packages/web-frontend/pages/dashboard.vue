<template>
  <div class="placeholder-page">
    <span class="placeholder-icon">📊</span>
    <h2>{{ $t('nav.dashboard') }}</h2>
    <p>Coming soon</p>
  </div>
</template>

<style scoped>
.placeholder-page {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--color-text-muted);
  gap: 12px;
}

.placeholder-icon {
  font-size: 48px;
  opacity: 0.5;
}

h2 {
  color: var(--color-text-secondary);
  font-size: 20px;
}

p {
  font-size: 14px;
}
</style>
