import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use(config => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default api;

// Auth
export const login = (data) => api.post('/auth/login', data);
export const register = (data) => api.post('/auth/register', data);
export const getMe = () => api.get('/auth/me');

// User
export const getDashboard = () => api.get('/user/dashboard');
export const getCredentials = () => api.get('/user/credentials');
export const resetCredentials = () => api.post('/user/credentials/reset');
export const getEmails = (params) => api.get('/user/emails', { params });
export const getEmail = (id) => api.get(`/user/emails/${id}`);

// Domains
export const getDomains = () => api.get('/user/domains');
export const addDomain = (data) => api.post('/user/domains', data);
export const verifyDomain = (id) => api.post(`/user/domains/${id}/verify`);
export const getDomainDns = (id) => api.get(`/user/domains/${id}/dns`);
export const deleteDomain = (id) => api.delete(`/user/domains/${id}`);

// Send
export const sendEmail = (data) => api.post('/send', data);

// Branding
export const getBranding = () => api.get('/branding');
export const getAdminBranding = () => api.get('/admin/branding');
export const updateBranding = (data) => api.put('/admin/branding', data);

// Admin
export const getAdminStats = () => api.get('/admin/stats');
export const getAdminUsers = (params) => api.get('/admin/users', { params });
export const createUser = (data) => api.post('/admin/users', data);
export const updateUser = (id, data) => api.put(`/admin/users/${id}`, data);
export const deleteUser = (id) => api.delete(`/admin/users/${id}`);
export const resetUserSmtp = (id) => api.post(`/admin/users/${id}/reset-smtp`);
export const resetUserPassword = (id, password) => api.post(`/admin/users/${id}/reset-password`, password ? { password } : {});
export const impersonateUser = (id) => api.post(`/admin/users/${id}/impersonate`);
export const getPackages = () => api.get('/admin/packages');
export const createPackage = (data) => api.post('/admin/packages', data);
export const updatePackage = (id, data) => api.put(`/admin/packages/${id}`, data);
export const deletePackage = (id) => api.delete(`/admin/packages/${id}`);
