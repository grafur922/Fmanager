<template>
  <div class="files-page" @dragenter.prevent="dragging = true">
    <PageHeader
      eyebrow="RESOURCE MANAGEMENT"
      title="文件管理"
      description="服务端分页管理本地存储目录。大文件自动分片，网络中断后可从已完成分片继续。"
    >
      <el-button :icon="FolderAdd" @click="handleCreateFolder">新建文件夹</el-button>
      <el-button type="primary" :icon="Upload" @click="openFilePicker">上传文件</el-button>
      <input ref="fileInput" hidden type="file" multiple @change="handleFileSelection" />
    </PageHeader>

    <div class="path-rail">
      <div class="path-rail__label">当前路径</div>
      <div class="path-rail__crumbs">
        <button type="button" @click="navigateTo('/')">
          <el-icon><HomeFilled /></el-icon>root
        </button>
        <template v-for="(part, index) in pathParts" :key="`${part}-${index}`">
          <span>/</span>
          <button type="button" @click="navigateToPart(index)">{{ part }}</button>
        </template>
      </div>
      <button class="path-rail__copy" type="button" @click="copyCurrentPath">
        <el-icon><CopyDocument /></el-icon>复制路径
      </button>
    </div>

    <div class="console-toolbar">
      <div class="console-toolbar__group">
        <el-button :icon="Refresh" :loading="loading" @click="fetchFiles(currentPath)"
          >刷新</el-button
        >
        <span class="object-count">共 {{ pagination.total }} 个对象</span>
      </div>
      <div class="console-toolbar__group">
        <el-input
          v-model="keyword"
          :prefix-icon="Search"
          clearable
          placeholder="服务端搜索文件名"
          style="width: 260px"
        />
      </div>
    </div>

    <transition name="batch-bar">
      <div v-if="selectedRows.length" class="batch-bar">
        <div class="batch-bar__summary">
          <span class="batch-bar__check"
            ><el-icon><Check /></el-icon
          ></span>
          已选择 <b>{{ selectedRows.length }}</b> 个对象
          <span class="batch-bar__size">文件合计 {{ formatBytes(selectedFileBytes) }}</span>
        </div>
        <div class="batch-bar__actions">
          <el-button :icon="Rank" @click="openMoveDialog">移动到</el-button>
          <el-button type="danger" plain :icon="Delete" @click="handleBatchDelete"
            >移入回收站</el-button
          >
          <el-button link @click="clearSelection">取消选择</el-button>
        </div>
      </div>
    </transition>

    <div class="file-table console-card">
      <el-table
        ref="fileTable"
        v-loading="loading"
        :data="files"
        row-key="name"
        empty-text="没有符合条件的对象"
        @row-click="handleRowClick"
        @selection-change="handleSelectionChange"
        @sort-change="handleSortChange"
      >
        <el-table-column type="selection" width="46" />
        <el-table-column prop="name" label="文件名" min-width="310" sortable="custom">
          <template #default="{ row }">
            <div class="file-name-cell">
              <div
                class="file-type-icon"
                :class="row.isDirectory ? 'is-folder' : fileIconClass(row.name)"
              >
                <el-icon><Folder v-if="row.isDirectory" /><Document v-else /></el-icon>
              </div>
              <div>
                <button type="button" class="file-link" @click.stop="handleRowClick(row)">
                  {{ row.name }}
                </button>
                <span>{{ row.isDirectory ? '文件夹' : extensionLabel(row.name) }}</span>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="size" label="大小" width="130" sortable="custom">
          <template #default="{ row }">{{
            row.isDirectory ? '--' : formatBytes(row.size)
          }}</template>
        </el-table-column>
        <el-table-column prop="modifiedAt" label="修改时间" width="190" sortable="custom">
          <template #default="{ row }">{{ formatDate(row.modifiedAt) }}</template>
        </el-table-column>
        <el-table-column label="存储类型" width="120"
          ><span class="storage-class">标准</span></el-table-column
        >
        <el-table-column label="操作" width="230" fixed="right">
          <template #default="{ row }">
            <div class="row-actions" @click.stop>
              <el-button v-if="!row.isDirectory" link type="primary" @click="openPreview(row)"
                >预览</el-button
              >
              <el-button v-if="!row.isDirectory" link type="primary" @click="handleDownload(row)"
                >下载</el-button
              >
              <el-dropdown
                trigger="click"
                @command="(command: string) => handleCommand(command, row)"
              >
                <el-button link type="primary"
                  >更多<el-icon class="el-icon--right"><ArrowDown /></el-icon
                ></el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item v-if="!row.isDirectory" command="share"
                      >创建分享</el-dropdown-item
                    >
                    <el-dropdown-item command="rename">重命名</el-dropdown-item>
                    <el-dropdown-item command="delete" divided class="danger-menu-item"
                      >移入回收站</el-dropdown-item
                    >
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </template>
        </el-table-column>
      </el-table>

      <div v-if="!loading && pagination.total === 0 && !keyword" class="file-empty-guide">
        <div class="file-empty-guide__visual">
          <el-icon><UploadFilled /></el-icon>
        </div>
        <strong>这个目录还没有文件</strong>
        <p>将文件拖到此处，或使用右上角“上传文件”。</p>
        <el-button type="primary" plain @click="openFilePicker">选择文件</el-button>
      </div>

      <footer v-if="pagination.total > 0" class="table-pagination">
        <el-pagination
          background
          layout="total, sizes, prev, pager, next, jumper"
          :total="pagination.total"
          :current-page="pagination.page"
          :page-size="pagination.pageSize"
          :page-sizes="[10, 20, 50, 100]"
          @current-change="handlePageChange"
          @size-change="handlePageSizeChange"
        />
      </footer>
    </div>

    <transition name="drop-overlay">
      <div
        v-if="dragging"
        class="drop-overlay"
        @dragover.prevent
        @dragleave.self.prevent="dragging = false"
        @drop.prevent="handleDrop"
      >
        <div>
          <el-icon :size="52"><UploadFilled /></el-icon>
          <strong>上传到 {{ currentPath }}</strong>
          <span>松开鼠标即可加入分片上传队列</span>
        </div>
      </div>
    </transition>

    <el-dialog v-model="moveDialogVisible" title="批量移动" width="500px">
      <div class="move-summary">
        <el-icon><Rank /></el-icon>
        <div>
          <strong>移动 {{ selectedRows.length }} 个对象</strong
          ><span>同名对象会自动添加序号，不会覆盖已有文件。</span>
        </div>
      </div>
      <el-form label-position="top">
        <el-form-item label="目标目录路径">
          <el-input
            v-model="moveTarget"
            placeholder="例如：/archive/2026"
            @keyup.enter="submitBatchMove"
          />
        </el-form-item>
        <div class="move-shortcuts">
          <span>快速选择</span>
          <button type="button" @click="moveTarget = '/'">根目录 /</button>
          <button v-if="currentPath !== '/'" type="button" @click="moveTarget = parentPath">
            上级目录 {{ parentPath }}
          </button>
        </div>
        <div class="dialog-tip">移动目录时，目标路径不能是该目录自身或它的子目录。</div>
      </el-form>
      <template #footer>
        <el-button @click="moveDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="moving" @click="submitBatchMove">开始移动</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="shareDialogVisible" title="创建公开分享" width="480px">
      <div class="dialog-resource">
        <span>分享对象</span><b>{{ currentShareFile?.name }}</b>
      </div>
      <el-form label-position="top">
        <el-form-item label="有效期">
          <el-select v-model="shareDays" style="width: 100%">
            <el-option label="1 天" :value="1" />
            <el-option label="7 天" :value="7" />
            <el-option label="30 天" :value="30" />
            <el-option label="365 天" :value="365" />
          </el-select>
        </el-form-item>
        <el-form-item label="访问密码">
          <div class="share-control-row">
            <span>密码验证</span>
            <el-switch v-model="sharePasswordEnabled" />
          </div>
          <el-input
            v-if="sharePasswordEnabled"
            v-model="sharePassword"
            type="password"
            show-password
            maxlength="64"
            placeholder="4 到 64 个字符"
            @keyup.enter="submitShare"
          />
        </el-form-item>
        <el-form-item label="下载次数">
          <div class="share-control-row">
            <span>限制总下载次数</span>
            <el-switch v-model="shareLimitEnabled" />
          </div>
          <el-input-number
            v-if="shareLimitEnabled"
            v-model="shareMaxDownloads"
            :min="1"
            :max="1000000"
            controls-position="right"
            style="width: 100%"
          />
        </el-form-item>
        <div class="dialog-tip">链接到期、停用或达到下载上限后会立即拒绝访问。</div>
      </el-form>
      <template #footer>
        <el-button @click="shareDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="sharing" @click="submitShare">创建分享</el-button>
      </template>
    </el-dialog>

    <FilePreviewDrawer
      v-model="previewVisible"
      :file-path="previewPath"
      :file-name="previewFile?.name || ''"
      @download="previewFile && handleDownload(previewFile)"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  ArrowDown,
  Check,
  CopyDocument,
  Delete,
  Document,
  Folder,
  FolderAdd,
  HomeFilled,
  Rank,
  Refresh,
  Search,
  Upload,
  UploadFilled,
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import PageHeader from '../components/common/PageHeader.vue'
import FilePreviewDrawer from '../components/file/FilePreviewDrawer.vue'
import {
  createFolder,
  deleteFile,
  deleteFiles,
  downloadFile,
  listFiles,
  moveFiles,
  renameFile,
} from '../api/files'
import { createShare } from '../api/shares'
import { formatBytes, formatDate, getFileExtension, joinPath } from '../utils/format'
import { useUploadStore } from '../stores/upload'
import type { BatchOperationResult, FileInfo, FileSortBy, FileSortOrder } from '../types/file'

