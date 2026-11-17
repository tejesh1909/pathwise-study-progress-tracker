/* Thin fetch wrapper around the REST API. The offline preview swaps this file for tools/mock-api.js (same interface). */
window.API = (function () {
  'use strict';

  class ApiError extends Error {
    constructor(message, status, code, details) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.code = code;
      this.details = details || {};
    }
  }

  const api = { ApiError, onUnauthorized: null };

  async function req(method, url, body) {
    let res;
    try {
      res = await fetch(url, {
        method,
        credentials: 'same-origin',
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError("Can't reach the server — is it running?", 0, 'NETWORK');
    }
    let data = {};
    try {
      data = await res.json();
    } catch {
      /* empty body */
    }
    if (!res.ok) {
      if (res.status === 401 && api.onUnauthorized && !url.startsWith('/api/auth/')) api.onUnauthorized();
      throw new ApiError(data.error || 'Request failed', res.status, data.code, data.details);
    }
    return data;
  }

  const qs = (o) => {
    const p = new URLSearchParams();
    Object.entries(o || {}).forEach(([k, v]) => v != null && v !== '' && p.set(k, v));
    const s = p.toString();
    return s ? '?' + s : '';
  };

  Object.assign(api, {
    me: () => req('GET', '/api/auth/me'),
    login: (email, password) => req('POST', '/api/auth/login', { email, password }),
    register: (name, email, password) => req('POST', '/api/auth/register', { name, email, password }),
    logout: () => req('POST', '/api/auth/logout'),
    changePassword: (currentPassword, newPassword) => req('POST', '/api/auth/change-password', { currentPassword, newPassword }),

    config: () => req('GET', '/api/config'),
    saveConfig: (values) => req('PUT', '/api/config', values),

    dashboard: (learnerId) => req('GET', '/api/dashboard' + qs({ learnerId })),
    learners: () => req('GET', '/api/learners'),
    insights: (learnerId) => req('GET', '/api/insights' + qs({ learnerId })),

    goals: (learnerId) => req('GET', '/api/goals' + qs({ learnerId })),
    goal: (id) => req('GET', `/api/goals/${id}`),
    createGoal: (data) => req('POST', '/api/goals', data),
    updateGoal: (id, data) => req('PUT', `/api/goals/${id}`, data),
    deleteGoal: (id) => req('DELETE', `/api/goals/${id}`),
    addFeedback: (goalId, text) => req('POST', `/api/goals/${goalId}/feedback`, { text }),

    createTopic: (goalId, data) => req('POST', `/api/goals/${goalId}/topics`, data),
    updateTopic: (id, data) => req('PUT', `/api/topics/${id}`, data),
    deleteTopic: (id) => req('DELETE', `/api/topics/${id}`),
    completeTopic: (id) => req('POST', `/api/topics/${id}/complete`),
    reopenTopic: (id) => req('POST', `/api/topics/${id}/reopen`),

    saveNotes: (id, data) => req('PUT', `/api/topics/${id}/notes`, data),
    approveTopic: (id, comment) => req('POST', `/api/topics/${id}/approve`, { comment }),
    rejectTopic: (id, comment) => req('POST', `/api/topics/${id}/reject`, { comment }),
    importGoal: (goal, topics) => req('POST', '/api/goals/import', { goal, topics }),
    createShare: (goalId, days) => req('POST', `/api/goals/${goalId}/shares`, { days }),
    revokeShare: (id) => req('DELETE', `/api/shares/${id}`),
    sharedGoal: (token) => req('GET', `/api/share/${encodeURIComponent(token)}`),

    roadmap: (subject, level) => req('POST', '/api/ai/roadmap', { subject, level }),
    quiz: (topicId) => req('POST', `/api/topics/${topicId}/quiz`),
    quizAttempt: (topicId, score, total) => req('POST', `/api/topics/${topicId}/quiz/attempt`, { score, total }),
    coach: (message, history) => req('POST', '/api/coach', { message, history }),

    exportUrl: (kind, params) => `/api/export/progress.${kind === 'pdf' ? 'pdf' : 'csv'}` + qs(Object.assign({}, params, kind === 'sessions' ? { kind: 'sessions' } : {})),
    exportDownload: async () => null, // real app: the browser downloads the URL directly

    adminUsers: () => req('GET', '/api/admin/users'),
    adminCreateUser: (data) => req('POST', '/api/admin/users', data),
    adminUpdateUser: (id, data) => req('PUT', `/api/admin/users/${id}`, data),
    adminResetPassword: (id) => req('POST', `/api/admin/users/${id}/reset-password`),
    cohorts: () => req('GET', '/api/admin/cohorts'),
    createCohort: (data) => req('POST', '/api/admin/cohorts', data),
    updateCohort: (id, data) => req('PUT', `/api/admin/cohorts/${id}`, data),
    deleteCohort: (id) => req('DELETE', `/api/admin/cohorts/${id}`),
    assignGoal: (data) => req('POST', '/api/admin/assign', data),
    assignedGoals: () => req('GET', '/api/admin/assigned'),
    approvals: () => req('GET', '/api/admin/approvals'),

    sessions: (params) => req('GET', '/api/sessions' + qs(params)),
    logSession: (data) => req('POST', '/api/sessions', data),
    deleteSession: (id) => req('DELETE', `/api/sessions/${id}`),
  });

  return api;
})();
