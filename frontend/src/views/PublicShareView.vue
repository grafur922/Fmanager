<template>
  <div class="public-share-page">
    <header class="public-share-topbar">
      <div class="public-share-brand">
        <span class="public-share-brand__mark">FH</span>
        <strong>FileHub Console</strong>
        <span>文件分享</span>
      </div>
    </header>

    <main class="public-share-main">
      <section v-if="loading" class="share-access-panel is-loading" aria-live="polite">
        <el-skeleton :rows="5" animated />
      </section>

      <section v-else-if="errorMessage" class="share-access-panel is-error" aria-live="assertive">
        <el-icon :size="38"><WarningFilled /></el-icon>
        <h1>分享链接不可用</h1>
        <p>{{ errorMessage }}</p>
        <el-button :icon="RefreshRight" @click="loadShare">重新加载</el-button>
      </section>

      <section v-else-if="share" class="share-access-panel">
        <header class="shared-file-heading">
          <div class="shared-file-icon">
            <el-icon><Document /></el-icon>
          </div>
          <div>
            <span>共享文件</span>
            <h1 :title="share.name">{{ share.name }}</h1>
            <div class="public-share-status" :class="`is-${share.status}`">
              <i></i>{{ statusContent.label }}
            </div>
          </div>
        </header>

        <dl class="share-metadata">
          <div>
            <dt>有效期至</dt>
            <dd>{{ formatDate(share.expiresAt) }}</dd>
          </div>
          <div>
            <dt>下载次数</dt>
            <dd>
              {{
                share.maxDownloads === null
                  ? `${share.downloadCount} 次`
                  : `${share.downloadCount} / ${share.maxDownloads} 次`
              }}
            </dd>
          </div>
          <div>
            <dt>访问验证</dt>
            <dd>{{ share.requiresPassword ? '需要密码' : '免密访问' }}</dd>
          </div>
        </dl>

        <div
          v-if="share.status !== 'active'"
          class="share-unavailable"
          :class="`is-${share.status}`"
        >
          <el-icon><WarningFilled /></el-icon>
          <span>{{ statusContent.description }}</span>
        </div>

        <form v-else class="download-form" @submit.prevent="startDownload">
          <label v-if="share.requiresPassword" for="share-password">访问密码</label>
          <el-input
            v-if="share.requiresPassword"
            id="share-password"
            ref="passwordInput"
            v-model="password"
            type="password"
            show-password
            maxlength="64"
            autocomplete="current-password"
            placeholder="请输入分享密码"
          >
            <template #prefix
              ><el-icon><Lock /></el-icon
            ></template>
          </el-input>
          <el-button
            native-type="submit"
            type="primary"
            size="large"
            :icon="Download"
            :loading="downloading"
            class="download-button"
          >
            下载文件
          </el-button>
          <p v-if="downloadMessage" class="download-message" aria-live="polite">
            <el-icon><CircleCheck /></el-icon>{{ downloadMessage }}
          </p>
        </form>
      </section>
    </main>

    <footer class="public-share-footer">FileHub Console · Private file delivery</footer>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import {
  CircleCheck,
  Document,
  Download,
  Lock,
  RefreshRight,
  WarningFilled,
} from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { authorizeShareDownload, getPublicShare } from '../api/shares'
import type { PublicShareInfo, ShareStatus } from '../types/share'
import { formatDate } from '../utils/format'

const route = useRoute()
const previousTitle = document.title
const share = ref<PublicShareInfo | null>(null)
const loading = ref(true)
const downloading = ref(false)
const errorMessage = ref('')
const password = ref('')
const passwordInput = ref<{ focus: () => void }>()
const downloadMessage = ref('')

const shareId = computed(() => String(route.params.id || ''))
const statusContent = computed(() => statusDetails(share.value?.status || 'disabled'))

async function loadShare(): Promise<void> {
  loading.value = true
  errorMessage.value = ''
  try {
    share.value = await getPublicShare(shareId.value)
    document.title = `${share.value.name} - FileHub`
    if (share.value.status === 'active' && share.value.requiresPassword) {
      await nextTick()
      passwordInput.value?.focus()
    }
  } catch (error) {
    share.value = null
    errorMessage.value = error instanceof Error ? error.message : '无法读取分享信息'
  } finally {
    loading.value = false
  }
}

async function startDownload(): Promise<void> {
  if (!share.value || share.value.status !== 'active') return
  if (share.value.requiresPassword && !password.value) {
    ElMessage.warning('请输入分享密码')
    passwordInput.value?.focus()
    return
  }

  downloading.value = true
  downloadMessage.value = ''
  try {
    const grant = await authorizeShareDownload(
      share.value.id,
      share.value.requiresPassword ? password.value : undefined,
    )
    const anchor = document.createElement('a')
    anchor.href = grant.downloadUrl
    anchor.rel = 'noopener'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    password.value = ''
    downloadMessage.value = '下载请求已提交'
    window.setTimeout(() => void refreshShareAfterDownload(), 800)
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '下载授权失败')
  } finally {
    downloading.value = false
  }
}

async function refreshShareAfterDownload(): Promise<void> {
  try {
    share.value = await getPublicShare(shareId.value)
  } catch {
    // The browser download has already started; metadata refresh is best effort.
  }
}

function statusDetails(status: ShareStatus): { label: string; description: string } {
  return {
    active: { label: '可下载', description: '' },
    disabled: { label: '已停用', description: '分享者已停止此链接的公开访问。' },
    expired: { label: '已过期', description: '该分享已经超过有效期。' },
    limit_reached: { label: '次数用完', description: '该分享允许的下载次数已经用完。' },
  }[status]
}