interface SortChange {
  prop?: string
  order?: 'ascending' | 'descending' | null
}

interface TableColumnInfo {
  type?: string
}

const uploadStore = useUploadStore()
const currentPath = ref('/')
const files = ref<FileInfo[]>([])
const loading = ref(false)
const keyword = ref('')
const fileInput = ref<HTMLInputElement>()
const fileTable = ref<{ clearSelection: () => void }>()
const dragging = ref(false)
const selectedRows = ref<FileInfo[]>([])
const moveDialogVisible = ref(false)
const moveTarget = ref('/')
const moving = ref(false)
const shareDialogVisible = ref(false)
const currentShareFile = ref<FileInfo | null>(null)
const shareDays = ref(7)
const sharePasswordEnabled = ref(false)
const sharePassword = ref('')
const shareLimitEnabled = ref(false)
const shareMaxDownloads = ref(10)
const sharing = ref(false)
const previewVisible = ref(false)
const previewFile = ref<FileInfo | null>(null)
const pagination = reactive({ total: 0, page: 1, pageSize: 20, totalPages: 1 })
const sorting = reactive<{ sortBy: FileSortBy; sortOrder: FileSortOrder }>({
  sortBy: 'name',
  sortOrder: 'asc',
})

let searchTimer: number | undefined
let requestVersion = 0
let suppressKeywordFetch = false

