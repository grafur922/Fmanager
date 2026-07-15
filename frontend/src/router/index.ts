import { createRouter, createWebHistory } from 'vue-router'
import MainLayout from '../layouts/MainLayout.vue'

const router = createRouter({
  history: createWebHistory(),
  scrollBehavior: () => ({ top: 0 }),
  routes: [
    {
      path: '/',
      component: MainLayout,
      redirect: '/dashboard',
      children: [
        {
          path: 'dashboard',
          name: 'Dashboard',
          component: () => import('../views/DashboardView.vue'),
        },
        { path: 'files', name: 'Files', component: () => import('../views/FilesView.vue') },
        { path: 'trash', name: 'Trash', component: () => import('../views/TrashView.vue') },
        { path: 'shares', name: 'Shares', component: () => import('../views/SharesView.vue') },
        {
          path: 'settings',
          name: 'Settings',
          component: () => import('../views/SettingsView.vue'),
        },
      ],
    },
    { path: '/login', name: 'Login', component: () => import('../views/LoginView.vue') },
    {
      path: '/share/:id',
      name: 'PublicShare',
      component: () => import('../views/PublicShareView.vue'),
      meta: { public: true },
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.beforeEach((to) => {
  if (to.meta.public) return true
  const isAuthenticated = Boolean(localStorage.getItem('token'))
  if (to.name !== 'Login' && !isAuthenticated) return { name: 'Login' }
  if (to.name === 'Login' && isAuthenticated) return { path: '/' }
  return true
})

export default router
