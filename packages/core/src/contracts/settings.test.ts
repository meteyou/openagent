import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS_CONTRACT,
  normalizeSettingsContract,
  withLegacySettingsPayloadCompatibility,
} from './settings.js'

describe('settings contracts', () => {
  it('normalizes missing sections with canonical defaults', () => {
    const normalized = normalizeSettingsContract({
      sessionTimeoutMinutes: 30,
      language: 'de',
      healthMonitor: {
        notifications: {
          degradedToHealthy: true,
        },
      },
      stt: {
        rewrite: {
          enabled: true,
        },
      },
    })

    expect(normalized.sessionTimeoutMinutes).toBe(30)
    expect(normalized.language).toBe('de')
    expect(normalized.healthMonitor.notifications.degradedToHealthy).toBe(true)
    expect(normalized.healthMonitor.notifications.healthyToDown)
      .toBe(DEFAULT_SETTINGS_CONTRACT.healthMonitor.notifications.healthyToDown)
    expect(normalized.stt.rewrite.enabled).toBe(true)
    expect(normalized.stt.rewrite.providerId).toBe('')
    expect(normalized.tasks.loopDetection.method)
      .toBe(DEFAULT_SETTINGS_CONTRACT.tasks.loopDetection.method)
  })

  it('accepts legacy healthMonitor.intervalMinutes payloads', () => {
    const payload = withLegacySettingsPayloadCompatibility({
      language: 'en',
      healthMonitor: {
        intervalMinutes: 9,
      },
    })

    expect(payload.healthMonitorIntervalMinutes).toBe(9)
  })

  it('does not overwrite explicit healthMonitorIntervalMinutes with legacy values', () => {
    const payload = withLegacySettingsPayloadCompatibility({
      healthMonitorIntervalMinutes: 4,
      healthMonitor: {
        intervalMinutes: 9,
      },
    })

    expect(payload.healthMonitorIntervalMinutes).toBe(4)
  })
})