const pathParts = computed(() => currentPath.value.split('/').filter(Boolean))
const parentPath = computed(() => {
  if (currentPath.value === '/') return '/'
  const parts = pathParts.value.slice(0, -1)
  return parts.length ? `/${parts.join('/')}` : '/'
})
const selectedFileBytes = computed(() =>
  selectedRows.value.reduce((sum, file) => sum + (file.isDirectory ? 0 : file.size), 0),
)
const selectedPaths = computed(() =>
  selectedRows.value.map((file) => joinPath(currentPath.value, file.name)),
)
const previewPath = computed(() =>
  previewFile.value ? joinPath(currentPath.value, previewFile.value.name) : '',
)

async function fetchFiles(path = currentPath.value): Promise<void> {
  const version = ++requestVersion
  loading.value = true
  try {
    const result = await listFiles({
      path,
      page: pagination.page,
      pageSize: pagination.pageSize,
      keyword: keyword.value.trim() || undefined,
      sortBy: sorting.sortBy,
      sortOrder: sorting.sortOrder,
    })
    if (version !== requestVersion) return
    currentPath.value = result.path
    files.value = result.files
    Object.assign(pagination, result.pagination)
    clearSelection()
  } catch (error) {
    if (version === requestVersion) {
      ElMessage.error(error instanceof Error ? error.message : '无法加载文件列表')
    }
  } finally {
    if (version === requestVersion) loading.value = false
  }
}

