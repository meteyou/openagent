<template>
  <div class="login-page">
    <div class="login-card">
      <div class="login-header">
        <AppLogo size="lg" />
        <h1 class="login-title">{{ $t('app.title') }}</h1>
      </div>

      <form class="login-form" @submit.prevent="handleLogin">
        <div class="form-group">
          <label class="form-label" for="username">{{ $t('auth.username') }}</label>
          <input
            id="username"
            v-model="username"
            type="text"
            class="form-input"
            :placeholder="$t('auth.username')"
            autocomplete="username"
            required
            autofocus
          />
        </div>

        <div class="form-group">
          <label class="form-label" for="password">{{ $t('auth.password') }}</label>
          <input
            id="password"
            v-model="password"
            type="password"
            class="form-input"
            :placeholder="$t('auth.password')"
            autocomplete="current-password"
            required
          />
        </div>

        <div v-if="error" class="form-error">
          {{ error }}
        </div>

        <button type="submit" class="login-button" :disabled="loading">
          <span v-if="loading" class="spinner" />
          {{ loading ? '...' : $t('auth.loginButton') }}
        </button>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({
  layout: 'blank',
})

const { t } = useI18n()
const { login } = useAuth()

const username = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

async function handleLogin() {
  error.value = ''
  loading.value = true

  try {
    const result = await login(username.value, password.value)
    if (result.success) {
      await navigateTo('/')
    } else {
      error.value = result.error || t('auth.loginError')
    }
  } catch {
    error.value = t('auth.loginError')
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-page {
  width: 100%;
  max-width: 400px;
  padding: 20px;
}

.login-card {
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: 16px;
  padding: 40px 32px;
}

.login-header {
  text-align: center;
  margin-bottom: 32px;
}

.login-header :deep(.app-logo) {
  margin: 0 auto 14px;
}

.login-title {
  font-size: 24px;
  font-weight: 700;
  color: var(--color-text);
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-label {
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text-secondary);
}

.form-input {
  padding: 10px 14px;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  color: var(--color-text);
  font-size: 14px;
  outline: none;
  transition: border-color 0.15s ease;
}

.form-input:focus {
  border-color: var(--color-primary);
}

.form-input::placeholder {
  color: var(--color-text-muted);
}

.form-error {
  padding: 10px 14px;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 8px;
  color: var(--color-danger);
  font-size: 14px;
}

.login-button {
  padding: 12px;
  background: var(--color-primary);
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 15px;
  font-weight: 600;
  transition: background 0.15s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.login-button:hover:not(:disabled) {
  background: var(--color-primary-hover);
}

.login-button:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