onMounted(loadShare)
onBeforeUnmount(() => {
  document.title = previousTitle
})
</script>

<style scoped>
.public-share-page {
  min-height: 100vh;
  display: grid;
  grid-template-rows: 52px 1fr auto;
  color: #1f2d3d;
  background: #f3f5f8;
}
.public-share-topbar {
  padding: 0 22px;
  display: flex;
  align-items: center;
  color: #fff;
  background: #17233d;
  box-shadow: 0 1px 4px rgb(5 15 35 / 28%);
}
.public-share-brand {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
}
.public-share-brand__mark {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  color: #fff;
  background: #1677ff;
  font-size: 11px;
  font-weight: 800;
}
.public-share-brand strong {
  font-size: 15px;
  font-weight: 600;
}
.public-share-brand > span:last-child {
  padding-left: 10px;
  color: #b7c2d8;
  border-left: 1px solid #3a4763;
  font-size: 12px;
}
.public-share-main {
  width: min(720px, calc(100% - 32px));
  margin: 0 auto;
  display: grid;
  align-items: center;
  padding: 40px 0;
}
.share-access-panel {
  min-height: 420px;
  padding: 34px 38px;
  background: #fff;
  border: 1px solid #dfe3eb;
  box-shadow: 0 8px 24px rgb(26 45 72 / 8%);
}
.share-access-panel.is-loading {
  display: grid;
  align-items: center;
}
.share-access-panel.is-error {
  display: grid;
  place-content: center;
  justify-items: center;
  text-align: center;
  color: #d54941;
}
.share-access-panel.is-error h1 {
  margin: 16px 0 0;
  color: #27364b;
  font-size: 20px;
}
.share-access-panel.is-error p {
  margin: 8px 0 20px;
  color: #788493;
  font-size: 13px;
}
.shared-file-heading {
  min-height: 92px;
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  align-items: center;
  gap: 18px;
}
.shared-file-icon {
  width: 64px;
  height: 64px;
  display: grid;
  place-items: center;
  color: #1677ff;
  background: #eaf3ff;
  font-size: 30px;
}
.shared-file-heading span {
  color: #8b95a2;
  font-size: 11px;
}
.shared-file-heading h1 {
  max-width: 100%;
  margin: 5px 0 7px;
  overflow: hidden;
  color: #24344b;
  font-size: 20px;
  font-weight: 600;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.public-share-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
}
.public-share-status i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}
.public-share-status.is-active {
  color: #008f5d;
}
.public-share-status.is-active i {
  background: #00a870;
}
.public-share-status.is-disabled {
  color: #ad6800;
}
.public-share-status.is-disabled i {
  background: #fa8c16;
}
.public-share-status.is-expired {
  color: #7d8794;
}
.public-share-status.is-expired i {
  background: #aab2bd;
}
.public-share-status.is-limit_reached {
  color: #cf3f4f;
}
.public-share-status.is-limit_reached i {
  background: #e34d59;
}
.share-metadata {
  margin: 28px 0 26px;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  border-block: 1px solid #e7eaf0;
}
.share-metadata > div {
  min-width: 0;
  padding: 17px 16px;
  border-right: 1px solid #e7eaf0;
}
.share-metadata > div:first-child {
  padding-left: 0;
}
.share-metadata > div:last-child {
  padding-right: 0;
  border-right: 0;
}
.share-metadata dt {
  color: #909aa7;
  font-size: 10px;
}
.share-metadata dd {
  margin: 5px 0 0;
  overflow: hidden;
  color: #3c4b60;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.download-form {
  max-width: 420px;
  margin: 0 auto;
}
.download-form label {
  display: block;
  margin-bottom: 7px;
  color: #4e5d70;
  font-size: 12px;
}
.download-button {
  width: 100%;
  margin-top: 14px;
}
.download-message {
  margin: 12px 0 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: #008f5d;
  font-size: 11px;
}
.share-unavailable {
  min-height: 72px;
  padding: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  color: #7a5b24;
  background: #fff8e8;
  border-left: 3px solid #fa8c16;
  font-size: 12px;
}
.share-unavailable.is-expired {
  color: #66717f;
  background: #f5f6f8;
  border-left-color: #aab2bd;
}
.share-unavailable.is-limit_reached {
  color: #a63d48;
  background: #fff1f2;
  border-left-color: #e34d59;
}
.public-share-footer {
  padding: 0 16px 22px;
  color: #9aa3af;
  font-size: 10px;
  text-align: center;
}
@media (max-width: 640px) {
  .public-share-brand > span:last-child {
    display: none;
  }
  .public-share-main {
    width: calc(100% - 20px);
    padding: 18px 0;
    align-items: start;
  }
  .share-access-panel {
    min-height: 0;
    padding: 24px 20px;
  }
  .shared-file-heading {
    grid-template-columns: 50px minmax(0, 1fr);
    gap: 13px;
  }
  .shared-file-icon {
    width: 50px;
    height: 50px;
    font-size: 24px;
  }
  .shared-file-heading h1 {
    font-size: 17px;
  }
  .share-metadata {
    grid-template-columns: 1fr;
  }
  .share-metadata > div,
  .share-metadata > div:first-child,
  .share-metadata > div:last-child {
    padding: 11px 0;
    border-right: 0;
    border-bottom: 1px solid #eef0f4;
  }
  .share-metadata > div:last-child {
    border-bottom: 0;
  }
}
</style>
