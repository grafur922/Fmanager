<template>
  <div v-loading="loading">
    <PageHeader
      eyebrow="FILE STORAGE"
      title="资源概览"
      description="查看本地存储资源、公开分享和最近文件变更。"
    >
      <el-button :icon="Refresh" @click="fetchStats">刷新数据</el-button>
      <el-button type="primary" :icon="Upload" @click="router.push('/files')">上传文件</el-button>
    </PageHeader>

    <section class="metric-grid">
      <article class="metric-card">
        <div class="metric-card__icon is-blue"><el-icon><Document /></el-icon></div>
        <div><span>文件总数</span><strong>{{ stats.totalFiles.toLocaleString() }}</strong><small>当前存储中的文件对象</small></div>
      </article>
      <article class="metric-card">
        <div class="metric-card__icon is-amber"><el-icon><Folder /></el-icon></div>
        <div><span>目录总数</span><strong>{{ stats.totalFolders.toLocaleString() }}</strong><small>不包含根目录</small></div>
      </article>
      <article class="metric-card">
        <div class="metric-card__icon is-green"><el-icon><Link /></el-icon></div>
        <div><span>有效分享</span><strong>{{ stats.activeShares.toLocaleString() }}</strong><small>全部分享 {{ stats.totalShares }} 个</small></div>
      </article>
      <article class="metric-card">
        <div class="metric-card__icon is-purple"><el-icon><UploadFilled /></el-icon></div>
        <div><span>传输任务</span><strong>{{ uploadStore.activeTasks.length }}</strong><small>{{ uploadStore.runningCount ? `${uploadStore.runningCount} 个正在上传` : '当前没有运行中的任务' }}</small></div>
      </article>
    </section>

    <section class="dashboard-grid">
      <div class="console-card storage-panel">
        <header class="console-card__header"><h2>存储容量</h2><span>Local File System</span></header>
        <div class="storage-panel__body">
          <div class="storage-number">
            <div><span>已使用</span><strong>{{ formatBytes(stats.totalBytes) }}</strong></div>
            <div><span>容量上限</span><b>{{ formatBytes(stats.storageLimitBytes) }}</b></div>
          </div>
          <div class="storage-track"><i :style="{ width: `${storagePercent}%` }"></i></div>
          <div class="storage-scale"><span>0 B</span><span>使用率 {{ storagePercent.toFixed(2) }}%</span><span>{{ formatBytes(stats.storageLimitBytes) }}</span></div>
          <div class="storage-note" :class="{ 'is-warning': storagePercent >= 80 }">
            <el-icon><InfoFilled /></el-icon>
            {{ storagePercent >= 80 ? '存储使用率较高，请及时清理文件或扩容。' : '容量上限由服务端 STORAGE_LIMIT_BYTES 配置，用于监控提示，不会自动扩容磁盘。' }}
          </div>
        </div>
      </div>

      <div class="console-card quick-panel">
        <header class="console-card__header"><h2>快捷操作</h2><span>Quick actions</span></header>
        <div class="quick-panel__body">
          <button type="button" @click="router.push('/files')"><el-icon><Upload /></el-icon><div><b>上传文件</b><span>分片上传与断点续传</span></div><el-icon><ArrowRight /></el-icon></button>
          <button type="button" @click="router.push('/files')"><el-icon><FolderAdd /></el-icon><div><b>创建目录</b><span>整理服务器文件层级</span></div><el-icon><ArrowRight /></el-icon></button>
          <button type="button" @click="router.push('/shares')"><el-icon><Share /></el-icon><div><b>管理分享</b><span>查看链接与访问记录</span></div><el-icon><ArrowRight /></el-icon></button>
        </div>
      </div>
    </section>

    <section class="console-card recent-panel">
      <header class="console-card__header"><h2>最近变更</h2><el-button link type="primary" @click="router.push('/files')">查看全部</el-button></header>
      <el-table :data="stats.recentFiles" empty-text="暂无文件变更">
        <el-table-column label="文件" min-width="280">
          <template #default="{ row }"><div class="recent-file"><el-icon><Document /></el-icon><div><b>{{ row.name }}</b><span>{{ row.path }}</span></div></div></template>
        </el-table-column>
        <el-table-column label="大小" width="130"><template #default="{ row }">{{ formatBytes(row.size) }}</template></el-table-column>
        <el-table-column label="修改时间" width="190"><template #default="{ row }">{{ formatDate(row.modifiedAt) }}</template></el-table-column>
      </el-table>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowRight, Document, Folder, FolderAdd, InfoFilled, Link, Refresh, Share, Upload, UploadFilled } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import PageHeader from '../components/common/PageHeader.vue'
