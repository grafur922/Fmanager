<template>
  <transition name="task-center">
    <aside
      v-if="uploadStore.isPanelOpen"
      class="upload-center"
      aria-label="上传任务中心"
    >
      <header class="upload-center__header">
        <div>
          <strong>传输任务</strong>
          <span v-if="uploadStore.runningCount"
            >{{ uploadStore.runningCount }} 个正在处理</span
          >
          <span v-else>{{ uploadStore.tasks.length }} 个任务</span>
        </div>
        <div class="upload-center__header-actions">
          <button
            v-if="hasFinished"
            type="button"
            @click="uploadStore.clearFinished"
          >
            清除已完成
          </button>
          <el-button
            link
            :icon="Close"
            aria-label="收起任务中心"
            @click="uploadStore.isPanelOpen = false"
          />
        </div>
      </header>

      <div v-if="uploadStore.tasks.length" class="upload-center__summary">
        <span>总进度</span>
        <el-progress
          :percentage="uploadStore.aggregateProgress"
          :stroke-width="6"
          :show-text="false"
        />
        <b>{{ uploadStore.aggregateProgress }}%</b>
      </div>

      <div class="upload-center__list">
        <article
          v-for="task in uploadStore.tasks"
          :key="task.id"
          class="upload-task"
        >
          <div class="upload-task__icon" :class="`is-${task.status}`">
            <el-icon><Document /></el-icon>
          </div>
          <div class="upload-task__body">
            <div class="upload-task__name" :title="task.fileName">
              {{ task.fileName }}
            </div>
            <div class="upload-task__meta">
              <span>{{ formatBytes(task.fileSize) }}</span>
              <span
                v-if="task.status === 'success' && task.instantUpload"
                class="upload-task__instant"
              >
                秒传
              </span>
              <span>至 {{ task.targetPath }}</span>
            </div>
            <el-progress
              :percentage="Math.round(task.progress)"
              :stroke-width="5"
              :status="
                task.status === 'success'
                  ? 'success'
                  : task.status === 'error'
                    ? 'exception'
                    : undefined
              "
              :show-text="false"
            />
            <div class="upload-task__status" :class="`is-${task.status}`">
              <span>{{ statusText(task) }}</span>
              <span v-if="task.status === 'uploading' && task.speed"
                >{{ formatBytes(task.speed) }}/s</span
              >
              <span v-else-if="task.status === 'uploading'"
                >{{ Math.round(task.progress) }}%</span
              >
            </div>
          </div>
          <div class="upload-task__actions">
            <el-tooltip
              v-if="
                ['queued', 'hashing', 'initializing', 'uploading'].includes(
                  task.status,
                )
              "
              content="暂停"
            >
              <el-button
                circle
                text
                :icon="VideoPause"
                @click="uploadStore.pauseTask(task.id)"
              />
            </el-tooltip>
            <el-tooltip v-if="task.status === 'paused'" content="继续">
              <el-button
                circle
                text
                type="primary"
                :icon="VideoPlay"
                @click="uploadStore.resumeTask(task.id)"
              />
            </el-tooltip>
            <el-tooltip v-if="task.status === 'error'" content="重试并续传">
              <el-button
                circle
                text
                type="primary"
                :icon="RefreshRight"
                @click="uploadStore.retryTask(task.id)"
              />
            </el-tooltip>
            <el-tooltip
              v-if="!['success', 'cancelled'].includes(task.status)"
              :content="task.uploadId ? '取消并删除临时分片' : '取消任务'"
            >
              <el-button
                circle
                text
                :icon="Close"
                @click="uploadStore.cancelTask(task.id)"
              />
            </el-tooltip>
            <el-tooltip v-else content="移除记录">
              <el-button
                circle
                text
                :icon="Close"
                @click="uploadStore.removeTask(task.id)"
              />
            </el-tooltip>
          </div>
        </article>

        <div v-if="!uploadStore.tasks.length" class="upload-center__empty">
          <el-icon :size="32"><UploadFilled /></el-icon>
          <span>暂无传输任务</span>
        </div>
      </div>
    </aside>
  </transition>
</template>

<script setup lang="ts">
import { computed } from "vue";
import {
  Close,
  Document,
  RefreshRight,
  UploadFilled,
  VideoPause,
  VideoPlay,
} from "@element-plus/icons-vue";
import { useUploadStore } from "../../stores/upload";
import type { UploadTask } from "../../types/file";
import { formatBytes } from "../../utils/format";