function navigateTo(path: string): void {
  if (keyword.value) {
    suppressKeywordFetch = true
    keyword.value = ''
  }
  pagination.page = 1
  void fetchFiles(path)
}

function navigateToPart(index: number): void {
  navigateTo(`/${pathParts.value.slice(0, index + 1).join('/')}`)
}

function handleRowClick(file: FileInfo, column?: TableColumnInfo): void {
  if (column?.type === 'selection') return
  if (file.isDirectory) navigateTo(joinPath(currentPath.value, file.name))
  else openPreview(file)
}

function handleSelectionChange(rows: FileInfo[]): void {
  selectedRows.value = rows
}

function clearSelection(): void {
  selectedRows.value = []
  void nextTick(() => fileTable.value?.clearSelection())
}

function handleSortChange(change: SortChange): void {
  sorting.sortBy = ['name', 'size', 'modifiedAt', 'type'].includes(change.prop || '')
    ? (change.prop as FileSortBy)
    : 'name'
  sorting.sortOrder = change.order === 'descending' ? 'desc' : 'asc'
  pagination.page = 1
  void fetchFiles()
}

function handlePageChange(page: number): void {
  pagination.page = page
  void fetchFiles()
}

function handlePageSizeChange(pageSize: number): void {
  pagination.pageSize = pageSize
  pagination.page = 1
  void fetchFiles()
}

function openFilePicker(): void {
  fileInput.value?.click()
}

function handleFileSelection(event: Event): void {
  const input = event.target as HTMLInputElement
  if (input.files?.length) uploadStore.addFiles(input.files, currentPath.value)
  input.value = ''
}

function handleDrop(event: DragEvent): void {
  dragging.value = false
  if (event.dataTransfer?.files.length)
    uploadStore.addFiles(event.dataTransfer.files, currentPath.value)
}

async function handleCreateFolder(): Promise<void> {
  try {
    const { value } = await ElMessageBox.prompt('请输入文件夹名称', '新建文件夹', {
      confirmButtonText: '创建',
      cancelButtonText: '取消',
      inputValidator: (input) => {
        if (!input?.trim()) return '名称不能为空'
        if (/[/\\<>:"|?*]/.test(input) || /[. ]$/.test(input)) return '名称包含不支持的字符'
        return true
      },
    })
    await createFolder(currentPath.value, value.trim())
    ElMessage.success('文件夹已创建')
    await fetchFiles()
  } catch (error: any) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(error instanceof Error ? error.message : '创建失败')
  }
}

async function handleDownload(file: FileInfo): Promise<void> {
  try {
    await downloadFile(joinPath(currentPath.value, file.name), file.name)
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '下载失败')
  }
}

function handleCommand(command: string, file: FileInfo): void {
  if (command === 'share') openShareDialog(file)
  if (command === 'rename') void handleRename(file)
  if (command === 'delete') void handleDelete(file)
}

function openPreview(file: FileInfo): void {
  previewFile.value = file
  previewVisible.value = true
}

async function handleRename(file: FileInfo): Promise<void> {
  try {
    const { value } = await ElMessageBox.prompt('输入新的名称', `重命名 ${file.name}`, {
      inputValue: file.name,
      confirmButtonText: '保存',
      cancelButtonText: '取消',
      inputValidator: (input) => Boolean(input?.trim()) || '名称不能为空',
    })
    if (value.trim() === file.name) return
    await renameFile(joinPath(currentPath.value, file.name), value.trim())
    ElMessage.success('重命名成功')
    await fetchFiles()
  } catch (error: any) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(error instanceof Error ? error.message : '重命名失败')
  }
}

