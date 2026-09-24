import axios from 'axios';

const API_BASE_URL =
  (typeof window !== 'undefined' && window.__APP_CONFIG__?.API_URL) ||
  import.meta.env.VITE_API_URL ||
  '/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add token to requests
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Handle auth errors — do not redirect on failed login (show error in UI)
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const url = String(error.config?.url || '');
    const isLoginRequest = url.includes('/auth/login');

    if (status === 401 && !isLoginRequest) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      if (!window.location.pathname.includes('/login')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

// Auth API
export const authAPI = {
  login: (credentials) => api.post('/auth/login', credentials),
  getMe: () => api.get('/auth/me'),
  createUser: (data) => api.post('/auth/create', data),
  resetPassword: (data) => api.put('/auth/reset-password', data),
  listUsers: () => api.get('/auth/list'),
};

// Leads assign / reassign
export const leadsAPI = {
  getAll: (params = {}) => api.get('/leads/', { params }),
  getMyLeads: (params = {}) => api.get('/leads/my-leads', { params }),
  create: (lead) => api.post('/leads/', lead),
  complete: (leadId) => api.post(`/leads/${leadId}/complete`),
  update: (id, lead) => api.put(`/leads/${id}`, lead),
  delete: (id) => api.delete(`/leads/${id}`),
  bulkUpload: (rows) => api.post('/leads/bulk-upload', { rows }),
  manualAssign: (leadId, bdId) => api.post(`/leads/${leadId}/manual-assign/${bdId}`),
  requestReassign: (leadId, reason) =>
    api.post(`/leads/${leadId}/request-reassign`, { reason: reason || '' }),
  reassign: (leadId, bdId) => api.post(`/leads/${leadId}/reassign/${bdId}`),
};

// BDs API
export const bdsAPI = {
  getAll: (params = {}) => api.get('/bds/', { params }),
  getDetails: (id) => api.get(`/bds/${id}`),
  update: (id, bd) => api.put(`/bds/${id}`, bd),
  toggleAvailability: (id) => api.put(`/bds/${id}/toggle-availability`),
};

// Dashboard API
export const dashboardAPI = {
  getStats: () => api.get('/dashboard'),
  getRoutingHistory: () => api.get('/routing-history'),
  getPendingLeads: (params = {}) => api.get('/pending-leads', { params }),
  getBDWorkload: () => api.get('/bd-workload'),
  bulkUserUpload: (rows) => api.post('/bulk-users-upload', { rows }),
  checkPending: () => api.post('/check-pending'),
};

// Classify video calls
export const callsAPI = {
  configStatus: () => api.get('/calls/config-status'),
  list: (params = {}) => api.get('/calls/', { params }),
  get: (sessionId) => api.get(`/calls/${sessionId}`),
  schedule: (data) => api.post('/calls/schedule', data),
  fetchAttendance: (sessionId) => api.post(`/calls/${sessionId}/fetch-attendance`),
  reprocess: (sessionId) => api.post(`/calls/${sessionId}/reprocess`),
};

export default api;
