<template>
  <main class="login-page">
    <section class="login-story">
      <div class="login-brand"><span>FH</span><strong>FileHub Console</strong></div>
      <div class="login-story__content">
        <p class="login-kicker">PRIVATE FILE INFRASTRUCTURE</p>
        <h1>资源管理</h1>
        <!-- <p>面向个人服务器与小团队的文件存储控制台。分片上传、断点续传、公开分享和访问记录集中管理。</p> -->
        <div class="transfer-diagram" aria-hidden="true">
          <div class="transfer-file"><el-icon><Document /></el-icon><span>archive.tar</span><b>2.8 GB</b></div>
          <div class="transfer-line"><i></i><i></i><i></i><i></i><span>72%</span></div>
          <div class="transfer-node"><el-icon><FolderOpened /></el-icon><span>/backup/2026</span></div>
        </div>
      </div>
      <footer>Local storage · Resumable upload · Access audit</footer>
    </section>

    <section class="login-form-side">
      <div class="login-form-wrap">
        <div class="login-form-heading"><span>管理员登录</span><h2>进入文件存储控制台</h2><p>使用服务器中配置的管理员凭证。</p></div>
        <el-form :model="loginForm" label-position="top" @keyup.enter="handleLogin">
          <el-form-item label="用户名">
            <el-input v-model="loginForm.username" :prefix-icon="User" size="large" autocomplete="username" placeholder="请输入用户名" />
          </el-form-item>
          <el-form-item label="密码">
            <el-input v-model="loginForm.password" :prefix-icon="Lock" type="password" size="large" autocomplete="current-password" show-password placeholder="请输入密码" />
          </el-form-item>
          <el-button type="primary" size="large" class="login-submit" :loading="loading" @click="handleLogin">登录控制台</el-button>
        </el-form>
        <!-- <div class="login-security"><el-icon><Lock /></el-icon><span>生产部署前请通过环境变量设置强密码和独立 JWT 密钥。</span></div> -->
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Document, FolderOpened, Lock, User } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'

const router = useRouter()
const loading = ref(false)
const loginForm = reactive({ username: '', password: '' })

async function handleLogin(): Promise<void> {
  if (!loginForm.username.trim() || !loginForm.password) {
    ElMessage.warning('请输入用户名和密码')
    return
  }
  loading.value = true
  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(loginForm),
    })
    const result = await response.json().catch(() => null)
    if (!response.ok || !result?.success) throw new Error(result?.message || '登录失败，请检查凭证')
    localStorage.setItem('token', result.data.access_token)
    localStorage.setItem('username', loginForm.username.trim())
    ElMessage.success('登录成功')
    await router.push('/dashboard')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '无法连接到服务器')
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-page { min-height: 100vh; display: grid; grid-template-columns: minmax(440px, 1.1fr) minmax(420px, .9fr); background: #fff; }
.login-story { position: relative; min-height: 100vh; padding: 30px 44px; display: flex; flex-direction: column; justify-content: space-between; overflow: hidden; color: #fff; background: #14213a; }
.login-story::before { content: ""; position: absolute; width: 460px; height: 460px; right: -190px; top: 9%; border: 1px solid rgb(85 165 255 / 18%); border-radius: 50%; box-shadow: 0 0 0 80px rgb(24 119 255 / 4%), 0 0 0 160px rgb(24 119 255 / 3%); }
.login-brand { position: relative; display: flex; align-items: center; gap: 10px; }
.login-brand span { width: 30px; height: 30px; display: grid; place-items: center; background: #1677ff; font-size: 11px; font-weight: 800; }
.login-brand strong { font-size: 15px; }
.login-story__content { position: relative; max-width: 620px; margin: auto 0; }
.login-kicker { color: #67aaff !important; font-size: 10px !important; font-weight: 700; letter-spacing: 1.8px; }
.login-story h1 { margin: 15px 0 19px; font-size: clamp(35px, 4vw, 56px); font-weight: 600; line-height: 1.18; letter-spacing: -1.4px; }
.login-story__content > p { max-width: 520px; color: #aebbd0; font-size: 13px; line-height: 1.9; }
.login-story footer { position: relative; color: #6f819e; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; }
.transfer-diagram { width: min(520px, 100%); margin-top: 45px; padding: 16px; display: grid; grid-template-columns: 160px 1fr 135px; align-items: center; gap: 14px; background: rgb(255 255 255 / 4%); border: 1px solid rgb(255 255 255 / 9%); }
.transfer-file, .transfer-node { min-width: 0; display: grid; grid-template-columns: 26px 1fr; align-items: center; column-gap: 8px; color: #65a8ff; }
.transfer-file span, .transfer-file b, .transfer-node span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.transfer-file span, .transfer-node span { color: #d7e1f0; font-size: 11px; }
.transfer-file b { grid-column: 2; color: #778aa8; font-size: 9px; font-weight: 400; }
.transfer-line { position: relative; height: 2px; display: flex; gap: 3px; background: #34435d; }
.transfer-line i { flex: 1; height: 2px; background: #1677ff; }
.transfer-line i:last-of-type { background: #34435d; }
.transfer-line span { position: absolute; right: 0; top: 7px; color: #6caeff; font-size: 9px; }
.login-form-side { display: grid; place-items: center; padding: 38px; background: #f7f8fa; }
.login-form-wrap { width: min(390px, 100%); padding: 38px 40px 34px; background: #fff; border: 1px solid #e0e4eb; box-shadow: 0 12px 38px rgb(26 42 68 / 8%); }
.login-form-heading { margin-bottom: 28px; }
.login-form-heading > span { color: #1677ff; font-size: 10px; font-weight: 700; letter-spacing: 1px; }
.login-form-heading h2 { margin: 8px 0 7px; color: #233349; font-size: 22px; font-weight: 600; }
.login-form-heading p { margin: 0; color: #8a95a3; font-size: 11px; }
.login-form-wrap :deep(.el-form-item) { margin-bottom: 19px; }
.login-form-wrap :deep(.el-form-item__label) { color: #4b5b70; font-size: 11px; }
.login-submit { width: 100%; margin-top: 5px; }
.login-security { margin-top: 22px; padding-top: 17px; display: flex; align-items: flex-start; gap: 7px; color: #929ca9; border-top: 1px solid #edf0f4; font-size: 9px; line-height: 1.5; }
@media (max-width: 860px) { .login-page { grid-template-columns: 1fr; } .login-story { display: none; } .login-form-side { min-height: 100vh; padding: 20px; } }
</style>
