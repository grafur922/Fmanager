<template>
  <el-drawer
    :model-value="modelValue"
    direction="rtl"
    size="min(980px, 92vw)"
    :with-header="false"
    :destroy-on-close="true"
    append-to-body
    class="file-preview-drawer"
    @update:model-value="emit('update:modelValue', $event)"
    @closed="resetPreview"
  >
    <section class="preview-shell">
      <header class="preview-header">
        <div class="preview-header__identity">
          <span class="preview-file-icon"><el-icon><Document /></el-icon></span>
          <div>
            <strong :title="fileName">{{ fileName || '文件预览' }}</strong>
            <span :title="filePath">{{ filePath }}</span>
          </div>
        </div>
        <div class="preview-header__actions">
          <el-tooltip content="下载文件">
            <el-button circle :icon="Download" :disabled="!filePath" @click="emit('download')" />
          </el-tooltip>
          <el-tooltip content="关闭预览">
            <el-button circle :icon="Close" @click="emit('update:modelValue', false)" />
          </el-tooltip>
        </div>
      </header>

      <div v-if="descriptor" class="preview-metadata">
        <div><span>格式</span><b>{{ kindLabel }}</b></div>
        <div><span>大小</span><b>{{ formatBytes(descriptor.size) }}</b></div>
        <div><span>内容类型</span><b>{{ descriptor.mimeType }}</b></div>
        <div><span>访问方式</span><b>{{ supportsRange ? 'Range 流式' : '短时令牌' }}</b></div>
      </div>

      <main class="preview-stage" :class="`is-${descriptor?.kind || 'loading'}`">
        <div v-if="loading" class="preview-state">
          <span class="preview-loader"></span>
          <strong>正在准备预览</strong>
          <p>正在确认文件类型并创建短时访问令牌。</p>
        </div>

        <div v-else-if="errorMessage" class="preview-state is-error">
          <el-icon :size="34"><WarningFilled /></el-icon>
          <strong>无法显示这个文件</strong>
          <p>{{ errorMessage }}</p>
          <el-button :icon="RefreshRight" @click="loadPreview">重新加载</el-button>
        </div>

        <template v-else-if="descriptor">
          <div v-if="descriptor.kind === 'image'" class="image-preview">
            <div class="image-toolbar">
              <el-tooltip content="缩小"><el-button circle text :icon="ZoomOut" :disabled="zoom <= 0.25" @click="zoomOut" /></el-tooltip>
              <span>{{ Math.round(zoom * 100) }}%</span>
              <el-tooltip content="放大"><el-button circle text :icon="ZoomIn" :disabled="zoom >= 4" @click="zoomIn" /></el-tooltip>
              <el-tooltip content="恢复原始比例"><el-button circle text :icon="RefreshLeft" @click="zoom = 1" /></el-tooltip>
            </div>
            <div class="image-viewport">
              <img :src="descriptor.url" :alt="descriptor.name" :style="{ transform: `scale(${zoom})` }" />
            </div>
          </div>

          <div v-else-if="descriptor.kind === 'text'" class="text-preview">
            <div class="text-toolbar">
              <span>{{ textContent.split('\n').length.toLocaleString() }} 行</span>
              <label><input v-model="wrapText" type="checkbox" />自动换行</label>
            </div>
            <pre :class="{ 'is-wrapped': wrapText }">{{ textContent }}</pre>
          </div>

          <iframe
            v-else-if="descriptor.kind === 'pdf'"
            class="pdf-preview"
            :src="descriptor.url"
            :title="descriptor.name"
          ></iframe>

          <div v-else-if="descriptor.kind === 'video'" class="media-preview">
            <video :src="descriptor.url" controls preload="metadata"></video>
          </div>

          <div v-else-if="descriptor.kind === 'audio'" class="media-preview is-audio">
            <span class="audio-disc"><el-icon><Headset /></el-icon></span>
            <strong>{{ descriptor.name }}</strong>
            <audio :src="descriptor.url" controls preload="metadata"></audio>
          </div>

          <div v-else class="preview-state">
            <el-icon :size="38"><Document /></el-icon>
            <strong>该格式暂不支持在线预览</strong>
            <p>文件没有被转换或执行。可以下载后使用本地应用打开。</p>
            <el-button type="primary" :icon="Download" @click="emit('download')">下载文件</el-button>
          </div>
        </template>
      </main>
    </section>
  </el-drawer>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  Close,
  Document,
  Download,
  Headset,
  RefreshLeft,
  RefreshRight,
  WarningFilled,
  ZoomIn,
  ZoomOut,
} from '@element-plus/icons-vue'
import { createPreviewToken } from '../../api/files'
import type { PreviewDescriptor } from '../../types/file'
import { formatBytes } from '../../utils/format'

