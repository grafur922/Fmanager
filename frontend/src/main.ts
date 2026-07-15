import { createApp } from 'vue'
import { createPinia } from 'pinia'
import {
  ElBadge,
  ElButton,
  ElDialog,
  ElDrawer,
  ElDropdown,
  ElDropdownItem,
  ElDropdownMenu,
  ElForm,
  ElFormItem,
  ElIcon,
  ElInput,
  ElInputNumber,
  ElLoading,
  ElOption,
  ElPagination,
  ElProgress,
  ElSelect,
  ElSwitch,
  ElTable,
  ElTableColumn,
  ElTooltip,
} from 'element-plus'
import 'element-plus/dist/index.css'
import './style.css'
import App from './App.vue'
import router from './router'

const app = createApp(App)
const elementComponents = [
  ElBadge,
  ElButton,
  ElDialog,
  ElDrawer,
  ElDropdown,
  ElDropdownItem,
  ElDropdownMenu,
  ElForm,
  ElFormItem,
  ElIcon,
  ElInput,
  ElInputNumber,
  ElOption,
  ElPagination,
  ElProgress,
  ElSelect,
  ElSwitch,
  ElTable,
  ElTableColumn,
  ElTooltip,
]

elementComponents.forEach((component) => app.use(component))
app.use(ElLoading)
app.use(createPinia())
app.use(router)
app.mount('#app')