async function handleDelete(file: FileInfo): Promise<void> {
  try {
    await ElMessageBox.confirm(
      file.isDirectory
        ? `将文件夹“${file.name}”及其中的全部内容移入回收站。`
        : `将文件“${file.name}”移入回收站。`,
      '移入回收站',
      { type: 'warning', confirmButtonText: '移入回收站', cancelButtonText: '取消' },
    )
    await deleteFile(joinPath(currentPath.value, file.name))
    ElMessage.success('已移入回收站，可在回收站中恢复')
    await fetchFiles()
  } catch (error: any) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(error instanceof Error ? error.message : '删除失败')
  }
}

async function handleBatchDelete(): Promise<void> {
  const count = selectedRows.value.length
  const directoryCount = selectedRows.value.filter((item) => item.isDirectory).length
  try {
    await ElMessageBox.confirm(
      `将选中的 ${count} 个对象${directoryCount ? `，其中包含 ${directoryCount} 个目录及其全部内容` : ''}移入回收站。`,
      '批量移入回收站',
      { type: 'warning', confirmButtonText: `移动 ${count} 个对象`, cancelButtonText: '取消' },
    )
    const result = await deleteFiles(selectedPaths.value)
    reportBatchResult(result, '移入回收站')
    await fetchFiles()
  } catch (error: any) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(error instanceof Error ? error.message : '批量删除失败')
  }
}

function openMoveDialog(): void {
  moveTarget.value = parentPath.value
  moveDialogVisible.value = true
}

async function submitBatchMove(): Promise<void> {
  const target = normalizeTargetPath(moveTarget.value)
  if (!target) {
    ElMessage.warning('请输入目标目录')
    return
  }
  if (target === currentPath.value) {
    ElMessage.warning('目标目录不能与当前目录相同')
    return
  }
  moving.value = true
  try {
    const result = await moveFiles(selectedPaths.value, target)
    reportBatchResult(result, '移动')
    moveDialogVisible.value = false
    await fetchFiles()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '批量移动失败')
  } finally {
    moving.value = false
  }
}

function reportBatchResult(result: BatchOperationResult, action: string): void {
  if (!result.failed) {
    ElMessage.success(`已${action} ${result.succeeded} 个对象`)
    return
  }
  const details = result.items
    .filter((item) => !item.success)
    .slice(0, 8)
    .map((item) => `${item.path}：${item.message || '操作失败'}`)
    .join('\n')
  ElMessage.warning(`${action}完成：成功 ${result.succeeded} 个，失败 ${result.failed} 个`)
  void ElMessageBox.alert(details, `${action}失败明细`, { confirmButtonText: '知道了' })
}

function normalizeTargetPath(value: string): string {
  const normalized = value.trim().replace(/\\/g, '/')
  if (!normalized) return ''
  const withRoot = normalized.startsWith('/') ? normalized : `/${normalized}`
  return withRoot.length > 1 ? withRoot.replace(/\/+$/, '') : '/'
}

function openShareDialog(file: FileInfo): void {
  currentShareFile.value = file
  shareDays.value = 7
  sharePasswordEnabled.value = false
  sharePassword.value = ''
  shareLimitEnabled.value = false
  shareMaxDownloads.value = 10
  shareDialogVisible.value = true
}

async function submitShare(): Promise<void> {
  if (!currentShareFile.value) return
  if (sharePasswordEnabled.value && sharePassword.value.trim().length < 4) {
    ElMessage.warning('分享密码至少需要 4 个字符')
    return
  }
  sharing.value = true
  try {
    await createShare({
      path: joinPath(currentPath.value, currentShareFile.value.name),
      days: shareDays.value,
      password: sharePasswordEnabled.value ? sharePassword.value : undefined,
      maxDownloads: shareLimitEnabled.value ? shareMaxDownloads.value : null,
    })
    ElMessage.success('公开分享已创建')
    shareDialogVisible.value = false
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '创建分享失败')
  } finally {
    sharing.value = false
  }
}

