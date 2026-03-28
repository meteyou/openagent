/**
 * Shared formatting utilities.
 *
 * Centralises Intl-based formatters so every page uses the same locale-aware
 * output without duplicating the logic.
 */
export function useFormat() {
  const { locale } = useI18n()

  /** Locale-aware number: 1 234 567 */
  function formatNumber(value: number): string {
    return new Intl.NumberFormat(locale.value).format(value)
  }

  /** Locale-aware currency (USD): $1,234.56 */
  function formatCurrency(value: number): string {
    return new Intl.NumberFormat(locale.value, {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    }).format(value)
  }

  /** Medium date + short time: "Mar 28, 2026, 2:30 PM" */
  function formatDateTime(value: string): string {
    return new Intl.DateTimeFormat(locale.value, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value))
  }

  /** Medium date only: "Mar 28, 2026" */
  function formatDate(value: string): string {
    return new Intl.DateTimeFormat(locale.value, {
      dateStyle: 'medium',
    }).format(new Date(value))
  }

  return {
    formatNumber,
    formatCurrency,
    formatDateTime,
    formatDate,
  }
}