const props = defineProps<{
  modelValue: boolean
  filePath: string
  fileName: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  download: []
}>()

const descriptor = ref<PreviewDescriptor | null>(null)
const textContent = ref('')
const loading = ref(false)
const errorMessage = ref('')
const zoom = ref(1)
const wrapText = ref(false)
let textRequest: AbortController | undefined

const kindLabel = computed(() => {
  const labels: Record<PreviewDescriptor['kind'], string> = {
    image: '图片',
    text: '文本',
    pdf: 'PDF',
    audio: '音频',
    video: '视频',
    unsupported: '未知格式',
  }
  return descriptor.value ? labels[descriptor.value.kind] : '--'
})
const supportsRange = computed(() =>
  descriptor.value ? ['audio', 'video', 'pdf'].includes(descriptor.value.kind) : false,
)

async function loadPreview(): Promise<void> {
  if (!props.filePath) return
  textRequest?.abort()
  loading.value = true
  errorMessage.value = ''
  descriptor.value = null
  textContent.value = ''
  zoom.value = 1

  try {
    const result = await createPreviewToken(props.filePath)
    descriptor.value = result
    if (result.kind === 'text') {
      if (result.size > 2 * 1024 * 1024) {
        throw new Error('文本文件超过 2 MiB，为避免浏览器卡顿，请下载后查看。')
      }
      textRequest = new AbortController()
      const response = await fetch(result.url, { signal: textRequest.signal })
      if (!response.ok) throw new Error(`文本加载失败（HTTP ${response.status}）`)
      textContent.value = await response.text()
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return
    errorMessage.value = error instanceof Error ? error.message : '预览加载失败'
  } finally {
    loading.value = false
  }
}

function zoomIn(): void {
  zoom.value = Math.min(4, Number((zoom.value + 0.25).toFixed(2)))
}

function zoomOut(): void {
  zoom.value = Math.max(0.25, Number((zoom.value - 0.25).toFixed(2)))
}

function resetPreview(): void {
  textRequest?.abort()
  descriptor.value = null
  textContent.value = ''
  errorMessage.value = ''
  zoom.value = 1
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) void loadPreview()
  },
)
watch(
  () => props.filePath,
  () => {
    if (props.modelValue) void loadPreview()
  },
)

onBeforeUnmount(() => textRequest?.abort())
</script>

