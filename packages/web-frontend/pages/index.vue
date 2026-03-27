<template>
  <div class="chat-page">
    <!-- Chat toolbar -->
    <div class="chat-toolbar">
      <button class="toolbar-btn" @click="handleNewSession" :title="$t('chat.newSession')">
        <AppIcon name="sparkles" class="btn-icon" />
        <span class="btn-text">{{ $t('chat.newSession') }}</span>
      </button>
      <button
        class="toolbar-btn danger"
        @click="handleStop"
        :disabled="!isStreaming"
        :title="$t('chat.stop')"
      >
        <AppIcon name="square" class="btn-icon" />
        <span class="btn-text">{{ $t('chat.stop') }}</span>
      </button>
    </div>

    <!-- Messages area -->
    <div class="messages-area" ref="messagesContainer">
      <div v-if="loadingHistory" class="loading-indicator">
        {{ $t('chat.loadingHistory') }}
      </div>

      <div v-else-if="messages.length === 0" class="empty-state">
        <AppIcon name="chat" class="empty-icon" size="xl" />
        <p>{{ $t('chat.noMessages') }}</p>
      </div>

      <div
        v-for="(msg, i) in messages"
        :key="i"
        class="message"
        :class="[`message-${msg.role}`, { streaming: msg.streaming }]"
      >
        <div class="message-avatar">
          <AppIcon v-if="msg.role === 'user'" name="user" />
          <AppIcon v-else-if="msg.role === 'assistant'" name="bot" />
          <AppIcon v-else name="info" />
        </div>
        <div class="message-bubble">
          <div class="message-content" v-text="msg.content" />
          <div v-if="msg.streaming" class="typing-indicator">
            <span /><span /><span />
          </div>
        </div>
      </div>
    </div>

    <!-- Input area -->
    <div class="input-area">
      <form class="input-form" @submit.prevent="handleSend">
        <textarea
          ref="inputRef"
          v-model="inputText"
          class="message-input"
          :placeholder="$t('chat.placeholder')"
          rows="1"
          @keydown.enter.exact.prevent="handleSend"
          @input="autoResize"
        />
        <button type="submit" class="send-button" :disabled="!inputText.trim() || connectionStatus !== 'connected'">
          {{ $t('chat.send') }}
        </button>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
const { t } = useI18n()
const { apiFetch } = useApi()
const {
  messages,
  connectionStatus,
  isStreaming,
  connect,
  disconnect,
  sendMessage,
  newSession,
  stopTask,
  clearMessages,
} = useChat()

const inputText = ref('')
const inputRef = ref<HTMLTextAreaElement | null>(null)
const messagesContainer = ref<HTMLDivElement | null>(null)
const loadingHistory = ref(false)

// Connect WebSocket on mount
onMounted(async () => {
  connect()
  await loadHistory()
})

onUnmounted(() => {
  disconnect()
})

// Auto-scroll to bottom when new messages arrive
watch(
  () => messages.value.length,
  () => {
    nextTick(() => {
      scrollToBottom()
    })
  }
)

// Also watch for streaming content changes
watch(
  () => {
    const last = messages.value[messages.value.length - 1]
    return last?.content?.length ?? 0
  },
  () => {
    nextTick(() => {
      scrollToBottom()
    })
  }
)

async function loadHistory() {
  loadingHistory.value = true
  try {
    interface HistoryResponse {
      messages: Array<{
        id: number
        role: 'user' | 'assistant'
        content: string
        timestamp: string
        session_id: string
      }>
    }

    const data = await apiFetch<HistoryResponse>('/api/chat/history?limit=50')
    if (data.messages && data.messages.length > 0) {
      // Messages come in DESC order, reverse for display
      const historyMessages = data.messages.reverse().map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
      }))
      messages.value = historyMessages
    }
  } catch {
    // History load failed — not critical, just start fresh
  } finally {
    loadingHistory.value = false
  }
}

function handleSend() {
  const text = inputText.value.trim()
  if (!text || connectionStatus.value !== 'connected') return

  sendMessage(text)
  inputText.value = ''

  // Reset textarea height
  if (inputRef.value) {
    inputRef.value.style.height = 'auto'
  }
}

