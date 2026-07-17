<template>
  <div>
    <PageHeader
      eyebrow="PUBLIC ACCESS"
      title="公开分享"
      description="集中管理公开链接、访问密码、下载配额和下载记录。"
    >
      <el-button :icon="Refresh" :loading="loading" @click="fetchShares">刷新</el-button>
      <el-button type="primary" :icon="FolderOpened" @click="router.push('/files')">
        选择文件分享
      </el-button>
    </PageHeader>

    <section class="share-summary">
      <div>
        <span>分享总数</span><b>{{ shares.length }}</b>
      </div>
      <div>
        <span>可用链接</span><b class="is-active">{{ activeCount }}</b>
      </div>
      <div>
        <span>受限访问</span><b class="is-protected">{{ protectedCount }}</b>
      </div>
      <div>
        <span>累计下载</span><b>{{ totalDownloads }}</b>
      </div>
    </section>

    <div class="console-toolbar">
      <div class="console-toolbar__group">
        <span class="object-count">公开链接仅支持单个文件</span>
        <el-select v-model="statusFilter" style="width: 132px" aria-label="分享状态筛选">
          <el-option label="全部状态" value="all" />
          <el-option label="可用" value="active" />
          <el-option label="已停用" value="disabled" />
          <el-option label="已过期" value="expired" />
          <el-option label="次数用完" value="limit_reached" />
        </el-select>
      </div>
      <el-input
        v-model="keyword"
        :prefix-icon="Search"
        clearable
        placeholder="搜索文件名或路径"
        style="width: 260px"
      />
    </div>

    <div class="console-card shares-table">
      <el-table v-loading="loading" :data="filteredShares" empty-text="没有符合条件的分享">
        <el-table-column label="分享文件" min-width="250">
          <template #default="{ row }">
            <div class="share-file">
              <el-icon><Document /></el-icon>
              <div>
                <b>{{ row.name }}</b
                ><span>{{ row.path }}</span>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="105">
          <template #default="{ row }">
            <span class="share-status" :class="`is-${effectiveStatus(row)}`">
              <i></i>{{ statusLabel(effectiveStatus(row)) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="启用" width="78" align="center">
          <template #default="{ row }">
            <el-switch
              :model-value="row.isEnabled"
              :loading="togglingIds.includes(row.id)"
              :aria-label="row.isEnabled ? '停用分享' : '启用分享'"
              @change="(value: string | number | boolean) => toggleShare(row, Boolean(value))"
            />
          </template>
        </el-table-column>
        <el-table-column label="访问策略" min-width="170">
          <template #default="{ row }">
            <div class="access-policy">
              <span>
                <el-icon><Lock v-if="row.hasPassword" /><Unlock v-else /></el-icon>
                {{ row.hasPassword ? '密码验证' : '免密访问' }}
              </span>
              <span>
                {{
                  row.maxDownloads === null
                    ? '下载次数不限'
                    : `${row.downloadCount} / ${row.maxDownloads} 次`
                }}
              </span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="到期时间" width="170">
          <template #default="{ row }">{{ formatDate(row.expiresAt) }}</template>
        </el-table-column>
        <el-table-column label="下载记录" width="100" align="center">
          <template #default="{ row }">
            <el-button link type="primary" @click="showLogs(row)">
              {{ row.downloadCount }} 次
            </el-button>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <el-button
              link
              type="primary"
              :icon="Link"
              :disabled="effectiveStatus(row) !== 'active'"
              @click="copyLink(row.id)"
            >
              复制链接
            </el-button>
            <el-button link type="primary" :icon="EditPen" @click="openEditDialog(row)">
              设置
            </el-button>
            <el-button link type="danger" :icon="Delete" @click="removeShare(row)">
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <div v-if="!loading && !shares.length" class="shares-empty">
        <el-icon :size="34"><Share /></el-icon>
        <strong>还没有公开分享</strong>
        <span>在文件管理中选择一个文件并创建下载链接。</span>
        <el-button type="primary" plain @click="router.push('/files')">前往文件管理</el-button>
      </div>
    </div>

    <el-dialog v-model="editVisible" title="分享设置" width="500px">
      <div class="edit-resource">
        <span>分享对象</span>
        <b>{{ editingShare?.name }}</b>
        <small>{{ editingShare?.path }}</small>
      </div>
      <el-form label-position="top">
        <el-form-item label="链接状态">
          <div class="setting-line">
            <span>{{ editForm.isEnabled ? '允许公开访问' : '停止公开访问' }}</span>
            <el-switch v-model="editForm.isEnabled" />
          </div>
        </el-form-item>
        <el-form-item label="重新设置有效期">
          <el-select v-model="editForm.days" style="width: 100%">
            <el-option label="保持当前到期时间" :value="0" />
            <el-option label="从现在起 1 天" :value="1" />
            <el-option label="从现在起 7 天" :value="7" />
            <el-option label="从现在起 30 天" :value="30" />
            <el-option label="从现在起 365 天" :value="365" />
          </el-select>
        </el-form-item>
        <el-form-item label="访问密码">
          <div class="password-mode-control" role="radiogroup" aria-label="密码设置方式">
            <button
              type="button"
              role="radio"
              :aria-checked="editForm.passwordMode === 'keep'"
              :class="{ 'is-active': editForm.passwordMode === 'keep' }"
              :disabled="saving"
              @click="setPasswordMode('keep')"
            >
              <el-icon><Check /></el-icon>
              <span>保持不变</span>
            </button>
            <button
              type="button"
              role="radio"
              :aria-checked="editForm.passwordMode === 'replace'"
              :class="{ 'is-active': editForm.passwordMode === 'replace' }"
              :disabled="saving"
              @click="setPasswordMode('replace')"
            >
              <el-icon><EditPen /></el-icon>
              <span>设置新密码</span>
            </button>
            <button
              v-if="editingShare?.hasPassword"
              type="button"
              role="radio"
              :aria-checked="editForm.passwordMode === 'remove'"
              :class="{ 'is-active': editForm.passwordMode === 'remove' }"
              :disabled="saving"
              @click="setPasswordMode('remove')"
            >
              <el-icon><Delete /></el-icon>
              <span>移除密码</span>
            </button>
          </div>
          <el-input
            v-if="editForm.passwordMode === 'replace'"
            v-model="editForm.password"
            type="password"
            show-password
            maxlength="64"
            placeholder="4 到 64 个字符"
            class="password-input"
          />
        </el-form-item>
        <el-form-item label="下载次数">
          <div class="setting-line">
            <span>{{ editForm.limitEnabled ? '限制总下载次数' : '不限制下载次数' }}</span>
            <el-switch v-model="editForm.limitEnabled" />
          </div>
          <el-input-number
            v-if="editForm.limitEnabled"
            v-model="editForm.maxDownloads"
            :min="1"
            :max="1000000"
            controls-position="right"
            style="width: 100%"
          />
        </el-form-item>
      </el-form>
      <div v-if="editingShare && editForm.limitEnabled" class="edit-notice">
        已下载 {{ editingShare.downloadCount }} 次；新上限不高于该数值时，链接会立即停止下载。
      </div>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveShareSettings">
          保存设置
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="logsVisible"
      :title="`下载记录${logShareName ? ` · ${logShareName}` : ''}`"
      width="720px"
    >
      <el-table :data="currentLogs" height="360" empty-text="该链接还没有下载记录">
        <el-table-column prop="ip" label="IP 地址" width="160" />
        <el-table-column label="下载时间" width="180">
          <template #default="{ row }">{{ formatDate(row.accessedAt) }}</template>
        </el-table-column>
        <el-table-column prop="userAgent" label="客户端" show-overflow-tooltip />
      </el-table>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  Check,
  Delete,
  Document,
  EditPen,
  FolderOpened,
  Link,
  Lock,
  Refresh,
  Search,
  Share,
  Unlock,
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import PageHeader from '../components/common/PageHeader.vue'
import { deleteShare, listShares, updateShare } from '../api/shares'
import type { ShareInfo, ShareLogInfo, ShareStatus } from '../types/share'
import { formatDate } from '../utils/format'

type StatusFilter = ShareStatus | 'all'
type PasswordMode = 'keep' | 'replace' | 'remove'

const router = useRouter()
const shares = ref<ShareInfo[]>([])
const loading = ref(false)
const keyword = ref('')
const statusFilter = ref<StatusFilter>('all')
const togglingIds = ref<string[]>([])
const editVisible = ref(false)
const editingShare = ref<ShareInfo | null>(null)
const saving = ref(false)
const logsVisible = ref(false)
const currentLogs = ref<ShareLogInfo[]>([])
const logShareName = ref('')
const editForm = reactive({
  isEnabled: true,
  days: 0,
  passwordMode: 'keep' as PasswordMode,
  password: '',
  limitEnabled: false,
  maxDownloads: 10,
})

const activeCount = computed(
  () => shares.value.filter((share) => effectiveStatus(share) === 'active').length,
)
const protectedCount = computed(
  () => shares.value.filter((share) => share.hasPassword || share.maxDownloads !== null).length,
)
const totalDownloads = computed(() =>
  shares.value.reduce((sum, share) => sum + share.downloadCount, 0),
)
const filteredShares = computed(() => {
  const query = keyword.value.trim().toLocaleLowerCase()
  return shares.value.filter((share) => {
    const matchesStatus =
      statusFilter.value === 'all' || effectiveStatus(share) === statusFilter.value
    const matchesKeyword =
      !query || `${share.name} ${share.path}`.toLocaleLowerCase().includes(query)
    return matchesStatus && matchesKeyword
  })
})

async function fetchShares(): Promise<void> {
  loading.value = true
  try {
    shares.value = await listShares()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '无法加载分享列表')
  } finally {
    loading.value = false
  }
}

function effectiveStatus(share: ShareInfo): ShareStatus {
  if (!share.isEnabled) return 'disabled'
  if (new Date(share.expiresAt).getTime() <= Date.now()) return 'expired'
  if (share.maxDownloads !== null && share.downloadCount >= share.maxDownloads) {
    return 'limit_reached'
  }
  return 'active'
}

function statusLabel(status: ShareStatus): string {
  return {
    active: '可用',
    disabled: '已停用',
    expired: '已过期',
    limit_reached: '次数用完',
  }[status]
}

async function copyLink(id: string): Promise<void> {
  const url = `${window.location.origin}/share/${encodeURIComponent(id)}`
  try {
    await navigator.clipboard.writeText(url)
    ElMessage.success('分享链接已复制')
  } catch {
    ElMessage.warning('浏览器不允许访问剪贴板')
  }
}

async function toggleShare(share: ShareInfo, isEnabled: boolean): Promise<void> {
  if (togglingIds.value.includes(share.id)) return
  togglingIds.value = [...togglingIds.value, share.id]
  try {
    const updated = await updateShare(share.id, { isEnabled })
    replaceShare(updated)
    ElMessage.success(isEnabled ? '分享已启用' : '分享已停用')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '状态更新失败')
  } finally {
    togglingIds.value = togglingIds.value.filter((id) => id !== share.id)
  }
}

