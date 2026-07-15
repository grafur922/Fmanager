<template>
  <div class="console-shell">
    <header class="console-topbar">
      <div class="console-brand">
        <div class="console-brand__mark">FH</div>
        <strong>FileHub</strong>
        <span>文件存储控制台</span>
      </div>

      <div class="console-topbar__right">
        <div class="region-chip"><span></span>本地节点</div>
        <button class="topbar-transfer" type="button" @click="uploadStore.isPanelOpen = !uploadStore.isPanelOpen">
          <el-badge :value="uploadStore.activeTasks.length" :hidden="!uploadStore.activeTasks.length" :max="99">
            <el-icon><UploadFilled /></el-icon>
          </el-badge>
          <span>传输任务</span>
        </button>
        <button class="topbar-icon" type="button" aria-label="通知"><el-icon><Bell /></el-icon></button>
        <el-dropdown trigger="click" @command="handleAccountCommand">
          <button class="account-button" type="button">
            <span class="account-avatar">{{ username.slice(0, 1).toUpperCase() }}</span>
            <span>{{ username }}</span>
            <el-icon><ArrowDown /></el-icon>
          </button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="settings">传输设置</el-dropdown-item>
              <el-dropdown-item divided command="logout">退出登录</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </header>

    <div class="console-body">
      <aside class="console-sidebar">
        <div class="product-title">
          <div class="product-title__icon"><el-icon><FolderOpened /></el-icon></div>
          <div><strong>文件存储</strong><span>File Storage</span></div>
        </div>
        <nav class="console-nav" aria-label="主导航">
          <div class="console-nav__group">资源管理</div>
          <router-link to="/dashboard" class="console-nav__item">
            <el-icon><DataAnalysis /></el-icon><span>概览</span>
          </router-link>
          <router-link to="/files" class="console-nav__item">
            <el-icon><Folder /></el-icon><span>文件管理</span>
          </router-link>
          <router-link to="/trash" class="console-nav__item">
            <el-icon><Delete /></el-icon><span>回收站</span>
          </router-link>
          <router-link to="/shares" class="console-nav__item">
            <el-icon><Share /></el-icon><span>公开分享</span>
          </router-link>
          <div class="console-nav__group">系统管理</div>
          <router-link to="/settings" class="console-nav__item">
            <el-icon><Setting /></el-icon><span>传输设置</span>
          </router-link>
        </nav>
        <div class="sidebar-footnote">
          <span>存储后端</span>
          <b><i></i>Local FS</b>
        </div>
      </aside>

      <main class="console-main">
        <router-view v-slot="{ Component }">
          <transition name="page-fade" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </main>
    </div>

    <UploadTaskCenter />
  </div>
</template>

<script setup lang="ts">
import {
  ArrowDown,
  Bell,
  DataAnalysis,
  Delete,
  Folder,
  FolderOpened,
  Setting,
  Share,
  UploadFilled,
} from '@element-plus/icons-vue'
import { useRouter } from 'vue-router'
import UploadTaskCenter from '../components/upload/UploadTaskCenter.vue'
import { useUploadStore } from '../stores/upload'

const router = useRouter()
const uploadStore = useUploadStore()
const username = localStorage.getItem('username') || 'admin'

function handleAccountCommand(command: string): void {
  if (command === 'settings') {
    void router.push('/settings')
    return
  }
  if (command === 'logout') {
    localStorage.removeItem('token')
    localStorage.removeItem('username')
    void router.push('/login')
  }
}
</script>

<style scoped>
.page-fade-enter-active, .page-fade-leave-active { transition: opacity .12s ease; }
.page-fade-enter-from, .page-fade-leave-to { opacity: 0; }
</style>
