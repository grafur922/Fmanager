<template>
  <div>
    <PageHeader
      eyebrow="OBJECT LIFECYCLE"
      title="回收站"
      description="已删除对象保存在独立存储目录中。恢复时优先返回原路径，同名对象会自动添加序号。"
    >
      <el-button :icon="Refresh" :loading="loading" @click="fetchTrash">刷新</el-button>
      <el-button type="danger" plain :icon="Delete" :disabled="!pagination.total" @click="handleEmptyTrash">
        清空回收站
      </el-button>
    </PageHeader>

    <div class="trash-notice">
      <span class="trash-notice__icon"><el-icon><InfoFilled /></el-icon></span>
      <div>
        <strong>回收站占用独立磁盘空间</strong>
        <span>恢复不会覆盖同名文件。永久删除后，文件内容和恢复信息都会立即移除。</span>
      </div>
      <b>{{ pagination.total }} 个对象</b>
    </div>

    <div class="console-toolbar">
      <div class="console-toolbar__group">
        <span class="object-count">按删除时间倒序显示</span>
      </div>
      <el-input
        v-model="keyword"
        :prefix-icon="Search"
        clearable
        placeholder="搜索文件名或原路径"
        style="width: 280px"
      />
    </div>

    <section class="console-card trash-table">
      <el-table
        v-loading="loading"
        :data="items"
        row-key="id"
        empty-text="没有符合条件的回收对象"
        @sort-change="handleSortChange"
      >
        <el-table-column prop="name" label="对象名称" min-width="300" sortable="custom">
          <template #default="{ row }">
            <div class="trash-name">
              <span :class="{ 'is-folder': row.isDirectory }">
                <el-icon><Folder v-if="row.isDirectory" /><Document v-else /></el-icon>
              </span>
              <div><b>{{ row.name }}</b><small>{{ row.isDirectory ? '文件夹' : '文件' }}</small></div>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="originalPath" label="原路径" min-width="260" show-overflow-tooltip />
        <el-table-column prop="size" label="大小" width="120" sortable="custom">
          <template #default="{ row }">{{ row.isDirectory ? '--' : formatBytes(row.size) }}</template>
        </el-table-column>
        <el-table-column prop="deletedAt" label="删除时间" width="190" sortable="custom">
          <template #default="{ row }">{{ formatDate(row.deletedAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="175" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="handleRestore(row)">恢复</el-button>
            <el-button link type="danger" @click="handlePermanentDelete(row)">永久删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div v-if="!loading && pagination.total === 0 && !keyword" class="trash-empty">
        <span><el-icon><Delete /></el-icon></span>
        <strong>回收站为空</strong>
        <p>从文件管理中删除的对象会出现在这里。</p>
        <el-button type="primary" plain @click="router.push('/files')">返回文件管理</el-button>
      </div>

      <footer v-if="pagination.total" class="table-pagination">
        <el-pagination
          background
          layout="total, sizes, prev, pager, next"
          :total="pagination.total"
          :current-page="pagination.page"
          :page-size="pagination.pageSize"
          :page-sizes="[10, 20, 50, 100]"
          @current-change="handlePageChange"
          @size-change="handlePageSizeChange"
        />
      </footer>
    </section>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Delete, Document, Folder, InfoFilled, Refresh, Search } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import PageHeader from '../components/common/PageHeader.vue'
import {
  emptyTrash,
  listTrash,
  permanentlyDeleteTrashItem,
  restoreTrashItem,
} from '../api/files'
import type { FileSortOrder, TrashItem } from '../types/file'
import { formatBytes, formatDate } from '../utils/format'

interface SortChange {
  prop?: string
  order?: 'ascending' | 'descending' | null
}

const router = useRouter()
const items = ref<TrashItem[]>([])
const loading = ref(false)
const keyword = ref('')
const pagination = reactive({ total: 0, page: 1, pageSize: 20, totalPages: 1 })
const sorting = reactive<{
  sortBy: 'name' | 'size' | 'deletedAt'
  sortOrder: FileSortOrder
}>({ sortBy: 'deletedAt', sortOrder: 'desc' })
let requestVersion = 0
let searchTimer: number | undefined

async function fetchTrash(): Promise<void> {
  const version = ++requestVersion
  loading.value = true
  try {
    const result = await listTrash({
      page: pagination.page,
      pageSize: pagination.pageSize,
      keyword: keyword.value.trim() || undefined,
      sortBy: sorting.sortBy,
      sortOrder: sorting.sortOrder,
    })
    if (version !== requestVersion) return
    items.value = result.items
    Object.assign(pagination, result.pagination)
  } catch (error) {
    if (version === requestVersion) {
      ElMessage.error(error instanceof Error ? error.message : '无法加载回收站')
    }
  } finally {
    if (version === requestVersion) loading.value = false
  }
}