const uploadStore = useUploadStore();
const hasFinished = computed(() =>
  uploadStore.tasks.some((task) =>
    ["success", "cancelled"].includes(task.status),
  ),
);

const labels: Record<UploadTask["status"], string> = {
  queued: "等待上传",
  hashing: "正在计算 SHA-256",
  initializing: "正在检查可续传分片",
  uploading: "正在上传",
  paused: "已暂停，分片已保留",
  completing: "正在合并分片",
  success: "上传完成",
  error: "上传中断",
  cancelled: "已取消",
};

function statusText(task: UploadTask): string {
  if (task.status === "error" && task.error) return task.error;
  if (task.status === "success" && task.instantUpload) {
    return task.resultName && task.resultName !== task.fileName
      ? `秒传完成，已保存为 ${task.resultName}`
      : "秒传完成";
  }
  if (
    task.status === "success" &&
    task.resultName &&
    task.resultName !== task.fileName
  ) {
    return `已保存为 ${task.resultName}`;
  }
  return labels[task.status];
}
</script>

<style scoped>
.upload-center {
  position: fixed;
  right: 20px;
  bottom: 18px;
  z-index: 1200;
  width: min(460px, calc(100vw - 32px));
  background: #fff;
  border: 1px solid #d8dce6;
  box-shadow: 0 10px 32px rgb(17 33 65 / 18%);
}

.upload-center__header {
  min-height: 52px;
  padding: 0 14px 0 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #f7f8fa;
  border-bottom: 1px solid #e5e8ef;
}

.upload-center__header strong {
  display: block;
  color: #1f2d3d;
  font-size: 14px;
}
.upload-center__header span {
  display: block;
  margin-top: 2px;
  color: #86909c;
  font-size: 12px;
}
.upload-center__header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.upload-center__header-actions > button:first-child {
  border: 0;
  background: transparent;
  color: #1677ff;
  font-size: 12px;
  cursor: pointer;
}

.upload-center__summary {
  display: grid;
  grid-template-columns: 48px 1fr 36px;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  color: #5f6b7a;
  font-size: 12px;
  border-bottom: 1px solid #eef0f4;
}
.upload-center__summary b {
  text-align: right;
  color: #1f2d3d;
  font-weight: 500;
}
.upload-center__list {
  max-height: 430px;
  overflow: auto;
}

.upload-task {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr) auto;
  gap: 10px;
  padding: 14px 12px 12px 16px;
  border-bottom: 1px solid #eef0f4;
}
.upload-task:last-child {
  border-bottom: 0;
}
.upload-task__icon {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  color: #1677ff;
  background: #eaf3ff;
}
.upload-task__icon.is-success {
  color: #00a870;
  background: #e7f8f2;
}
.upload-task__icon.is-error {
  color: #e34d59;
  background: #fff0f1;
}
.upload-task__icon.is-cancelled {
  color: #86909c;
  background: #f2f3f5;
}
.upload-task__body {
  min-width: 0;
}
.upload-task__name {
  overflow: hidden;
  color: #1f2d3d;
  font-size: 13px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.upload-task__meta {
  display: flex;
  gap: 10px;
  margin: 4px 0 8px;
  color: #9aa3af;
  font-size: 11px;
}
.upload-task__meta .upload-task__instant {
  flex: none;
  color: #00a870;
  font-weight: 500;
}
.upload-task__meta span:last-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.upload-task__status {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-top: 5px;
  color: #6b7785;
  font-size: 11px;
}
.upload-task__status span:first-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.upload-task__status.is-error {
  color: #d54941;
}
.upload-task__status.is-success {
  color: #00a870;
}
.upload-task__actions {
  display: flex;
  align-items: flex-start;
}
.upload-center__empty {
  height: 160px;
  display: grid;
  place-content: center;
  gap: 8px;
  text-align: center;
  color: #9aa3af;
  font-size: 13px;
}
.task-center-enter-active,
.task-center-leave-active {
  transition:
    transform 0.18s ease,
    opacity 0.18s ease;
}
.task-center-enter-from,
.task-center-leave-to {
  transform: translateY(12px);
  opacity: 0;
}

@media (max-width: 640px) {
  .upload-center {
    right: 8px;
    bottom: 8px;
    width: calc(100vw - 16px);
  }
}
</style>