<style scoped>
:global(.file-preview-drawer .el-drawer__body) { padding: 0; overflow: hidden; }
.preview-shell { height: 100%; min-height: 0; display: grid; grid-template-rows: 64px 58px minmax(0, 1fr); background: #fff; }
.preview-header { padding: 0 18px; display: flex; align-items: center; justify-content: space-between; gap: 16px; border-bottom: 1px solid #e3e7ee; }
.preview-header__identity { min-width: 0; display: flex; align-items: center; gap: 11px; }
.preview-file-icon { width: 34px; height: 34px; display: grid; place-items: center; flex: 0 0 auto; color: #1677ff; background: #eaf3ff; }
.preview-header__identity div { min-width: 0; }
.preview-header__identity strong, .preview-header__identity span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.preview-header__identity strong { color: #26374d; font-size: 14px; }
.preview-header__identity span { margin-top: 3px; color: #8a95a3; font-size: 10px; }
.preview-header__actions { display: flex; gap: 6px; }
.preview-metadata { display: grid; grid-template-columns: .7fr .7fr 1.4fr .8fr; border-bottom: 1px solid #dce2ea; background: #f7f8fa; }
.preview-metadata > div { min-width: 0; padding: 11px 14px; border-right: 1px solid #e3e7ed; }
.preview-metadata > div:last-child { border-right: 0; }
.preview-metadata span, .preview-metadata b { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.preview-metadata span { color: #8b96a4; font-size: 9px; }
.preview-metadata b { margin-top: 4px; color: #405168; font-size: 11px; font-weight: 500; }
.preview-stage { min-height: 0; overflow: hidden; display: grid; background: #101722; color: #dce6f4; }
.preview-state { margin: auto; max-width: 430px; padding: 28px; display: grid; justify-items: center; gap: 9px; color: #7f91a9; text-align: center; }
.preview-state strong { color: #e7edf5; font-size: 14px; }
.preview-state p { margin: 0 0 7px; font-size: 11px; line-height: 1.7; }
.preview-state.is-error { color: #ff9b9b; }
.preview-loader { width: 28px; height: 28px; border: 2px solid #34445a; border-top-color: #4096ff; border-radius: 50%; animation: preview-spin .8s linear infinite; }
.image-preview { min-height: 0; display: grid; grid-template-rows: 42px minmax(0, 1fr); }
.image-toolbar, .text-toolbar { padding: 0 12px; display: flex; align-items: center; justify-content: flex-end; gap: 5px; color: #93a3b8; background: #182230; border-bottom: 1px solid #273448; font-size: 10px; }
.image-toolbar span { width: 45px; text-align: center; }
.image-toolbar :deep(.el-button) { color: #afbed1; }
.image-viewport { min-height: 0; overflow: auto; display: grid; place-items: center; padding: 34px; background-image: linear-gradient(45deg, #151f2c 25%, transparent 25%), linear-gradient(-45deg, #151f2c 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #151f2c 75%), linear-gradient(-45deg, transparent 75%, #151f2c 75%); background-position: 0 0, 0 8px, 8px -8px, -8px 0; background-size: 16px 16px; }
.image-viewport img { max-width: 100%; max-height: 100%; transform-origin: center; transition: transform .14s ease; box-shadow: 0 8px 30px rgb(0 0 0 / 35%); }
.text-preview { min-height: 0; display: grid; grid-template-rows: 42px minmax(0, 1fr); }
.text-toolbar { justify-content: space-between; padding: 0 16px; }
.text-toolbar label { display: flex; align-items: center; gap: 6px; cursor: pointer; }
.text-preview pre { min-height: 0; margin: 0; padding: 22px 24px 60px; overflow: auto; color: #d7e2ef; background: #101722; font: 12px/1.72 "Cascadia Code", Consolas, monospace; white-space: pre; tab-size: 2; }
.text-preview pre.is-wrapped { white-space: pre-wrap; overflow-wrap: anywhere; }
.pdf-preview { width: 100%; height: 100%; border: 0; background: #e9edf2; }
.media-preview { min-height: 0; display: grid; place-items: center; padding: 28px; }
.media-preview video { max-width: 100%; max-height: 100%; background: #000; box-shadow: 0 12px 38px rgb(0 0 0 / 40%); }
.media-preview.is-audio { align-content: center; gap: 18px; }
.media-preview.is-audio strong { max-width: 80%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.media-preview audio { width: min(520px, 90%); }
.audio-disc { width: 92px; height: 92px; display: grid; place-items: center; border: 1px solid #3b4c63; border-radius: 50%; color: #69a8ff; background: repeating-radial-gradient(circle, #1b2736 0 4px, #111a26 5px 8px); font-size: 28px; }
@keyframes preview-spin { to { transform: rotate(360deg); } }
@media (max-width: 640px) { .preview-shell { grid-template-rows: 60px auto minmax(0, 1fr); } .preview-metadata { grid-template-columns: repeat(2, 1fr); } .preview-metadata > div:nth-child(2) { border-right: 0; } .preview-metadata > div:nth-child(-n+2) { border-bottom: 1px solid #e3e7ed; } }
</style>