function handleNewSession() {
  newSession()
}

function handleStop() {
  stopTask()
}

function scrollToBottom() {
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
  }
}

function autoResize() {
  const el = inputRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 150) + 'px'
}
</script>

<style scoped>
.chat-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

/* Toolbar */
.chat-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-bg);
  flex-shrink: 0;
}

.toolbar-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  color: var(--color-text-secondary);
  font-size: 13px;
  transition: all 0.15s ease;
}

.toolbar-btn:hover:not(:disabled) {
  background: var(--color-bg-secondary);
  color: var(--color-text);
}

.toolbar-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.toolbar-btn.danger:hover:not(:disabled) {
  border-color: var(--color-danger);
  color: var(--color-danger);
}

.btn-icon {
  width: 16px;
  height: 16px;
}

/* Messages area */
.messages-area {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.loading-indicator {
  text-align: center;
  color: var(--color-text-muted);
  padding: 40px;
  font-size: 14px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  color: var(--color-text-muted);
  gap: 12px;
}

.empty-icon {
  width: 40px;
  height: 40px;
  opacity: 0.5;
}

.empty-state p {
  font-size: 15px;
}

/* Messages */
.message {
  display: flex;
  gap: 12px;
  max-width: 80%;
  animation: fadeIn 0.2s ease;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

.message-user {
  align-self: flex-end;
  flex-direction: row-reverse;
}

.message-assistant {
  align-self: flex-start;
}

.message-system {
  align-self: center;
  max-width: 90%;
}

.message-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-secondary);
  flex-shrink: 0;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-border);
}

.message-bubble {
  padding: 10px 14px;
  border-radius: 16px;
  font-size: 14px;
  line-height: 1.6;
  word-break: break-word;
}

.message-user .message-bubble {
  background: var(--color-user-bubble);
  color: white;
  border-bottom-right-radius: 4px;
}

.message-assistant .message-bubble {
  background: var(--color-assistant-bubble);
  border: 1px solid var(--color-border);
  border-bottom-left-radius: 4px;
}

.message-system .message-bubble {
  background: var(--color-system-bubble);
  border: 1px solid var(--color-border);
  color: var(--color-text-secondary);
  font-size: 13px;
  text-align: center;
  border-radius: 8px;
}

.message-content {
  white-space: pre-wrap;
}

/* Typing indicator */
.typing-indicator {
  display: flex;
  gap: 4px;
  margin-top: 4px;
}

.typing-indicator span {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--color-text-muted);
  animation: typingDot 1.4s infinite;
}

.typing-indicator span:nth-child(2) {
  animation-delay: 0.2s;
}

.typing-indicator span:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes typingDot {
  0%, 60%, 100% { opacity: 0.3; transform: translateY(0); }
  30% { opacity: 1; transform: translateY(-4px); }
}

/* Input area */
.input-area {
  padding: 12px 16px;
  border-top: 1px solid var(--color-border);
  background: var(--color-bg);
  flex-shrink: 0;
}

.input-form {
  display: flex;
  gap: 8px;
  align-items: flex-end;
}

.message-input {
  flex: 1;
  padding: 10px 14px;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  color: var(--color-text);
  font-size: 14px;
  resize: none;
  outline: none;
  max-height: 150px;
  line-height: 1.5;
  transition: border-color 0.15s ease;
}

.message-input:focus {
  border-color: var(--color-primary);
}

.message-input::placeholder {
  color: var(--color-text-muted);
}

.send-button {
  padding: 10px 20px;
  background: var(--color-primary);
  color: white;
  border: none;
  border-radius: 12px;
  font-size: 14px;
  font-weight: 600;
  transition: background 0.15s ease;
  flex-shrink: 0;
}

.send-button:hover:not(:disabled) {
  background: var(--color-primary-hover);
}

.send-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Mobile */
@media (max-width: 768px) {
  .message {
    max-width: 90%;
  }

  .btn-text {
    display: none;
  }

  .toolbar-btn {
    padding: 8px;
  }
}
</style>
