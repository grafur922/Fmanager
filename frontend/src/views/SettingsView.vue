<template>
  <div>
    <PageHeader
      eyebrow="SYSTEM PREFERENCES"
      title="传输设置"
      description="这些选项保存在当前浏览器中，并立即影响上传任务调度。服务端限制通过环境变量配置。"
    />

    <section class="settings-layout">
      <div class="console-card settings-card">
        <header class="console-card__header"><h2>上传队列</h2><span>Browser settings</span></header>
        <el-form class="settings-form" label-position="top">
          <el-form-item label="同时上传的文件数">
            <el-input-number v-model="form.concurrency" :min="1" :max="4" controls-position="right" />
            <div class="field-help">建议保持 2。提高并发会占用更多带宽和服务端磁盘 I/O。</div>
          </el-form-item>
          <el-form-item label="分片失败自动重试次数">
            <el-input-number v-model="form.chunkRetries" :min="0" :max="5" controls-position="right" />
            <div class="field-help">单个分片失败后采用退避策略重试，耗尽后任务进入“上传中断”。</div>
          </el-form-item>
          <el-form-item label="选择文件后自动开始">
            <el-switch v-model="form.autoStart" />
            <div class="field-help">关闭后，新任务会以暂停状态加入任务中心。</div>
          </el-form-item>
          <el-form-item>
            <el-button type="primary" @click="saveSettings">保存设置</el-button>
            <el-button @click="resetSettings">恢复推荐值</el-button>
          </el-form-item>
        </el-form>
      </div>

      <aside class="settings-side">
        <div class="console-card config-card">
          <header class="console-card__header"><h2>服务端上传策略</h2><span>Read only</span></header>
          <dl>
            <div><dt>分片大小</dt><dd>5 MiB</dd></div>
            <div><dt>会话保留</dt><dd>默认 24 小时</dd></div>
            <div><dt>重名策略</dt><dd>自动添加序号</dd></div>
            <div><dt>临时目录</dt><dd>data/upload_sessions</dd></div>
            <div><dt>回收站</dt><dd>独立目录持久化</dd></div>
            <div><dt>预览令牌</dt><dd>15 分钟滑动有效期</dd></div>
          </dl>
        </div>
        <div class="security-note">
          <el-icon><Warning /></el-icon>
          <div><strong>部署检查</strong><span>生产环境必须设置 JWT_SECRET、ADMIN_PASSWORD、FILE_STORAGE_DIR，并关闭 TypeORM synchronize 后使用 migration。</span></div>
        </div>
        <el-button class="cleanup-button" @click="clearResumeRecords">清除本机续传索引</el-button>
        <p class="cleanup-help">只清除浏览器中的会话索引；服务端临时分片会在会话过期后自动清理。</p>
      </aside>
    </section>
  </div>
</template>

<script setup lang="ts">
import { reactive } from 'vue'
import { Warning } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import PageHeader from '../components/common/PageHeader.vue'
import { useUploadStore } from '../stores/upload'

const uploadStore = useUploadStore()
const form = reactive({
  concurrency: uploadStore.settings.concurrency,
  chunkRetries: uploadStore.settings.chunkRetries,
  autoStart: uploadStore.settings.autoStart,
})

function saveSettings(): void {
  uploadStore.updateSettings(form)
  ElMessage.success('传输设置已保存')
}

function resetSettings(): void {
  Object.assign(form, { concurrency: 2, chunkRetries: 2, autoStart: true })
  saveSettings()
}

async function clearResumeRecords(): Promise<void> {
  try {
    await ElMessageBox.confirm('清除后，再次选择未完成文件时会创建新的上传会话。', '清除续传索引', {
      type: 'warning', confirmButtonText: '清除', cancelButtonText: '取消',
    })
    localStorage.removeItem('filehub.upload-resume-map')
    ElMessage.success('本机续传索引已清除')
  } catch {
    // User cancelled.
  }
}
</script>

<style scoped>
.settings-layout { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 16px; align-items: start; }
.settings-form { max-width: 620px; padding: 22px 22px 10px; }
.settings-form :deep(.el-form-item) { margin-bottom: 25px; }
.settings-form :deep(.el-form-item__label) { color: #405168; font-size: 12px; font-weight: 500; }
.field-help { width: 100%; margin-top: 7px; color: #8b95a2; font-size: 10px; line-height: 1.5; }
.settings-side { display: grid; gap: 12px; }
.config-card dl { margin: 0; padding: 6px 16px; }
.config-card dl > div { min-height: 44px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #edf0f4; }
.config-card dl > div:last-child { border-bottom: 0; }
.config-card dt { color: #7d8998; font-size: 11px; }
.config-card dd { color: #3d4d62; font-size: 11px; font-weight: 500; }
.security-note { padding: 13px 14px; display: flex; gap: 10px; color: #b46a00; background: #fff7e6; border: 1px solid #f4dfb3; }
.security-note strong, .security-note span { display: block; }
.security-note strong { margin-bottom: 4px; font-size: 12px; }
.security-note span { color: #866f4c; font-size: 10px; line-height: 1.6; }
.cleanup-button { width: 100%; }
.cleanup-help { margin: -4px 2px 0; color: #929ca9; font-size: 10px; line-height: 1.5; }
@media (max-width: 960px) { .settings-layout { grid-template-columns: 1fr; } }
</style>