async function copyCurrentPath(): Promise<void> {
  try {
    await navigator.clipboard.writeText(currentPath.value)
    ElMessage.success('路径已复制')
  } catch {
    ElMessage.warning('浏览器不允许访问剪贴板')
  }
}

function extensionLabel(name: string): string {
  const extension = getFileExtension(name)
  return extension ? `${extension.toUpperCase()} 文件` : '文件'
}

function fileIconClass(name: string): string {
  const extension = getFileExtension(name)
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(extension)) return 'is-image'
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(extension)) return 'is-archive'
  if (['mp4', 'mov', 'mkv', 'mp3', 'wav'].includes(extension)) return 'is-media'
  if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(extension)) return 'is-office'
  return 'is-file'
}

function handleWindowDragEnd(event: DragEvent): void {
  if (!event.relatedTarget) dragging.value = false
}

function handleWindowDrop(): void {
  dragging.value = false
}

watch(keyword, () => {
  if (suppressKeywordFetch) {
    suppressKeywordFetch = false
    return
  }
  window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => {
    pagination.page = 1
    void fetchFiles()
  }, 320)
})

watch(
  () => uploadStore.completedVersion,
  () => void fetchFiles(),
)

onMounted(() => {
  void fetchFiles('/')
  window.addEventListener('dragleave', handleWindowDragEnd)
  window.addEventListener('drop', handleWindowDrop)
})

onBeforeUnmount(() => {
  window.clearTimeout(searchTimer)
  window.removeEventListener('dragleave', handleWindowDragEnd)
  window.removeEventListener('drop', handleWindowDrop)
})
</script>