function openEditDialog(share: ShareInfo): void {
  editingShare.value = share
  editForm.isEnabled = share.isEnabled
  editForm.days = 0
  editForm.passwordMode = 'keep'
  editForm.password = ''
  editForm.limitEnabled = share.maxDownloads !== null
  editForm.maxDownloads = share.maxDownloads || Math.max(10, share.downloadCount + 1)
  editVisible.value = true
}

function setPasswordMode(mode: PasswordMode): void {
  editForm.passwordMode = mode
  if (mode !== 'replace') editForm.password = ''
}

async function saveShareSettings(): Promise<void> {
  const share = editingShare.value
  if (!share) return
  if (editForm.passwordMode === 'replace' && editForm.password.trim().length < 4) {
    ElMessage.warning('分享密码至少需要 4 个字符')
    return
  }

  saving.value = true
  try {
    const updated = await updateShare(share.id, {
      isEnabled: editForm.isEnabled,
      days: editForm.days || undefined,
      password:
        editForm.passwordMode === 'replace'
          ? editForm.password
          : editForm.passwordMode === 'remove'
            ? null
            : undefined,
      maxDownloads: editForm.limitEnabled ? editForm.maxDownloads : null,
    })
    replaceShare(updated)
    editVisible.value = false
    ElMessage.success('分享设置已保存')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '保存设置失败')
  } finally {
    saving.value = false
  }
}

