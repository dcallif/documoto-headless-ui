import { createRouter, createWebHistory } from 'vue-router'
import SearchView from '../views/SearchView.vue'
import BookView from '../views/BookView.vue'
import PageView from '../views/PageView.vue'
import CartView from '../views/CartView.vue'
import SettingsView from '../views/SettingsView.vue'

const routes = [
  { path: '/', name: 'search', component: SearchView },
  { path: '/media/:mediaId', name: 'book', component: BookView, props: true },
  { path: '/pages/:pageId', name: 'page', component: PageView, props: true },
  { path: '/cart', name: 'cart', component: CartView },
  { path: '/settings', name: 'settings', component: SettingsView },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

export default router