async function handleRestore(item: TrashItem): Promise<void> {
  try {
    const result = await restoreTrashItem(item.id)
    ElMessage.success(
      result.path === item.originalPath
        ? `已恢复到 ${result.path}`
        : `原路径存在同名对象，已恢复为 ${result.path}`,
    )
    await fetchTrash()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '恢复失败')
  }
}

async function handlePermanentDelete(item: TrashItem): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `永久删除“${item.name}”？删除后无法恢复。`,
      '永久删除',
      { type: 'error', confirmButtonText: '永久删除', cancelButtonText: '取消' },
    )
    await permanentlyDeleteTrashItem(item.id)
    ElMessage.success('对象已永久删除')
    await fetchTrash()
  } catch (error: any) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(error instanceof Error ? error.message : '永久删除失败')
  }
}

async function handleEmptyTrash(): Promise<void> {
  try {
    await ElMessageBox.prompt(
      `回收站中的 ${pagination.total} 个对象将被永久删除。请输入“清空”继续。`,
      '清空回收站',
      {
        type: 'error',
        confirmButtonText: '永久清空',
        cancelButtonText: '取消',
        inputPlaceholder: '清空',
        inputValidator: (value) => value === '清空' || '请输入“清空”',
      },
    )
    const deleted = await emptyTrash()
    ElMessage.success(`已永久删除 ${deleted} 个对象`)
    pagination.page = 1
    await fetchTrash()
  } catch (error: any) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(error instanceof Error ? error.message : '清空回收站失败')
  }
}

function handleSortChange(change: SortChange): void {
  sorting.sortBy = ['name', 'size', 'deletedAt'].includes(change.prop || '')
    ? (change.prop as 'name' | 'size' | 'deletedAt')
    : 'deletedAt'
  sorting.sortOrder = change.order === 'ascending' ? 'asc' : 'desc'
  pagination.page = 1
  void fetchTrash()
}

function handlePageChange(page: number): void {
  pagination.page = page
  void fetchTrash()
}

function handlePageSizeChange(pageSize: number): void {
  pagination.pageSize = pageSize
  pagination.page = 1
  void fetchTrash()
}

watch(keyword, () => {
  window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => {
    pagination.page = 1
    void fetchTrash()
  }, 320)
})

onMounted(fetchTrash)
onBeforeUnmount(() => window.clearTimeout(searchTimer))
</script>

<style scoped>
.trash-notice { min-height: 64px; margin-bottom: 14px; padding: 12px 16px; display: grid; grid-template-columns: 34px 1fr auto; align-items: center; gap: 12px; color: #53657b; background: #eef5fd; border: 1px solid #cfdef1; }
.trash-notice__icon { width: 30px; height: 30px; display: grid; place-items: center; color: #1677ff; background: #fff; }
.trash-notice strong, .trash-notice span { display: block; }
.trash-notice strong { color: #34465d; font-size: 12px; }
.trash-notice div span { margin-top: 3px; color: #7f8c9c; font-size: 10px; }
.trash-notice > b { color: #1677ff; font-size: 14px; font-weight: 600; }
.object-count { color: #84909f; font-size: 11px; }
.trash-table { position: relative; min-height: 280px; }
.trash-name { min-width: 0; display: flex; align-items: center; gap: 10px; }
.trash-name > span { width: 30px; height: 30px; display: grid; place-items: center; flex: 0 0 auto; color: #78899e; background: #f0f2f5; }
.trash-name > span.is-folder { color: #d99021; background: #fff5df; }
.trash-name div { min-width: 0; }
.trash-name b, .trash-name small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.trash-name b { color: #34445a; font-size: 12px; font-weight: 500; }
.trash-name small { margin-top: 2px; color: #9aa3af; font-size: 9px; }
.trash-empty { position: absolute; inset: 44px 0 0; min-height: 235px; display: grid; place-content: center; justify-items: center; gap: 8px; color: #8995a3; background: #fff; text-align: center; }
.trash-empty > span { width: 58px; height: 52px; display: grid; place-items: center; color: #7caeff; background: #eef6ff; font-size: 27px; }
.trash-empty strong { color: #43536a; font-size: 14px; }
.trash-empty p { margin: 0 0 5px; font-size: 11px; }
.table-pagination { min-height: 58px; padding: 12px 14px; display: flex; justify-content: flex-end; border-top: 1px solid #e7eaf0; }
@media (max-width: 700px) { .trash-notice { grid-template-columns: 34px 1fr; } .trash-notice > b { grid-column: 2; } .console-toolbar { align-items: stretch; flex-direction: column; } .console-toolbar :deep(.el-input) { width: 100% !important; } .table-pagination { justify-content: flex-start; overflow-x: auto; } }
</style>