import { getDashboardStats } from '../api/files'
import { useUploadStore } from '../stores/upload'
import type { DashboardStats } from '../types/file'
import { formatBytes, formatDate } from '../utils/format'

const router = useRouter()
const uploadStore = useUploadStore()
const loading = ref(false)
const stats = ref<DashboardStats>({
  totalFiles: 0,
  totalFolders: 0,
  totalBytes: 0,
  storageLimitBytes: 100 * 1024 ** 3,
  activeShares: 0,
  totalShares: 0,
  recentFiles: [],
})
const storagePercent = computed(() =>
  stats.value.storageLimitBytes ? Math.min(100, (stats.value.totalBytes / stats.value.storageLimitBytes) * 100) : 0,
)

async function fetchStats(): Promise<void> {
  loading.value = true
  try {
    stats.value = await getDashboardStats()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '无法获取概览数据')
  } finally {
    loading.value = false
  }
}

onMounted(fetchStats)
</script>

<style scoped>
.metric-grid { margin-bottom: 16px; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.metric-card { min-height: 116px; padding: 18px; display: flex; align-items: flex-start; gap: 14px; background: #fff; border: 1px solid #dfe3eb; }
.metric-card__icon { width: 38px; height: 38px; display: grid; place-items: center; flex: 0 0 auto; font-size: 19px; }
.metric-card__icon.is-blue { color: #1677ff; background: #eaf3ff; }
.metric-card__icon.is-amber { color: #d98b17; background: #fff5df; }
.metric-card__icon.is-green { color: #00a870; background: #e7f8f2; }
.metric-card__icon.is-purple { color: #7656d6; background: #f0ecff; }
.metric-card span, .metric-card small { display: block; }
.metric-card span { color: #7d8896; font-size: 11px; }
.metric-card strong { display: block; margin: 4px 0 3px; color: #24344a; font-size: 25px; font-weight: 600; line-height: 1.15; }
.metric-card small { color: #a0a8b2; font-size: 10px; }
.dashboard-grid { margin-bottom: 16px; display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(280px, .8fr); gap: 16px; }
.storage-panel__body { padding: 22px 20px 19px; }
.storage-number { display: flex; align-items: flex-end; justify-content: space-between; }
.storage-number span { display: block; margin-bottom: 4px; color: #8994a2; font-size: 11px; }
.storage-number strong { color: #1d2b3e; font-size: 27px; font-weight: 600; }
.storage-number b { color: #48576b; font-size: 15px; font-weight: 500; }
.storage-track { height: 12px; margin-top: 21px; background: #e8edf3; }
.storage-track i { display: block; height: 100%; min-width: 2px; background: linear-gradient(90deg, #1677ff, #55a5ff); }
.storage-scale { margin-top: 7px; display: flex; justify-content: space-between; color: #929ca9; font-size: 10px; }
.storage-note { margin-top: 19px; padding: 10px 11px; display: flex; align-items: center; gap: 7px; color: #66768b; background: #f4f7fa; font-size: 10px; }
.storage-note.is-warning { color: #9a5b00; background: #fff6df; }
.quick-panel__body button { width: 100%; min-height: 64px; padding: 0 16px; display: grid; grid-template-columns: 30px 1fr auto; align-items: center; gap: 8px; border: 0; border-bottom: 1px solid #edf0f4; color: #1677ff; background: #fff; text-align: left; cursor: pointer; }
.quick-panel__body button:last-child { border-bottom: 0; }
.quick-panel__body button:hover { background: #f7faff; }
.quick-panel__body div b, .quick-panel__body div span { display: block; }
.quick-panel__body div b { color: #33445a; font-size: 12px; }
.quick-panel__body div span { margin-top: 3px; color: #929ca9; font-size: 10px; }
.recent-file { display: flex; align-items: center; gap: 10px; color: #1677ff; }
.recent-file div { min-width: 0; }
.recent-file b, .recent-file span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.recent-file b { color: #33445a; font-size: 12px; font-weight: 500; }
.recent-file span { margin-top: 2px; color: #9aa3af; font-size: 10px; }
@media (max-width: 1100px) { .metric-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 760px) { .dashboard-grid { grid-template-columns: 1fr; } }
@media (max-width: 520px) { .metric-grid { grid-template-columns: 1fr; } }
</style>
