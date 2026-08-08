import axios from 'axios'

const API = axios.create({ baseURL: 'http://localhost:5001/api' })

API.interceptors.request.use(config => {
  const token = localStorage.getItem('tw_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

API.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('tw_token')
      localStorage.removeItem('tw_user')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

export default API