async function removeShare(share: ShareInfo): Promise<void> {
  try {
    await ElMessageBox.confirm(`删除“${share.name}”的公开分享？文件本身不会被删除。`, '删除分享', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
    await deleteShare(share.id)
    shares.value = shares.value.filter((item) => item.id !== share.id)
    ElMessage.success('分享已删除')
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(error instanceof Error ? error.message : '删除失败')
  }
}

function showLogs(share: ShareInfo): void {
  currentLogs.value = share.logs || []
  logShareName.value = share.name
  logsVisible.value = true
}

function replaceShare(updated: ShareInfo): void {
  const index = shares.value.findIndex((share) => share.id === updated.id)
  if (index >= 0) shares.value.splice(index, 1, updated)
}

onMounted(fetchShares)
</script>

<style scoped>
.share-summary {
  margin-bottom: 14px;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  background: #fff;
  border: 1px solid #dfe3eb;
}
.share-summary > div {
  min-height: 82px;
  padding: 15px 20px;
  border-right: 1px solid #e7eaf0;
}
.share-summary > div:last-child {
  border-right: 0;
}
.share-summary span,
.share-summary b {
  display: block;
}
.share-summary span {
  color: #8b95a2;
  font-size: 11px;
}
.share-summary b {
  margin-top: 6px;
  color: #2f4057;
  font-size: 22px;
  font-weight: 600;
}
.share-summary b.is-active {
  color: #00a870;
}
.share-summary b.is-protected {
  color: #d46b08;
}
.object-count {
  color: #84909f;
  font-size: 11px;
}
.shares-table {
  position: relative;
  min-height: 280px;
}
.share-file {
  display: flex;
  align-items: center;
  gap: 9px;
  color: #1677ff;
}
.share-file div {
  min-width: 0;
}
.share-file b,
.share-file span {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.share-file b {
  color: #34445a;
  font-size: 12px;
  font-weight: 500;
}
.share-file span {
  margin-top: 2px;
  color: #9aa3af;
  font-size: 10px;
}
.share-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
}
.share-status i {
  width: 6px;
  height: 6px;
  flex: none;
  border-radius: 50%;
}
.share-status.is-active {
  color: #008f5d;
}
.share-status.is-active i {
  background: #00a870;
}
.share-status.is-disabled {
  color: #ad6800;
}
.share-status.is-disabled i {
  background: #fa8c16;
}
.share-status.is-expired {
  color: #8d97a4;
}
.share-status.is-expired i {
  background: #aab2bd;
}
.share-status.is-limit_reached {
  color: #cf3f4f;
}
.share-status.is-limit_reached i {
  background: #e34d59;
}
.access-policy {
  display: grid;
  gap: 4px;
  color: #7e8997;
  font-size: 10px;
}
.access-policy span {
  display: flex;
  align-items: center;
  gap: 5px;
}
.access-policy span:first-child {
  color: #42536a;
  font-size: 11px;
}
.shares-empty {
  position: absolute;
  inset: 44px 0 0;
  min-height: 235px;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 8px;
  color: #84909f;
  background: #fff;
  text-align: center;
}
.shares-empty strong {
  color: #44536a;
  font-size: 14px;
}
.shares-empty span {
  margin-bottom: 5px;
  font-size: 11px;
}
.edit-resource {
  margin-bottom: 18px;
  padding: 12px;
  background: #f7f8fa;
}
.edit-resource span,
.edit-resource b,
.edit-resource small {
  display: block;
}
.edit-resource span {
  color: #8b95a3;
  font-size: 10px;
}
.edit-resource b {
  margin-top: 4px;
  color: #34445a;
  font-size: 13px;
}
.edit-resource small {
  margin-top: 2px;
  overflow: hidden;
  color: #929ba8;
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.setting-line {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #5f6d7e;
  font-size: 12px;
}
.password-mode-control {
  width: 100%;
  display: flex;
  align-items: stretch;
}
.password-mode-control button {
  min-width: 0;
  min-height: 34px;
  flex: 1;
  margin-left: -1px;
  padding: 0 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border: 1px solid #d8dce6;
  color: #526174;
  background: #fff;
  cursor: pointer;
  font-size: 12px;
}
.password-mode-control button:first-child {
  margin-left: 0;
}
.password-mode-control button:hover {
  position: relative;
  z-index: 1;
  color: #1677ff;
  border-color: #79adf7;
}
.password-mode-control button.is-active {
  position: relative;
  z-index: 2;
  color: #fff;
  background: #1677ff;
  border-color: #1677ff;
}
.password-mode-control button:disabled {
  color: #a8b0bb;
  background: #f4f5f7;
  border-color: #e1e4e9;
  cursor: not-allowed;
}
.password-input {
  margin-top: 10px;
}
.edit-notice {
  padding: 9px 11px;
  color: #6f7c8e;
  background: #fff8e8;
  border-left: 3px solid #f5a623;
  font-size: 11px;
}
@media (max-width: 720px) {
  .share-summary {
    grid-template-columns: repeat(2, 1fr);
  }
  .share-summary > div:nth-child(2) {
    border-right: 0;
  }
  .share-summary > div:nth-child(-n + 2) {
    border-bottom: 1px solid #e7eaf0;
  }
  .console-toolbar {
    align-items: stretch;
    flex-direction: column;
  }
  .console-toolbar__group {
    justify-content: space-between;
  }
  .console-toolbar :deep(.el-input) {
    width: 100% !important;
  }
}
</style>
