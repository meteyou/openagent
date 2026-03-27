export default defineNuxtRouteMiddleware((to) => {
  if (import.meta.server) return

  const { isAuthenticated } = useAuth()

  // Allow access to login page without auth
  if (to.path === '/login') {
    if (isAuthenticated.value) {
      return navigateTo('/')
    }
    return
  }

  // Require auth for all other pages
  if (!isAuthenticated.value) {
    return navigateTo('/login')
  }
})