<style scoped>
.path-rail {
  height: 46px;
  margin-bottom: 12px;
  padding: 0 13px;
  display: flex;
  align-items: center;
  background: #eef4fb;
  border: 1px solid #d8e5f5;
  color: #52647a;
  font-size: 12px;
}
.path-rail__label {
  margin-right: 14px;
  color: #8492a6;
}
.path-rail__crumbs {
  min-width: 0;
  flex: 1;
  display: flex;
  align-items: center;
  gap: 7px;
  overflow: hidden;
}
.path-rail__crumbs button,
.path-rail__copy {
  padding: 0;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 0;
  color: #1677ff;
  background: transparent;
  cursor: pointer;
  white-space: nowrap;
}
.path-rail__copy {
  margin-left: 12px;
  color: #607087;
}
.object-count {
  margin-left: 4px;
  color: #8a95a3;
  font-size: 11px;
}
.batch-bar {
  min-height: 52px;
  padding: 8px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  color: #3e5068;
  background: #eaf3ff;
  border: 1px solid #bcd8fb;
  border-bottom: 0;
  font-size: 12px;
}
.batch-bar__summary,
.batch-bar__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.batch-bar__check {
  width: 23px;
  height: 23px;
  display: grid;
  place-items: center;
  color: #fff;
  background: #1677ff;
}
.batch-bar__summary b {
  color: #1677ff;
  font-size: 14px;
}
.batch-bar__size {
  margin-left: 6px;
  color: #7e8b9b;
  font-size: 10px;
}
.batch-bar-enter-active,
.batch-bar-leave-active {
  transition:
    opacity 0.12s ease,
    transform 0.12s ease;
}
.batch-bar-enter-from,
.batch-bar-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
.file-table {
  position: relative;
  min-height: 280px;
}
.file-name-cell {
  display: flex;
  align-items: center;
  gap: 10px;
}
.file-type-icon {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  color: #7c8b9f;
  background: #f0f2f5;
  font-size: 16px;
}
.file-type-icon.is-folder {
  color: #e99922;
  background: #fff5df;
}
.file-type-icon.is-image {
  color: #00a870;
  background: #e8f8f3;
}
.file-type-icon.is-archive {
  color: #7b61d1;
  background: #f1edff;
}
.file-type-icon.is-media {
  color: #e05b73;
  background: #fff0f3;
}
.file-type-icon.is-office {
  color: #1677ff;
  background: #eaf3ff;
}
.file-name-cell > div:last-child {
  min-width: 0;
}
.file-link {
  max-width: 100%;
  padding: 0;
  display: block;
  overflow: hidden;
  border: 0;
  color: #1769c2;
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.file-link:hover {
  text-decoration: underline;
}
.file-name-cell span {
  display: block;
  margin-top: 2px;
  color: #a0a8b3;
  font-size: 10px;
}
.storage-class {
  padding: 2px 7px;
  color: #4f6b8f;
  background: #edf3fa;
  font-size: 10px;
}
.row-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}
.table-pagination {
  min-height: 58px;
  padding: 12px 14px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  border-top: 1px solid #e7eaf0;
  background: #fff;
}
.file-empty-guide {
  position: absolute;
  inset: 44px 0 0;
  min-height: 235px;
  display: grid;
  place-content: center;
  justify-items: center;
  background: #fff;
  color: #84909f;
  text-align: center;
}
.file-empty-guide__visual {
  width: 62px;
  height: 52px;
  margin-bottom: 10px;
  display: grid;
  place-items: center;
  color: #6daeff;
  background: #eef6ff;
  font-size: 28px;
}
.file-empty-guide strong {
  color: #44536a;
  font-size: 14px;
}
.file-empty-guide p {
  margin: 6px 0 14px;
  font-size: 12px;
}
.drop-overlay {
  position: fixed;
  inset: 52px 0 0 208px;
  z-index: 900;
  display: grid;
  place-items: center;
  background: rgb(235 245 255 / 88%);
  border: 2px dashed #4096ff;
  backdrop-filter: blur(2px);
}
.drop-overlay > div {
  display: grid;
  justify-items: center;
  gap: 9px;
  color: #1677ff;
}
.drop-overlay strong {
  font-size: 19px;
}
.drop-overlay span {
  color: #68809d;
  font-size: 12px;
}
.drop-overlay-enter-active,
.drop-overlay-leave-active {
  transition: opacity 0.14s ease;
}
.drop-overlay-enter-from,
.drop-overlay-leave-to {
  opacity: 0;
}
.dialog-resource,
.move-summary {
  margin-bottom: 18px;
  padding: 12px;
  background: #f7f8fa;
}
.dialog-resource span,
.dialog-resource b {
  display: block;
}
.dialog-resource span {
  color: #8b95a3;
  font-size: 11px;
}
.dialog-resource b {
  margin-top: 4px;
  color: #34445a;
  font-size: 13px;
}
.share-control-row {
  width: 100%;
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #5f6d7e;
  font-size: 12px;
}
.move-summary {
  display: flex;
  align-items: center;
  gap: 11px;
  color: #1677ff;
}
.move-summary strong,
.move-summary span {
  display: block;
}
.move-summary strong {
  color: #34445a;
  font-size: 13px;
}
.move-summary span {
  margin-top: 3px;
  color: #8b95a3;
  font-size: 10px;
}
.move-shortcuts {
  margin: -5px 0 14px;
  display: flex;
  align-items: center;
  gap: 9px;
  color: #8b95a3;
  font-size: 10px;
}
.move-shortcuts button {
  padding: 0;
  border: 0;
  color: #1677ff;
  background: transparent;
  cursor: pointer;
  font-size: 10px;
}
.dialog-tip {
  padding: 9px 11px;
  color: #6f7c8e;
  background: #fff8e8;
  border-left: 3px solid #f5a623;
  font-size: 11px;
}
:global(.danger-menu-item) {
  color: #d54941 !important;
}
@media (max-width: 900px) {
  .drop-overlay {
    left: 64px;
  }
  .batch-bar {
    align-items: flex-start;
    flex-direction: column;
  }
}
@media (max-width: 700px) {
  .console-toolbar {
    align-items: stretch;
    flex-direction: column;
  }
  .console-toolbar__group:last-child :deep(.el-input) {
    width: 100% !important;
  }
  .path-rail__label,
  .path-rail__copy {
    display: none;
  }
  .batch-bar__actions {
    flex-wrap: wrap;
  }
  .table-pagination {
    justify-content: flex-start;
    overflow-x: auto;
  }
}
</style>
